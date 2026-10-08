import { useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { SecurityNote, SecurityScreen } from '@/components/security/security-screen';
import { BrandButton } from '@/components/ui/brand-button';
import { Icon } from '@/components/ui/icon';
import { LockIcon } from '@/components/ui/icons';
import { QrCode } from '@/components/ui/qr-code';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';

/**
 * Zwei-Faktor-Anmeldung einrichten und verwalten.
 *
 * ## Zwei Wege – und welcher der bessere ist
 *
 * - **Authenticator-App** (Google/Microsoft Authenticator, 1Password …): Die App
 *   rechnet alle 30 Sekunden einen Code aus einem gemeinsamen Geheimnis. Nichts
 *   wird verschickt, also kann auch nichts abgefangen werden. Deshalb empfohlen.
 * - **E-Mail**: Der Code kommt ins Postfach. Bequemer, aber nur so sicher wie das
 *   Postfach selbst – wer das übernimmt, bekommt auch den Code.
 *
 * SMS gibt es bewusst nicht: Sie kostet pro Nachricht Geld und lässt sich per
 * SIM-Tausch abfangen – genau der Angriff, gegen den 2FA schützen soll.
 *
 * ## Wiederherstellungscodes
 *
 * Wer das Handy verliert, kommt ohne sie nie wieder ins Konto. Sie werden genau
 * einmal gezeigt (der Server speichert nur ihre Prüfsummen) und jeder Code gilt
 * genau einmal. Deshalb der deutliche Schritt „Ich habe sie gespeichert".
 */

type Step =
  | { kind: 'overview' }
  | { kind: 'email'; challenge: string; destination: string }
  | { kind: 'totp'; secret: string; otpauthUrl: string }
  | { kind: 'codes'; codes: string[] };

export default function TwoFactorScreen() {
  const colors = useTheme();
  const { token, user, applyUser } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'overview' });
  const [code, setCode] = useState('');
  // Step-up (F-19): switching on needs the password; switching off and new recovery codes need
  // the password AND a current code.
  const [password, setPassword] = useState('');
  const [proofCode, setProofCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const method = user?.two_factor_method ?? null;

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    // Ohne `finally`: Damit kann der React Compiler die Seite nicht übersetzen.
    let result: T | null = null;
    try {
      result = await work();
    } catch (e) {
      setError(e instanceof ApiError ? e.firstError() : 'Etwas ist schiefgelaufen. Bitte versuch es noch mal.');
    }
    setBusy(false);
    return result;
  }

  async function startEmail() {
    if (!token) return;
    if (!password) {
      setError('Bitte gib zuerst dein Passwort ein.');
      return;
    }
    const res = await run(() => api.twoFactorEmailStart(token, password));
    if (res) {
      setCode('');
      setPassword('');
      setStep({ kind: 'email', challenge: res.challenge, destination: res.destination });
    }
  }

  async function startTotp() {
    if (!token) return;
    if (!password) {
      setError('Bitte gib zuerst dein Passwort ein.');
      return;
    }
    const res = await run(() => api.twoFactorTotpStart(token, password));
    if (res) {
      setCode('');
      setPassword('');
      setStep({ kind: 'totp', secret: res.secret, otpauthUrl: res.otpauth_url });
    }
  }

  async function confirm() {
    if (!token) return;
    const value = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(value)) {
      setError('Der Code hat 6 Ziffern.');
      return;
    }
    const res = await run(() =>
      step.kind === 'email'
        ? api.twoFactorEmailConfirm(token, step.challenge, value)
        : api.twoFactorTotpConfirm(token, value),
    );
    if (res) {
      applyUser(res.user);
      setStep({ kind: 'codes', codes: res.recovery_codes });
    }
  }

  /** Passwort UND aktueller Code (oder Wiederherstellungscode) – erst beides zusammen genügt. */
  function proofBody() {
    return { password, code: proofCode.trim() };
  }

  function proofComplete(): boolean {
    if (password && proofCode.trim()) return true;
    setError('Bitte gib dein Passwort und einen aktuellen Code ein.');
    return false;
  }

  async function disable() {
    if (!token) return;
    if (!proofComplete()) return;
    const ok = await confirmAction(
      'Zwei-Faktor ausschalten?',
      'Dann reicht zum Anmelden wieder das Passwort allein.',
      'Ausschalten',
      true,
    );
    if (!ok) return;
    const res = await run(() => api.twoFactorDisable(token, proofBody()));
    if (res) {
      applyUser(res.user);
      setPassword('');
      setProofCode('');
      await notifyUser('Ausgeschaltet', 'Die Zwei-Faktor-Anmeldung ist aus. Andere Geräte wurden abgemeldet.');
    }
  }

  /** E-Mail-2FA: Code für die Bestätigung anfordern (die App hat keinen eigenen). */
  async function sendCode() {
    if (!token) return;
    const res = await run(() => api.twoFactorSendCode(token));
    if (res) await notifyUser('Code unterwegs', `Wir haben dir einen Code an ${res.destination} geschickt.`);
  }

  async function newCodes() {
    if (!token) return;
    if (!proofComplete()) return;
    const res = await run(() => api.twoFactorRecoveryCodes(token, proofBody()));
    if (res) {
      setPassword('');
      setProofCode('');
      setStep({ kind: 'codes', codes: res.recovery_codes });
    }
  }

  // ------------------------------------------------------------ Codes zeigen
  if (step.kind === 'codes') {
    return (
      <SecurityScreen
        title="Wiederherstellungscodes"
        intro="Speichere diese Codes an einem sicheren Ort – zum Beispiel in deinem Passwort-Manager. Verlierst du dein Handy, kommst du nur damit wieder in dein Konto.">
        <View style={[styles.codes, { backgroundColor: colors.backgroundElement }]}>
          {step.codes.map((c) => (
            <Text key={c} selectable style={[styles.code, { color: colors.text }]}>
              {c}
            </Text>
          ))}
        </View>
        <SecurityNote tone="danger">
          Jeder Code funktioniert genau einmal. Diese Liste siehst du nur jetzt.
        </SecurityNote>
        <SecurityNote>Andere Geräte wurden abgemeldet.</SecurityNote>
        <BrandButton
          title="Codes teilen / speichern"
          variant="glass"
          onPress={() =>
            Share.share({ message: `GÖ4Fun – Wiederherstellungscodes\n\n${step.codes.join('\n')}` }).catch(() => {})
          }
        />
        <BrandButton title="Ich habe sie gespeichert" onPress={() => setStep({ kind: 'overview' })} />
      </SecurityScreen>
    );
  }

  // --------------------------------------------------------- E-Mail bestätigen
  if (step.kind === 'email') {
    return (
      <SecurityScreen
        title="Per E-Mail"
        intro={`Wir haben dir einen 6-stelligen Code an ${step.destination} geschickt. Gib ihn hier ein, um die Zwei-Faktor-Anmeldung einzuschalten.`}>
        <CodeField value={code} onChange={setCode} error={error} />
        <BrandButton title="Einschalten" onPress={confirm} loading={busy} />
        <Pressable onPress={() => setStep({ kind: 'overview' })} hitSlop={8}>
          <Text style={[styles.link, { color: colors.textSecondary }]}>Abbrechen</Text>
        </Pressable>
      </SecurityScreen>
    );
  }

  // --------------------------------------------------- Authenticator-App
  if (step.kind === 'totp') {
    const grouped = step.secret.replace(/(.{4})/g, '$1 ').trim();
    return (
      <SecurityScreen
        title="Authenticator-App"
        intro="Füge GÖ4Fun in deiner Authenticator-App hinzu und gib dann den 6-stelligen Code ein, den sie anzeigt.">
        {Platform.OS !== 'web' ? (
          <BrandButton
            title="In Authenticator-App öffnen"
            onPress={() =>
              Linking.openURL(step.otpauthUrl).catch(() =>
                notifyUser(
                  'Keine Authenticator-App gefunden',
                  'Installiere z. B. Google Authenticator oder Microsoft Authenticator – oder gib den Schlüssel unten von Hand ein.',
                ),
              )
            }
          />
        ) : null}

        <View style={styles.qrWrap}>
          <QrCode value={step.otpauthUrl} size={196} />
          <Text style={[styles.small, { color: colors.textSecondary }]}>
            Auf einem anderen Gerät? Scanne den Code mit der App.
          </Text>
        </View>

        <View style={[styles.secretBox, { backgroundColor: colors.backgroundElement }]}>
          <Text style={[styles.small, { color: colors.textSecondary }]}>Oder den Schlüssel eintippen:</Text>
          <Text selectable style={[styles.secret, { color: colors.text }]}>
            {grouped}
          </Text>
        </View>

        <CodeField value={code} onChange={setCode} error={error} />
        <BrandButton title="Einschalten" onPress={confirm} loading={busy} />
        <Pressable onPress={() => setStep({ kind: 'overview' })} hitSlop={8}>
          <Text style={[styles.link, { color: colors.textSecondary }]}>Abbrechen</Text>
        </Pressable>
      </SecurityScreen>
    );
  }

  // --------------------------------------------------------------- Übersicht
  if (method) {
    return (
      <SecurityScreen title="Zwei-Faktor-Anmeldung">
        <View style={[styles.status, { backgroundColor: colors.backgroundElement }]}>
          <Icon name="shield-check" size={32} color="#16a34a" />
          <View style={styles.statusText}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>Eingeschaltet</Text>
            <Text style={[styles.small, { color: colors.textSecondary }]}>
              {method === 'totp' ? 'Code aus deiner Authenticator-App' : `Code per E-Mail an ${user?.email ?? ''}`}
            </Text>
          </View>
        </View>

        <Text style={[styles.section, { color: colors.text }]}>Bestätigen, dass du es bist</Text>
        <TextField
          label="Passwort"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          leftIcon={<LockIcon />}
        />
        <TextField
          label="Aktueller Code"
          value={proofCode}
          onChangeText={setProofCode}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={9}
          leftIcon={<LockIcon />}
          error={error ?? undefined}
        />
        {method === 'email' ? (
          <Pressable onPress={sendCode} disabled={busy} hitSlop={8}>
            <Text style={[styles.link, { color: colors.tint }]}>Code per E-Mail schicken</Text>
          </Pressable>
        ) : null}
        <BrandButton title="Neue Wiederherstellungscodes" variant="glass" onPress={newCodes} loading={busy} />
        <Pressable onPress={disable} disabled={busy} hitSlop={8} style={styles.danger}>
          <Text style={styles.dangerText}>Zwei-Faktor ausschalten</Text>
        </Pressable>
      </SecurityScreen>
    );
  }

  return (
    <SecurityScreen
      title="Zwei-Faktor-Anmeldung"
      intro="Beim Anmelden brauchst du dann neben dem Passwort einen Code. Selbst wer dein Passwort kennt, kommt so nicht in dein Konto.">
      <TextField
        label="Passwort"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        leftIcon={<LockIcon />}
      />
      <Text style={[styles.small, { color: colors.textSecondary }]}>
        Zum Einschalten bestätigst du mit deinem Passwort.
      </Text>
      <MethodOption
        icon="phone"
        title="Authenticator-App"
        badge="Empfohlen"
        text="Google Authenticator, Microsoft Authenticator oder dein Passwort-Manager erzeugen den Code – nichts wird verschickt."
        onPress={startTotp}
        disabled={busy}
      />
      <MethodOption
        icon="mail"
        title="Per E-Mail"
        text={`Der Code kommt an ${user?.email ?? 'deine E-Mail-Adresse'}. Bequem, aber nur so sicher wie dein Postfach.`}
        onPress={startEmail}
        disabled={busy}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SecurityScreen>
  );
}

function CodeField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string | null }) {
  return (
    <TextField
      label="6-stelliger Code"
      value={value}
      onChangeText={onChange}
      placeholder="123456"
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={7}
      leftIcon={<LockIcon />}
      error={error ?? undefined}
    />
  );
}

function MethodOption({
  icon,
  title,
  text,
  badge,
  onPress,
  disabled,
}: {
  icon: UiIconName;
  title: string;
  text: string;
  badge?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: colors.backgroundElement },
        pressed && { opacity: 0.75 },
      ]}>
      <View style={[styles.optionIcon, { backgroundColor: colors.background }]}>
        <Icon name={icon} size={22} color={colors.text} />
      </View>
      <View style={styles.optionText}>
        <View style={styles.optionHead}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>{title}</Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: colors.tint }]}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.small, { color: colors.textSecondary }]}>{text}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Radius.card },
  optionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 2 },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  optionTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontFamily: FontFamily.bold, fontSize: 11 },
  small: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Radius.card },
  statusText: { flex: 1, gap: 2 },
  statusTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  section: { fontFamily: FontFamily.bold, fontSize: 15, marginTop: Spacing.two },
  qrWrap: { alignItems: 'center', gap: Spacing.two },
  secretBox: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.one },
  secret: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1 },
  codes: { borderRadius: Radius.card, padding: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  code: { width: '47%', fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1, textAlign: 'center', paddingVertical: 4 },
  link: { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: 'center' },
  danger: { alignItems: 'center', paddingVertical: Spacing.two },
  dangerText: { color: '#ed4956', fontFamily: FontFamily.bold, fontSize: 15 },
  error: { color: '#ed4956', fontFamily: FontFamily.medium, fontSize: 13 },
});
