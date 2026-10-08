import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { GoennBackground } from '@/components/goenn-background';
import { BrandButton } from '@/components/ui/brand-button';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { MailIcon } from '@/components/ui/icons';
import { Brand, MaxContentWidth, Spacing, FontFamily, Radius } from '@/constants/theme';
import { isEmailAddress } from '@/domain/email';
import { api, ApiError } from '@/lib/api';
import { rememberResetEmail } from '@/lib/password-reset-draft';

/**
 * „Passwort vergessen": schickt die E-Mail ans Backend (/api/forgot-password). The server mails a
 * 6-digit code to the account's address (F-09; no reset link, no deep link), and the next screen,
 * (auth)/reset-password, takes the code and the new password. Die API verrät nicht, ob die
 * Adresse existiert: the next screen opens either way and says so neutrally.
 *
 * The address goes to the next screen in memory (src/lib/password-reset-draft.ts), not as a route
 * parameter: on the web that would put it into the URL.
 */
export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!isEmailAddress(email.trim())) {
      setError('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      rememberResetEmail(email, true);
      router.push('/reset-password');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.firstError()
          : 'Etwas ist schiefgelaufen. Bitte versuch es später erneut.',
      );
    }
    setLoading(false);
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
      {/* `KeyboardForm` statt `ScrollView` + `KeyboardAvoidingView`: stellt die
          Tastatur selbst frei (siehe dort – RNs KAV war in beiden Betriebsarten
          defekt). */}
      <View style={styles.flex}>
        <KeyboardForm
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.five },
          ]}>
          <View style={styles.header}>
            <Text style={styles.subheading}>Kein Problem</Text>
            <BrandGradientText style={styles.heading}>Passwort vergessen?</BrandGradientText>
            <Text style={styles.lead}>
              Gib deine E-Mail-Adresse ein. Wir schicken dir einen Code zum Zurücksetzen.
            </Text>
          </View>

          <View style={styles.card}>
            <TextField
              label="E-Mail"
              value={email}
              onChangeText={setEmail}
              placeholder="beispiel@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              leftIcon={<MailIcon />}
              error={error ?? undefined}
            />
            <BrandButton title="Code senden" onPress={onSubmit} loading={loading} />
          </View>

          <Pressable
            onPress={() => {
              rememberResetEmail(email);
              router.push('/reset-password');
            }}
            style={styles.loginRow}>
            <Text style={styles.muted}>Du hast schon einen Code? </Text>
            <Text style={styles.link}>Code eingeben</Text>
          </Pressable>

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
