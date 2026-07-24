import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type AccountType } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'personal', label: 'Persönlich' },
  { value: 'business', label: 'Business' },
];

export default function RegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('personal');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

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
      // Erfolg → Auth-Gate wechselt automatisch in die App.
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
          <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
            Schön, dass du dabei bist
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.heading, { color: theme.tint }]}>
            Konto erstellen
          </ThemedText>

          {generalError ? (
            <ThemedText type="small" style={styles.generalError}>
              {generalError}
            </ThemedText>
          ) : null}

          <View style={styles.form}>
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Dein Name"
              autoComplete="name"
              error={errors.name?.[0]}
            />
            <TextField
              label="Benutzername"
              value={username}
              onChangeText={setUsername}
              placeholder="benutzername"
              autoCapitalize="none"
              autoComplete="username"
              error={errors.username?.[0]}
            />
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
              placeholder="Min. 8 Zeichen, Buchstaben & Zahlen"
              secureTextEntry
              autoComplete="new-password"
              error={errors.password?.[0]}
            />

            <View>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.typeLabel}>
                Konto-Typ
              </ThemedText>
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
                          backgroundColor: selected ? theme.tint : theme.backgroundElement,
                          borderColor: selected ? theme.tint : 'transparent',
                        },
                      ]}>
                      <ThemedText
                        type="smallBold"
                        style={{ color: selected ? theme.tintText : theme.text }}>
                        {type.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              {errors.account_type?.[0] ? (
                <ThemedText type="small" style={styles.generalError}>
                  {errors.account_type[0]}
                </ThemedText>
              ) : null}
            </View>

            <PrimaryButton title="Konto erstellen" onPress={onSubmit} loading={loading} />
          </View>

          <View style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              Schon ein Konto?
            </ThemedText>
            <Link href="/login">
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Zum Login
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
  subheading: {
    textAlign: 'center',
  },
  heading: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
  form: {
    gap: Spacing.three,
  },
  typeLabel: {
    marginLeft: Spacing.one,
    marginBottom: Spacing.one,
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
  footer: {
    marginTop: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
  },
  generalError: {
    color: '#EF4444',
    textAlign: 'center',
    marginTop: Spacing.one,
  },
});
