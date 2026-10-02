import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { SecurityNote, SecurityScreen } from '@/components/security/security-screen';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { TextField } from '@/components/ui/text-field';
import { FontFamily } from '@/constants/theme';
import { isEmailAddress } from '@/domain/email';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import { loadSavedEmail, saveEmail } from '@/lib/credential-store';

/**
 * E-Mail-Adresse ändern – mit dem aktuellen Passwort, bei Zwei-Faktor dazu mit dem Code.
 *
 * Die Adresse ist der Weg zurück ins Konto (Passwort vergessen, Codes per E-Mail). Wer sie
 * ändern kann, kann das Konto übernehmen – deshalb reicht die Anmeldung allein nicht (F-04).
 * Danach meldet der Server alle anderen Geräte ab und schickt einen Hinweis an die bisherige
 * Adresse; geht der nicht raus, bleibt alles beim Alten.
 */
export default function ChangeEmailScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { token, user, applyUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const method = user?.two_factor_method ?? null;
  const canSave = isEmailAddress(email.trim()) && password.length > 0 && (!method || code.trim().length > 0) && !saving;

  /** E-Mail-Methode: den Code an die BISHERIGE Adresse schicken lassen. */
  async function sendCode() {
    if (!token) return;
    setSending(true);
    try {
      const res = await api.twoFactorSendCode(token);
      await notifyUser('Code unterwegs', `Wir haben dir einen Code an ${res.destination} geschickt.`);
    } catch (e) {
      setErrors({ code: [e instanceof ApiError ? e.firstError() : 'Unbekannter Fehler.'] });
    } finally {
      setSending(false);
    }
  }

  async function onSave() {
    if (!token || !canSave) return;
    const previous = user?.email ?? null;
    setSaving(true);
    setErrors({});
    try {
      const res = await api.changeEmail(token, {
        email: email.trim(),
        current_password: password,
        ...(method ? { code: code.trim() } : {}),
      });
      applyUser(res.user);
      // Die gemerkte Adresse mitziehen, wenn dieses Gerät die bisherige gemerkt hatte.
      if (previous && (await loadSavedEmail()) === previous) await saveEmail(res.user.email);
      await notifyUser('E-Mail-Adresse geändert', 'Deine neue Adresse gilt ab sofort. Andere Geräte wurden abgemeldet.');
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(Object.keys(e.errors).length ? e.errors : { email: [e.firstError()] });
      } else {
        setErrors({ email: ['Unbekannter Fehler.'] });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SecurityScreen
      title="E-Mail-Adresse ändern"
      intro="Zum Ändern brauchst du dein aktuelles Passwort (und einen Code). Danach meldet sich GÖ4Fun auf allen anderen Geräten ab, und an deine bisherige Adresse geht ein Hinweis.">
      <TextField
        label="Neue E-Mail-Adresse"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        leftIcon={<MailIcon />}
        error={errors.email?.[0]}
      />
      <TextField
        label="Aktuelles Passwort"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        leftIcon={<LockIcon />}
        error={errors.current_password?.[0]}
      />
      {method ? (
        <>
          <TextField
            label="Aktueller Code"
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={9}
            leftIcon={<LockIcon />}
            hint="Kein Zugriff? Einer deiner Wiederherstellungscodes (xxxx-xxxx) funktioniert auch."
            error={errors.code?.[0]}
          />
          {method === 'email' ? (
            <Pressable onPress={sendCode} disabled={sending} hitSlop={8}>
              <Text style={[styles.link, { color: colors.tint }]}>Code per E-Mail schicken</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      <BrandButton title="E-Mail-Adresse speichern" onPress={onSave} loading={saving} disabled={!canSave} />
      <SecurityNote>
        Deine bisherige Adresse: {user?.email ?? '—'}
      </SecurityNote>
    </SecurityScreen>
  );
}

const styles = StyleSheet.create({
  link: { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: 'center' },
});
