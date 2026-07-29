import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { Icon } from '@/components/ui/icon';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { Brand, MaxContentWidth, Spacing, FontFamily } from '@/constants/theme';
import { ApiError, type BanInfo } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { clearCredentials, loadCredentials, saveCredentials } from '@/lib/credential-store';

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
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  // Sperr-Info fürs Popup (Grund + Dauer), wenn der Login mit 403 gesperrt zurückkommt.
  const [banned, setBanned] = useState<BanInfo | null>(null);

  // Gespeicherte Zugangsdaten vorausfüllen, sobald der Login sichtbar wird.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      const saved = await loadCredentials();
      if (alive && saved) {
        setEmail(saved.email);
        setPassword(saved.password);
        setRemember(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [active]);

  async function onSubmit() {
    setLoading(true);
    setErrors({});
    setGeneralError(null);
    try {
      await login(email.trim(), password);
      if (remember) {
        await saveCredentials({ email: email.trim(), password });
      } else {
        await clearCredentials();
      }
      // Erfolg → der Auth-Gate wechselt automatisch in die App.
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.body?.ban) {
        // Gesperrtes Konto → Popup mit Grund + Dauer.
        setBanned(error.body.ban);
      } else if (error instanceof ApiError) {
        setErrors(error.errors);
        if (Object.keys(error.errors).length === 0) setGeneralError(error.firstError());
      } else {
        setGeneralError('Unbekannter Fehler.');
      }
    } finally {
      setLoading(false);
    }
  }

  function notYet() {
    Alert.alert('Kommt bald', 'Diese Funktion ist noch nicht fertig.');
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
              <Text style={styles.rememberText}>Passwort speichern</Text>
            </View>

            <Pressable onPress={() => router.push('/forgot-password')} hitSlop={8}>
              <Text style={styles.forgotText}>Passwort vergessen?</Text>
            </Pressable>
          </View>

          <BrandButton title="Anmelden" onPress={onSubmit} loading={loading} />
        </View>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.muted}>oder</Text>
          <View style={styles.line} />
        </View>

        <Pressable onPress={notYet} style={styles.googleBtn}>
          <Text style={styles.googleText}>Mit Google anmelden</Text>
        </Pressable>

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
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(99,102,241,0.18)',
  },
  googleBtn: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(99,102,241,0.30)',
    backgroundColor: 'rgba(255,255,255,0.9)',
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleText: {
    color: Brand.text,
    fontSize: 15,
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
