import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthIllustration } from '@/components/auth-illustration';
import { BrandGradientText } from '@/components/brand-gradient-text';
import { GoennBackground } from '@/components/goenn-background';
import { BrandButton } from '@/components/ui/brand-button';
import { BrandTextField } from '@/components/ui/brand-text-field';
import { AtIcon, CheckIcon, DotIcon, LockIcon, MailIcon, UserIcon } from '@/components/ui/icons';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { ApiError, type AccountType } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'personal', label: 'Persönlich' },
  { value: 'business', label: 'Business' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

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
  const [accountType, setAccountType] = useState<AccountType>('personal');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Live-Prüfung – exakt nach den Backend-Regeln (RegisterRequest).
  const checks = useMemo(() => {
    const u = username.trim();
    const p = password;
    return {
      nameOk: name.trim().length > 0,
      userLenOk: u.length >= 3 && u.length <= 30,
      userCharsOk: u.length > 0 && USERNAME_RE.test(u),
      emailOk: EMAIL_RE.test(email.trim()),
      passLenOk: p.length >= 8,
      passMixOk: /[A-Za-z]/.test(p) && /\d/.test(p),
    };
  }, [name, username, email, password]);

  const formValid =
    checks.nameOk &&
    checks.userLenOk &&
    checks.userCharsOk &&
    checks.emailOk &&
    checks.passLenOk &&
    checks.passMixOk;

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
        account_type: accountType,
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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.five }]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.subheading}>Schön, dass du dabei bist</Text>
            <BrandGradientText style={styles.heading}>Konto erstellen</BrandGradientText>
          </View>

          <View style={styles.card}>
            {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

            <BrandTextField label="Name" value={name} onChangeText={setName} placeholder="Dein Name" autoComplete="name" leftIcon={<UserIcon />} error={errors.name?.[0]} />

            <View>
              <BrandTextField label="Benutzername" value={username} onChangeText={setUsername} placeholder="benutzername" autoCapitalize="none" autoComplete="username" leftIcon={<AtIcon />} error={errors.username?.[0]} />
              {username.length > 0 && !(checks.userLenOk && checks.userCharsOk) ? (
                <View style={styles.reqs}>
                  <Requirement ok={checks.userLenOk} label="3 bis 30 Zeichen" />
                  <Requirement ok={checks.userCharsOk} label="Nur Buchstaben, Zahlen, - und _" />
                </View>
              ) : null}
            </View>

            <BrandTextField label="E-Mail" value={email} onChangeText={setEmail} placeholder="beispiel@email.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" leftIcon={<MailIcon />} error={errors.email?.[0]} />

            <View>
              <BrandTextField label="Passwort" value={password} onChangeText={setPassword} placeholder="Passwort wählen" secureTextEntry autoComplete="new-password" leftIcon={<LockIcon />} error={errors.password?.[0]} />
              {password.length > 0 && !(checks.passLenOk && checks.passMixOk) ? (
                <View style={styles.reqs}>
                  <Requirement ok={checks.passLenOk} label="Mindestens 8 Zeichen" />
                  <Requirement ok={checks.passMixOk} label="Buchstaben und Zahlen" />
                </View>
              ) : null}
            </View>

            <View>
              <Text style={styles.typeLabel}>Konto-Typ</Text>
              <View style={styles.typeRow}>
                {ACCOUNT_TYPES.map((type) => {
                  const selected = accountType === type.value;
                  return (
                    <Pressable
                      key={type.value}
                      onPress={() => setAccountType(type.value)}
                      style={[
                        styles.typeOption,
                        {
                          borderColor: selected ? Brand.purple : Brand.inputBorder,
                          backgroundColor: selected ? '#f5f3ff' : Brand.inputBg,
                        },
                      ]}>
                      <Text style={[styles.typeText, { color: selected ? Brand.purple : Brand.text }]}>{type.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {errors.account_type?.[0] ? <Text style={styles.generalError}>{errors.account_type[0]}</Text> : null}
            </View>

            <BrandButton title="Konto erstellen" onPress={onSubmit} loading={loading} disabled={!formValid} />
          </View>

          <Pressable onPress={() => router.replace('/')} style={styles.loginRow}>
            <Text style={styles.muted}>Schon ein Konto? </Text>
            <Text style={styles.link}>Zum Login</Text>
          </Pressable>

          <View style={styles.illustration}>
            <AuthIllustration />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  card: {
    backgroundColor: Brand.card,
    borderRadius: 24,
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
  },
  typeRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  typeOption: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  typeText: {
    fontSize: 15,
    fontWeight: '700',
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
  },
  link: {
    color: Brand.purple,
    fontSize: 14,
    fontWeight: '700',
  },
  illustration: {
    marginTop: Spacing.five,
    alignItems: 'center',
    opacity: 0.9,
  },
});
