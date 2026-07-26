import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { GoennBackground } from '@/components/goenn-background';
import { BrandButton } from '@/components/ui/brand-button';
import { BrandTextField } from '@/components/ui/brand-text-field';
import { MailIcon } from '@/components/ui/icons';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * „Passwort vergessen": schickt die E-Mail ans Backend (/api/forgot-password) und
 * bestätigt den Versand neutral. Die API verrät nicht, ob die Adresse existiert;
 * der eigentliche Mail-Versand (SMTP) ist im Backend noch ein eigenes Ticket.
 */
export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.firstError()
          : 'Etwas ist schiefgelaufen. Bitte versuch es später erneut.',
      );
    } finally {
      setLoading(false);
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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.five },
          ]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.subheading}>Kein Problem</Text>
            <BrandGradientText style={styles.heading}>Passwort vergessen?</BrandGradientText>
            <Text style={styles.lead}>
              Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link zum Zurücksetzen.
            </Text>
          </View>

          <View style={styles.card}>
            {sent ? (
              <View style={styles.sentBox}>
                <Text style={styles.sentTitle}>E-Mail unterwegs 📬</Text>
                <Text style={styles.sentText}>
                  Falls ein Konto zu {email.trim()} existiert, findest du gleich einen Link zum
                  Zurücksetzen in deinem Postfach.
                </Text>
                <BrandButton title="Zurück zum Login" onPress={() => router.replace('/')} />
              </View>
            ) : (
              <>
                <BrandTextField
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
                <BrandButton title="Link senden" onPress={onSubmit} loading={loading} />
              </>
            )}
          </View>

          <Pressable onPress={() => router.replace('/')} style={styles.loginRow}>
            <Text style={styles.muted}>Doch wieder eingefallen? </Text>
            <Text style={styles.link}>Zum Login</Text>
          </Pressable>
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
  lead: {
    marginTop: Spacing.two,
    fontSize: 14,
    color: Brand.textMuted,
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
  sentBox: {
    gap: Spacing.three,
    alignItems: 'center',
  },
  sentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Brand.text,
  },
  sentText: {
    fontSize: 14,
    color: Brand.textMuted,
    textAlign: 'center',
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
});
