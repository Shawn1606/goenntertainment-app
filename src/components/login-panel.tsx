import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { BrandButton } from '@/components/ui/brand-button';
import { BrandTextField } from '@/components/ui/brand-text-field';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { clearCredentials, loadCredentials, saveCredentials } from '@/lib/credential-store';

type Props = {
  /** true, wenn der Login-Screen aktuell sichtbar ist (löst das Vorausfüllen aus). */
  active: boolean;
  /** Zurück zum Start-Screen. */
  onBack: () => void;
};

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

  function notYet() {
    Alert.alert('Kommt bald', 'Diese Funktion ist noch nicht fertig.');
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Griff oben: tippen führt zurück zum Start-Screen. */}
      <Pressable onPress={onBack} hitSlop={16} style={[styles.handleHitbox, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.handle} />
        <Text style={styles.handleText}>Startseite</Text>
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <BrandGradientText style={styles.title}>Willkommen zurück!</BrandGradientText>
          <Text style={styles.subtitle}>Schön, dich wiederzusehen 💜</Text>
        </View>

        <View style={styles.card}>
          {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

          <BrandTextField
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
          <BrandTextField
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

        <Pressable onPress={() => router.push('/register')} style={styles.registerRow}>
          <Text style={styles.muted}>Du hast noch kein Konto? </Text>
          <Text style={styles.link}>Jetzt registrieren</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.five,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: Brand.textMuted,
  },
  card: {
    backgroundColor: Brand.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    padding: Spacing.four,
    gap: Spacing.four,
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#7c3aed',
        shadowOpacity: 0.12,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
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
  },
  forgotText: {
    color: Brand.purple,
    fontSize: 13,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(155,109,255,0.25)',
  },
  googleBtn: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(155,109,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  googleText: {
    color: Brand.text,
    fontSize: 15,
    fontWeight: '600',
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
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
