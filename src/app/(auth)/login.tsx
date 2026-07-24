import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function onSubmit() {
    setLoading(true);
    setErrors({});
    setGeneralError(null);
    try {
      await login(email.trim(), password);
      // Erfolg → der Auth-Gate im Root-Layout wechselt automatisch zur App.
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
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: 'Zurück' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle" style={[styles.heading, { color: theme.tint }]}>
            Willkommen zurück!
          </ThemedText>

          {generalError ? (
            <ThemedText type="small" style={styles.generalError}>
              {generalError}
            </ThemedText>
          ) : null}

          <View style={styles.form}>
            <TextField
              label="E-Mail"
              value={email}
              onChangeText={setEmail}
              placeholder="beispiel@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              error={errors.email?.[0]}
            />
            <TextField
              label="Passwort"
              value={password}
              onChangeText={setPassword}
              placeholder="Dein Passwort"
              secureTextEntry
              autoComplete="current-password"
              error={errors.password?.[0]}
            />

            <PrimaryButton title="Anmelden" onPress={onSubmit} loading={loading} />
          </View>

          <View style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              Du hast noch kein Konto?
            </ThemedText>
            <Link href="/register">
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Jetzt registrieren
              </ThemedText>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  heading: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
  form: {
    gap: Spacing.three,
  },
  footer: {
    marginTop: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
  },
  generalError: {
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
});
