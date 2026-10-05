import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthIllustration } from '@/components/auth-illustration';
import { BrandGradientText } from '@/components/brand-gradient-text';
import { GoennBackground } from '@/components/goenn-background';
import { InterestPicker, type InterestPickerPalette } from '@/components/interest-picker';
import { BrandButton } from '@/components/ui/brand-button';
import { AtIcon, CheckIcon, DotIcon, LockIcon, MailIcon, UserIcon } from '@/components/ui/icons';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { PasswordMeter } from '@/components/ui/password-meter';
import { TextField } from '@/components/ui/text-field';
import { MIN_AGE } from '@/constants/operator';
import { Brand, MaxContentWidth, Spacing, FontFamily, Radius } from '@/constants/theme';
import { LEGAL_VERSION } from '@/domain/legal';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { blockedTermMessage } from '@/lib/blocked-terms';
import { passwordStrength } from '@/lib/password-strength';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

/** Mindestanzahl Interessen für ein vollständiges Profil (Backend verlangt ≥ 3). */
const MIN_INTERESTS = 3;

/** Chip-Farben passend zum hellen Auth-Look. */
const INTEREST_PALETTE: InterestPickerPalette = {
  chipBg: '#ffffff',
  chipBorder: Brand.inputBorder,
  chipText: Brand.text,
  activeBg: 'rgba(99,102,241,0.10)',
  activeBorder: Brand.purple,
  activeText: Brand.purple,
  muted: Brand.textMuted,
};

/** Eine Anforderungszeile: grünes Häkchen wenn erfüllt, sonst grauer Punkt. */
function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.reqRow}>
      {ok ? <CheckIcon /> : <DotIcon />}
      <Text style={[styles.reqText, ok && styles.reqTextOk]}>{label}</Text>
    </View>
  );
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [interests, setInterests] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  /**
   * Zustimmung zu Nutzungsbedingungen und Datenschutz.
   *
   * Ein Haken, den man setzen MUSS – und bewusst kein vorausgefüllter: Eine
   * Einwilligung, die schon gesetzt ist, wenn man auf die Seite kommt, ist keine.
   * Deshalb hängt `formValid` daran, und der Knopf bleibt bis dahin aus.
   */
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Live-Prüfung – exakt nach den Backend-Regeln (RegisterRequest).
  const checks = useMemo(() => {
    const u = username.trim();
    const p = password;
    return {
      nameOk: name.trim().length > 0,
      // Beleidigungen, Rassismus, Nazi-Codes – dieselbe Liste wie am Server
      // (shared/blocked-terms.json). Hier nur, damit man es beim Tippen sieht und
      // nicht erst nach dem Absenden; ablehnen tut der Server ohnehin.
      nameBlocked: blockedTermMessage(name, 'name'),
      userBlocked: blockedTermMessage(u, 'username'),
      userLenOk: u.length >= 3 && u.length <= 30,
      userCharsOk: u.length > 0 && USERNAME_RE.test(u),
      emailOk: EMAIL_RE.test(email.trim()),
      // Dieselbe Regel wie am Server (Länge, Buchstaben + Zahl, keine Liste häufiger
      // Passwörter, kein Benutzername darin) – siehe src/domain/password-strength.ts.
      passOk: passwordStrength(p, [u, email.trim(), name.trim()]).meetsPolicy,
    };
  }, [name, username, email, password]);

  const interestsOk = interests.length >= MIN_INTERESTS;

  const formValid =
    checks.nameOk &&
    !checks.nameBlocked &&
    !checks.userBlocked &&
    checks.userLenOk &&
    checks.userCharsOk &&
    checks.emailOk &&
    checks.passOk &&
    interestsOk &&
    acceptedTerms;

  async function onSubmit() {
    setLoading(true);
    setErrors({});
    setGeneralError(null);
    try {
      await register({
        name: name.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
        interests,
        // Der Stand, dem tatsächlich zugestimmt wurde. Nicht bloß ein „ja":
        // Nur mit der Version lässt sich nach einer Änderung erkennen, wer noch
        // dem alten Text zugestimmt hat (siehe src/domain/legal.ts).
        terms_version: LEGAL_VERSION,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.errors);
        if (Object.keys(error.errors).length === 0) setGeneralError(error.firstError());
      } else {
        setGeneralError('Unbekannter Fehler.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <GoennBackground>
      <Stack.Screen options={{ headerShown: true, title: '', headerTransparent: true, headerBackTitle: 'Zurück', headerTintColor: Brand.purple }} />
      {/* Tastatur-Freistellung macht `KeyboardForm` (siehe dort: RNs
          KeyboardAvoidingView war ohne `behavior` wirkungslos und mit `padding`
          instabil). */}
      <View style={styles.flex}>
        <KeyboardForm
          contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.five }]}>
          <View style={styles.header}>
            <Text style={styles.subheading}>Schön, dass du dabei bist</Text>
            <BrandGradientText style={styles.heading}>Konto erstellen</BrandGradientText>
          </View>

          <View style={styles.card}>
            {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

            <TextField label="Name" value={name} onChangeText={setName} placeholder="Dein Name" autoComplete="name" leftIcon={<UserIcon />} error={errors.name?.[0] ?? checks.nameBlocked ?? undefined} />

            <View>
              <TextField label="Benutzername" value={username} onChangeText={setUsername} placeholder="benutzername" autoCapitalize="none" autoComplete="username" leftIcon={<AtIcon />} error={errors.username?.[0] ?? checks.userBlocked ?? undefined} />
              {username.length > 0 && !(checks.userLenOk && checks.userCharsOk) ? (
                <View style={styles.reqs}>
                  <Requirement ok={checks.userLenOk} label="3 bis 30 Zeichen" />
                  <Requirement ok={checks.userCharsOk} label="Nur Buchstaben, Zahlen, - und _" />
                </View>
              ) : null}
            </View>

            <TextField label="E-Mail" value={email} onChangeText={setEmail} placeholder="beispiel@email.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" leftIcon={<MailIcon />} error={errors.email?.[0]} />

            <View>
              <TextField label="Passwort" value={password} onChangeText={setPassword} placeholder="Passwort wählen" secureTextEntry autoComplete="new-password" leftIcon={<LockIcon />} error={errors.password?.[0]} />
              {/* Stärke statt Checkliste: Die Liste sagte nur „8 Zeichen, Buchstaben und
                  Zahlen" – und hielt damit „Passwort1" für in Ordnung. */}
              <PasswordMeter password={password} personal={[username.trim(), email.trim(), name.trim()]} />

            </View>

            <View>
              <Text style={styles.typeLabel}>Interessen</Text>
              <Text style={styles.interestHint}>
                Wähle mindestens {MIN_INTERESTS} aus – so schlagen wir dir passende Angebote vor.
              </Text>
              <InterestPicker value={interests} onChange={setInterests} palette={INTEREST_PALETTE} />
              {interests.length > 0 && !interestsOk ? (
                <Text style={styles.interestHint}>
                  Noch {MIN_INTERESTS - interests.length} auswählen.
                </Text>
              ) : null}
              {errors.interests?.[0] ? <Text style={styles.generalError}>{errors.interests[0]}</Text> : null}
            </View>

            {/* Zustimmung. Steht direkt über dem Knopf, weil genau dort die
                Entscheidung fällt – und die Links führen in die App und nicht in
                den Browser, damit man den Text lesen kann, ohne die
                Registrierung zu verlieren (siehe src/app/legal.tsx). */}
            <Pressable
              onPress={() => setAcceptedTerms((prev) => !prev)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedTerms }}
              accessibilityLabel="Nutzungsbedingungen und Datenschutz akzeptieren"
              style={styles.consentRow}>
              <View style={[styles.checkbox, acceptedTerms && styles.checkboxOn]}>
                {acceptedTerms ? <CheckIcon size={14} color="#ffffff" /> : null}
              </View>
              <Text style={styles.consentText}>
                Ich habe die{' '}
                <Text
                  style={styles.link}
                  onPress={() => router.push({ pathname: '/legal', params: { doc: 'terms' } })}>
                  Nutzungsbedingungen
                </Text>
                {' '}und den{' '}
                <Text
                  style={styles.link}
                  onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}>
                  Datenschutz
                </Text>
                {' '}gelesen. Mir ist klar, dass die Aktivitäten von unseren Partnern durchgeführt werden und
                die Teilnahme auf eigene Verantwortung erfolgt (
                <Text
                  style={styles.link}
                  onPress={() => router.push({ pathname: '/legal', params: { doc: 'liability' } })}>
                  Haftung
                </Text>
                ). Ich bin mindestens {MIN_AGE} Jahre alt.
              </Text>
            </Pressable>

            <BrandButton title="Konto erstellen" onPress={onSubmit} loading={loading} disabled={!formValid} />
          </View>

          <Pressable onPress={() => router.replace('/')} style={styles.loginRow}>
            <Text style={styles.muted}>Schon ein Konto? </Text>
            <Text style={styles.link}>Zum Login</Text>
          </Pressable>

          <View style={styles.illustration}>
            <AuthIllustration />
          </View>
        </KeyboardForm>
      </View>
    </GoennBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  subheading: {
    fontSize: 14,
    color: Brand.textMuted,
    marginBottom: Spacing.one,
    fontFamily: FontFamily.regular,
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: FontFamily.bold,
  },
  card: {
    backgroundColor: Brand.card,
    borderRadius: Radius.panel,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  generalError: {
    color: '#ef4444',
    textAlign: 'center',
  },
  reqs: {
    marginTop: Spacing.two,
    marginLeft: Spacing.one,
    gap: Spacing.one,
  },
  reqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  reqText: {
    fontSize: 13,
    color: Brand.textMuted,
    fontFamily: FontFamily.regular,
  },
  reqTextOk: {
    color: '#16a34a',
  },
  typeLabel: {
    marginLeft: Spacing.one,
    marginBottom: Spacing.two,
    fontSize: 13,
    fontWeight: '700',
    color: Brand.textMuted,
    fontFamily: FontFamily.bold,
  },
  interestHint: {
    marginLeft: Spacing.one,
    marginBottom: Spacing.two,
    fontSize: 13,
    color: Brand.textMuted,
    fontFamily: FontFamily.regular,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.four,
    flexWrap: 'wrap',
  },
  muted: {
    color: Brand.textMuted,
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
  link: {
    color: Brand.purple,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
  },
  /** Zustimmungszeile: Haken links, Text rechts – der ganze Bereich ist antippbar. */
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Brand.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    // Zwei Pixel nach unten: Damit der Haken auf der ersten Textzeile sitzt und
    // nicht darüber schwebt.
    marginTop: 2,
  },
  checkboxOn: {
    backgroundColor: Brand.purple,
    borderColor: Brand.purple,
  },
  consentText: {
    flex: 1,
    color: Brand.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FontFamily.regular,
  },
  illustration: {
    marginTop: Spacing.five,
    alignItems: 'center',
    opacity: 0.9,
  },
});
