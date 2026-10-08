import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { Icon } from '@/components/ui/icon';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { SUPPORT_EMAIL, supportMailto } from '@/constants/links';
import { Brand, MaxContentWidth, Spacing, FontFamily } from '@/constants/theme';
import { api, ApiError, type BanInfo, type TwoFactorChallenge } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import { clearSavedEmail, loadSavedEmail, saveEmail } from '@/lib/credential-store';
import { passwordStrength } from '@/lib/password-strength';
import { flagWeakPassword } from '@/lib/security-nudge';

type Props = {
  /** true, wenn der Login-Screen aktuell sichtbar ist (löst das Vorausfüllen aus). */
  active: boolean;
  /** Zurück zum Start-Screen. */
  onBack: () => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Menschlich lesbare Restdauer + Ende eines Timeouts (aus ISO-Zeitpunkt). */
function formatTimeout(iso: string | null): string {
  if (!iso) return '';
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return '';
  const ms = end.getTime() - Date.now();
  const endStr = `${pad(end.getDate())}.${pad(end.getMonth() + 1)}. um ${pad(end.getHours())}:${pad(end.getMinutes())} Uhr`;
  if (ms <= 0) return `endet ${endStr}`;

  const totalMin = Math.ceil(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  const parts = [
    days ? `${days} Tag${days === 1 ? '' : 'e'}` : null,
    hours ? `${hours} Std` : null,
    mins ? `${mins} Min` : null,
  ].filter(Boolean);
  return `noch ${parts.join(' ')} (bis ${endStr})`;
}

/**
 * Login-Screen als voller Panel – Teil des gekoppelten Slides mit dem Start-Screen.
 * Kein eigenes Overlay/Backdrop mehr: der Hintergrund liegt fest dahinter, dieser
 * Panel wird vom Eltern-Screen mit hochgezogen.
 */
export function LoginPanel({ active, onBack }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login, completeTwoFactor } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  // Sperr-Info fürs Popup (Grund + Dauer), wenn der Login mit 403 gesperrt zurückkommt.
  const [banned, setBanned] = useState<BanInfo | null>(null);

  /**
   * Zweiter Schritt, wenn die Zwei-Faktor-Anmeldung an ist: Das Passwort stimmte,
   * aber angemeldet ist man erst mit dem Code. Solange `challenge` gesetzt ist,
   * zeigt die Karte das Code-Feld statt E-Mail und Passwort.
   */
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [code, setCode] = useState('');
  /** Sekunden bis „Code erneut senden" wieder geht (der Server lässt 1×/Minute zu). */
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Gemerkte E-Mail-Adresse vorausfüllen, sobald der Login sichtbar wird. Only the address is
  // remembered; the password manager of the system can still fill the password field.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      const saved = await loadSavedEmail();
      if (alive && saved) {
        setEmail(saved);
        setRemember(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [active]);

  function showError(error: unknown) {
    if (error instanceof ApiError && error.status === 403 && error.body?.ban) {
      // Gesperrtes Konto → Popup mit Grund + Dauer.
      setBanned(error.body.ban);
    } else if (error instanceof ApiError) {
      setErrors(error.errors);
      if (Object.keys(error.errors).length === 0) setGeneralError(error.firstError());
    } else {
      setGeneralError('Unbekannter Fehler.');
    }
  }

  /**
   * Nach einer ERFOLGREICHEN Anmeldung: die E-Mail-Adresse merken (oder vergessen) und
   * die Stärke des gerade eingegebenen Passworts festhalten. Gespeichert wird nur
   * „schwach ja/nein" – die Startseite zeigt dann einmal einen Hinweis (siehe
   * src/lib/security-nudge.ts). Erst hier, nicht schon nach dem Passwort: Bei
   * aktiver 2FA ist man da noch nicht angemeldet.
   */
  async function finishLogin() {
    // Zuerst und ohne `await`: Der Auth-Gate wechselt schon in die App, und die Startseite
    // fragt den Hinweis beim ersten Erscheinen ab.
    flagWeakPassword(passwordStrength(password, [email.trim()]).score <= 1);
    if (remember) {
      await saveEmail(email.trim());
    } else {
      await clearSavedEmail();
    }
  }

  /** Das Passwort stimmte, jetzt fehlt der Code (Zwei-Faktor-Anmeldung). */
  function askForCode(pending: TwoFactorChallenge) {
    setChallenge(pending);
    setCode('');
    setResendIn(pending.method === 'email' ? 60 : 0);
  }

  // Die try-Blöcke unten bleiben bewusst ohne `finally` und ohne Bedingungen
  // (`?:`, `&&`): Beides kann der React Compiler nicht übersetzen, und dann bliebe
  // die ganze Karte unoptimiert – jeder Tastendruck zeichnete sie komplett neu.
  async function onSubmit() {
    setLoading(true);
    setErrors({});
    setGeneralError(null);
    try {
      const pending = await login(email.trim(), password);
      if (pending) askForCode(pending);
      else await finishLogin();
    } catch (error) {
      showError(error);
    }
    setLoading(false);
  }

  /**
   * Abgelaufen oder zu viele Versuche: Der Beleg ist verbraucht, es geht nur mit
   * einer neuen Anmeldung weiter. Dann zurück zum Passwort, statt ein Code-Feld
   * stehen zu lassen, das nie mehr funktionieren kann.
   */
  function showCodeError(error: unknown) {
    if (error instanceof ApiError && error.errors.challenge) {
      setChallenge(null);
      setGeneralError(error.firstError());
    } else if (error instanceof ApiError && Object.keys(error.errors).length === 0) {
      setErrors({ code: [error.firstError()] });
    } else {
      showError(error);
    }
  }

  async function onConfirmCode() {
    if (!challenge) return;
    const value = code.trim();
    if (!value) {
      setErrors({ code: ['Bitte gib den Code ein.'] });
      return;
    }
    setLoading(true);
    setErrors({});
    setGeneralError(null);
    try {
      await completeTwoFactor(challenge.challenge, value);
      await finishLogin();
    } catch (error) {
      showCodeError(error);
    }
    setLoading(false);
  }

  async function onResend() {
    if (!challenge || resendIn > 0) return;
    try {
      const res = await api.resendTwoFactor(challenge.challenge);
      setResendIn(60);
      setGeneralError(null);
      setErrors({});
      // notifyUser statt Alert.alert: Alert tut im Browser nichts.
      void notifyUser('Neuer Code', res.message);
    } catch (error) {
      showError(error);
    }
  }

  /**
   * Widerspruch gegen eine Sperre – an einen Menschen.
   *
   * Sperren setzt oft die KI-Prüfung automatisch. Wer davon betroffen ist, hat nach
   * DSGVO Art. 22 das Recht, dass ein Mensch sich die Entscheidung ansieht. Ohne
   * diesen Knopf gäbe es dafür keinen Weg: Mit einer Sperre kommt man an nichts
   * anderes in der App mehr heran.
   */
  function onAppeal() {
    const lines = [
      'Ich möchte der Sperre meines Kontos widersprechen.',
      '',
      `Konto: ${email.trim()}`,
      banned?.reason ? `Grund laut App: ${banned.reason}` : null,
      '',
      'Warum die Sperre aus meiner Sicht falsch ist:',
      '',
    ].filter((line): line is string => line !== null);
    Linking.openURL(supportMailto('Widerspruch gegen Sperre', lines.join('\n'))).catch(() => {
      void notifyUser('Mail ließ sich nicht öffnen', `Schreib uns an ${SUPPORT_EMAIL}.`);
    });
  }

  // Die Tastatur-Freistellung macht `KeyboardForm` (siehe dort): RNs
  // KeyboardAvoidingView war ohne `behavior` wirkungslos und mit `padding`
  // instabil – beides ließ die Felder unbenutzbar wirken.
  return (
    <View style={styles.flex}>
      {/* Griff oben: tippen führt zurück zum Start-Screen. */}
      <Pressable onPress={onBack} hitSlop={16} style={[styles.handleHitbox, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.handle} />
        <Text style={styles.handleText}>Zurück</Text>
      </Pressable>

      <KeyboardForm
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <BrandGradientText style={styles.title}>Willkommen zurück!</BrandGradientText>
          <Text style={styles.subtitle}>Schön, dich wiederzusehen</Text>
        </View>

        {challenge ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Bestätigungscode</Text>
            <Text style={styles.codeText}>
              {challenge.method === 'email'
                ? `Wir haben dir einen 6-stelligen Code an ${challenge.destination ?? 'deine E-Mail-Adresse'} geschickt.`
                : 'Öffne deine Authenticator-App und gib den 6-stelligen Code für GÖ4Fun ein.'}
            </Text>

            {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

            <TextField
              label="Code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={9}
              leftIcon={<LockIcon />}
              error={errors.code?.[0]}
            />
            <Text style={styles.codeHint}>
              Kein Zugriff? Einer deiner Wiederherstellungscodes (xxxx-xxxx) funktioniert auch.
            </Text>

            <BrandButton title="Bestätigen" onPress={onConfirmCode} loading={loading} />

            <View style={styles.codeActions}>
              {challenge.method === 'email' ? (
                <Pressable onPress={onResend} disabled={resendIn > 0} hitSlop={8}>
                  <Text style={[styles.forgotText, resendIn > 0 && styles.disabledText]}>
                    {resendIn > 0 ? `Neuer Code in ${resendIn} s` : 'Code erneut senden'}
                  </Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable
                onPress={() => {
                  setChallenge(null);
                  setErrors({});
                  setGeneralError(null);
                }}
                hitSlop={8}>
                <Text style={styles.forgotText}>Zurück</Text>
              </Pressable>
            </View>
          </View>
        ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Anmelden</Text>

          {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

          <TextField
            label="E-Mail"
            value={email}
            onChangeText={setEmail}
            placeholder="beispiel@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            leftIcon={<MailIcon />}
            error={errors.email?.[0]}
          />
          <TextField
            label="Passwort"
            value={password}
            onChangeText={setPassword}
            placeholder="Dein Passwort"
            secureTextEntry
            autoComplete="current-password"
            leftIcon={<LockIcon />}
            error={errors.password?.[0]}
          />

          <View style={styles.rememberRow}>
            <View style={styles.rememberLeft}>
              <Switch
                value={remember}
                onValueChange={setRemember}
                trackColor={{ false: '#e5e7eb', true: Brand.purple }}
                thumbColor="#ffffff"
              />
              <Text style={styles.rememberText}>E-Mail-Adresse merken</Text>
            </View>

            <Pressable onPress={() => router.push('/forgot-password')} hitSlop={8}>
              <Text style={styles.forgotText}>Passwort vergessen?</Text>
            </Pressable>
          </View>

          <BrandButton title="Anmelden" onPress={onSubmit} loading={loading} />
        </View>
        )}

        {/* „Mit Google anmelden" ist raus, bis es angebunden ist: Der Knopf zeigte nur
            „Kommt bald". Ein Knopf, der nichts tut, kostet Vertrauen – und Apple
            verlangt neben Google auch „Mit Apple anmelden" (Richtlinie 4.8). */}

        <View style={styles.registerWrap}>
          <Text style={styles.muted}>Noch kein Konto?</Text>
          <Pressable onPress={() => router.push('/register')} style={styles.registerBtn}>
            <Text style={styles.registerBtnText}>Jetzt registrieren</Text>
          </Pressable>
        </View>
      </KeyboardForm>

      {/* Popup: Konto gesperrt (Bann oder Timeout) mit Grund + Dauer. */}
      <Modal visible={banned !== null} transparent animationType="fade" onRequestClose={() => setBanned(null)}>
        <View style={styles.banBackdrop}>
          <View style={styles.banCard}>
            <Icon
              name={banned?.permanent ? 'ban' : 'hourglass'}
              size={40}
              color="#ef4444"
            />
            <Text style={styles.banTitle}>
              {banned?.permanent ? 'Konto gesperrt' : 'Du hast einen Timeout'}
            </Text>

            <Text style={styles.banText}>
              {banned?.permanent
                ? 'Dein Konto wurde dauerhaft gesperrt. Du kannst dich nicht mehr anmelden.'
                : 'Dein Konto ist vorübergehend gesperrt. Du kannst dich derzeit nicht anmelden.'}
            </Text>

            {banned?.reason ? (
              <View style={styles.banBox}>
                <Text style={styles.banBoxLabel}>Grund</Text>
                <Text style={styles.banBoxValue}>{banned.reason}</Text>
              </View>
            ) : null}

            {!banned?.permanent && banned?.banned_until ? (
              <View style={styles.banBox}>
                <Text style={styles.banBoxLabel}>Dauer</Text>
                <Text style={styles.banBoxValue}>{formatTimeout(banned.banned_until)}</Text>
              </View>
            ) : null}

            <Pressable onPress={() => setBanned(null)} style={styles.banButton}>
              <Text style={styles.banButtonText}>Verstanden</Text>
            </Pressable>
            <Pressable onPress={onAppeal} hitSlop={8} style={styles.appealButton}>
              <Text style={styles.appealText}>Widerspruch einlegen</Text>
            </Pressable>
            <Text style={styles.appealHint}>
              Ein Mensch aus unserem Team sieht sich die Entscheidung dann noch einmal an.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  codeText: { fontSize: 14, lineHeight: 20, color: Brand.textMuted, fontFamily: FontFamily.regular, marginBottom: Spacing.two },
  codeHint: { fontSize: 12, lineHeight: 16, color: Brand.textMuted, fontFamily: FontFamily.regular, marginTop: -Spacing.one, marginBottom: Spacing.two },
  codeActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.three },
  disabledText: { opacity: 0.5 },
  appealButton: { marginTop: Spacing.three, paddingVertical: Spacing.one },
  appealText: { fontSize: 14, fontFamily: FontFamily.bold, color: Brand.purple, textAlign: 'center' },
  appealHint: { fontSize: 12, lineHeight: 16, fontFamily: FontFamily.regular, color: Brand.textMuted, textAlign: 'center', marginTop: Spacing.one },
  handleHitbox: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: Brand.handle,
  },
  handleText: {
    fontSize: 12,
    fontWeight: '600',
    color: Brand.textMuted,
    fontFamily: FontFamily.semibold,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.five,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
    // Luft nach oben, damit die Überschrift nicht am Griff klebt.
    paddingTop: Spacing.three,
  },
  title: {
    fontSize: 36,
    // Ohne großzügige Zeilenhöhe schneidet die Textbox die Ober- und
    // Unterlängen der fetten Schrift ab – die Überschrift wirkt gequetscht.
    lineHeight: 48,
    paddingHorizontal: Spacing.two,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
    fontFamily: FontFamily.bold,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: Brand.textMuted,
    fontFamily: FontFamily.medium,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    // Großzügiger Innenabstand: die Karte soll ruhig wirken, nicht knapp.
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#4f46e5',
        shadowOpacity: 0.12,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: Brand.text,
    fontFamily: FontFamily.bold,
    letterSpacing: -0.3,
    marginBottom: -Spacing.one,
  },
  generalError: {
    color: '#ef4444',
    textAlign: 'center',
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  rememberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rememberText: {
    color: Brand.text,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FontFamily.semibold,
  },
  forgotText: {
    color: Brand.purple,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FontFamily.semibold,
  },
  registerWrap: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  registerBtn: {
    alignSelf: 'stretch',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Brand.purple,
    backgroundColor: 'rgba(99,102,241,0.10)',
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerBtnText: {
    color: Brand.purple,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
  },
  muted: {
    color: Brand.textMuted,
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
  banBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  banCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  banEmoji: { fontSize: 44 },
  banTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Brand.text,
    textAlign: 'center',
    fontFamily: FontFamily.bold,
  },
  banText: {
    fontSize: 14,
    color: Brand.textMuted,
    textAlign: 'center',
    fontFamily: FontFamily.regular,
  },
  banBox: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(99,102,241,0.10)',
    borderRadius: 14,
    padding: Spacing.three,
    gap: 2,
  },
  banBoxLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: Brand.purple,
    textTransform: 'uppercase',
    fontFamily: FontFamily.bold,
  },
  banBoxValue: {
    fontSize: 15,
    color: Brand.text,
    fontWeight: '500',
    fontFamily: FontFamily.medium,
  },
  banButton: {
    alignSelf: 'stretch',
    marginTop: Spacing.two,
    borderRadius: 16,
    backgroundColor: Brand.purple,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  banButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
  },
});
