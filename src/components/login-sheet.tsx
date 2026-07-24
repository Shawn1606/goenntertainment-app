import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { BrandButton } from '@/components/ui/brand-button';
import { BrandTextField } from '@/components/ui/brand-text-field';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { Brand, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { clearCredentials, loadCredentials, saveCredentials } from '@/lib/credential-store';

type Props = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Login-Sheet, das von unten hochfährt – das „Overlay" der alten Web-Startseite.
 * Enthält das Login-Formular; Registrieren führt auf die eigene Seite.
 */
export function LoginSheet({ visible, onClose }: Props) {
  const router = useRouter();
  const { login } = useAuth();
  const { height: screenHeight } = useWindowDimensions();

  const [sheetHeight, setSheetHeight] = useState(screenHeight * 0.7);
  const translateY = useRef(new Animated.Value(screenHeight)).current;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Gespeicherte Zugangsdaten beim ersten Öffnen vorausfüllen.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    (async () => {
      const saved = await loadCredentials();
      if (active && saved) {
        setEmail(saved.email);
        setPassword(saved.password);
        setRemember(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [visible]);

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : sheetHeight,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible, sheetHeight, translateY]);

  const backdropOpacity = translateY.interpolate({
    inputRange: [0, sheetHeight],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  async function onSubmit() {
    setLoading(true);
    setErrors({});
    setGeneralError(null);
    try {
      await login(email.trim(), password);
      // Nach erfolgreichem Login: Zugangsdaten speichern oder löschen.
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

  function goRegister() {
    onClose();
    router.push('/register');
  }

  function goForgotPassword() {
    onClose();
    router.push('/forgot-password');
  }

  function notYet() {
    Alert.alert('Kommt bald', 'Diese Funktion ist noch nicht fertig.');
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
        style={[styles.sheet, { transform: [{ translateY }] }]}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.handleHitbox}>
          <View style={styles.handle} />
        </Pressable>

        <BrandGradientText style={styles.title}>Willkommen zurück!</BrandGradientText>

        {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

        <View style={styles.form}>
          <BrandTextField
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

            <Pressable onPress={goForgotPassword} hitSlop={8}>
              <Text style={styles.forgotText}>Passwort vergessen?</Text>
            </Pressable>
          </View>

          <BrandButton title="Anmelden" onPress={onSubmit} loading={loading} />
        </View>

        <Pressable onPress={goRegister} style={styles.registerRow}>
          <Text style={styles.muted}>Du hast kein Account? </Text>
          <Text style={styles.link}>Jetzt Registrieren</Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.muted}>oder</Text>
          <View style={styles.line} />
        </View>

        <Pressable onPress={notYet} style={styles.googleBtn}>
          <Text style={styles.googleText}>Mit Google anmelden</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
    ...Platform.select({
      android: { elevation: 12 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
      },
    }),
  },
  handleHitbox: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: Brand.handle,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  generalError: {
    color: '#ef4444',
    textAlign: 'center',
  },
  form: {
    gap: Spacing.three,
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  googleBtn: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  googleText: {
    color: Brand.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
