import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { GoennBackground } from '@/components/goenn-background';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { PasswordMeter } from '@/components/ui/password-meter';
import { TextField } from '@/components/ui/text-field';
import { Brand, FontFamily, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { isEmailAddress } from '@/domain/email';
import { normalizeResetCode, RESET_RESEND_SECONDS, resetFormProblem } from '@/domain/reset-code';
import { api, ApiError } from '@/lib/api';
import { peekResetEmail, peekResetJustSent } from '@/lib/password-reset-draft';

/**
 * Set a new password with the code from the "Passwort vergessen" mail (F-09). Signed out, after
 * (auth)/forgot-password; there is no reset link and no deep link into this screen.
 *
 * The server checks the code (six digits, ten minutes, five attempts, then a new one is needed)
 * and answers a wrong, expired or used code and an unknown address alike, so this screen cannot
 * tell them apart either. A successful reset signs out every device; the person then signs in
 * with the new password. "Code erneut senden" asks for a new mail (the server sends at most one
 * a minute per account; the countdown here only mirrors that).
 */
export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState(() => peekResetEmail());
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  /** Seconds until "Code erneut senden" works again (right after a mail: the server's minute). */
  const [resendIn, setResendIn] = useState(() => (peekResetJustSent() ? RESET_RESEND_SECONDS : 0));

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const mismatch = repeat.length > 0 && repeat !== password;

  function showError(error: unknown) {
    if (error instanceof ApiError && Object.keys(error.errors).length > 0) {
      setErrors(error.errors);
    } else if (error instanceof ApiError) {
      setGeneralError(error.firstError());
    } else {
      setGeneralError('Etwas ist schiefgelaufen. Bitte versuch es später erneut.');
    }
  }

  async function onSubmit() {
    const problem = resetFormProblem({ email, code, password, repeat });
    if (problem) {
      setErrors({ [problem.field]: [problem.message] });
      return;
    }
    setErrors({});
    setGeneralError(null);
    setNotice(null);
    setLoading(true);
    try {
      await api.resetPassword({
        email: email.trim(),
        code: normalizeResetCode(code) ?? '',
        password,
        password_confirmation: repeat,
      });
      setDone(true);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (resendIn > 0) return;
    if (!isEmailAddress(email.trim())) {
      setErrors({ email: ['Bitte gib eine gültige E-Mail-Adresse ein.'] });
      return;
    }
    setErrors({});
    setGeneralError(null);
    try {
      const res = await api.forgotPassword(email.trim());
      setResendIn(RESET_RESEND_SECONDS);
      setNotice(res.message);
    } catch (error) {
      showError(error);
    }
  }

  return (
    <GoennBackground>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerTransparent: true,
          headerBackTitle: 'Zurück',
          headerTintColor: Brand.purple,
        }}
      />
      <View style={styles.flex}>
        <KeyboardForm
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.five },
          ]}>
          <View style={styles.header}>
            <Text style={styles.subheading}>Fast geschafft</Text>
            <BrandGradientText style={styles.heading}>Neues Passwort</BrandGradientText>
            <Text style={styles.lead}>
              Falls ein Konto zu dieser Adresse existiert, haben wir dir einen 6-stelligen Code
              geschickt. Gib ihn hier mit deinem neuen Passwort ein.
            </Text>
          </View>

          <View style={styles.card}>
            {done ? (
              <View style={styles.doneBox}>
                <Text style={styles.doneTitle}>Passwort geändert</Text>
                <Text style={styles.doneText}>
                  Du kannst dich jetzt mit deinem neuen Passwort anmelden.
                </Text>
                <BrandButton title="Zum Login" onPress={() => router.replace('/')} />
              </View>
            ) : (
              <>
                {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}
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
                  label="Code"
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={7}
                  leftIcon={<LockIcon />}
                  error={errors.code?.[0]}
                />
                <TextField
                  label="Neues Passwort"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  leftIcon={<LockIcon />}
                  error={errors.password?.[0]}
                />
                <PasswordMeter password={password} personal={[email.trim()]} />
                <TextField
                  label="Neues Passwort wiederholen"
                  value={repeat}
                  onChangeText={setRepeat}
                  secureTextEntry
                  autoComplete="new-password"
                  leftIcon={<LockIcon />}
                  error={
                    errors.repeat?.[0] ??
                    errors.password_confirmation?.[0] ??
                    (mismatch ? 'Die beiden Passwörter sind nicht gleich.' : undefined)
                  }
                />
                <BrandButton title="Passwort ändern" onPress={onSubmit} loading={loading} />
                <Pressable onPress={onResend} disabled={resendIn > 0} hitSlop={8} style={styles.resendRow}>
                  <Text style={[styles.link, resendIn > 0 && styles.disabledText]}>
                    {resendIn > 0 ? `Neuer Code in ${resendIn} s` : 'Code erneut senden'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          <Pressable onPress={() => router.replace('/')} style={styles.loginRow}>
            <Text style={styles.muted}>Doch wieder eingefallen? </Text>
            <Text style={styles.link}>Zum Login</Text>
          </Pressable>
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
  lead: {
    marginTop: Spacing.two,
    fontSize: 14,
    color: Brand.textMuted,
    textAlign: 'center',
    fontFamily: FontFamily.regular,
  },
  card: {
    backgroundColor: Brand.card,
    borderRadius: Radius.panel,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  doneBox: {
    gap: Spacing.three,
    alignItems: 'center',
  },
  doneTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Brand.text,
    fontFamily: FontFamily.bold,
  },
  doneText: {
    fontSize: 14,
    color: Brand.textMuted,
    textAlign: 'center',
    fontFamily: FontFamily.regular,
  },
  generalError: {
    color: '#ef4444',
    textAlign: 'center',
  },
  notice: {
    color: Brand.textMuted,
    fontSize: 14,
    textAlign: 'center',
    fontFamily: FontFamily.regular,
  },
  resendRow: {
    alignSelf: 'center',
  },
  disabledText: {
    opacity: 0.5,
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
});
