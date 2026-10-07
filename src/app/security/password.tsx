import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { SecurityNote, SecurityScreen } from '@/components/security/security-screen';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon } from '@/components/ui/icons';
import { PasswordMeter } from '@/components/ui/password-meter';
import { TextField } from '@/components/ui/text-field';
import { FontFamily } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import { passwordStrength } from '@/lib/password-strength';

/**
 * Passwort ändern – angemeldet, mit dem alten Passwort als Nachweis.
 *
 * Das alte Passwort ist die Sicherung gegen den häufigsten Fall: ein entsperrtes
 * Handy in fremder Hand. Ohne diese Abfrage könnte jede:r, der das Handy kurz hat,
 * das Konto übernehmen.
 *
 * Nach dem Ändern meldet der Server alle ANDEREN Geräte ab – wer das Passwort
 * ändert, weil er einen Verdacht hat, will genau das.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const personal = [user?.username, user?.email, user?.name];
  const strength = passwordStrength(next, personal);
  const mismatch = repeat.length > 0 && repeat !== next;
  const canSave = current.length > 0 && strength.meetsPolicy && repeat === next && !saving;

  async function onSave() {
    if (!token || !canSave) return;
    setSaving(true);
    setErrors({});
    try {
      const res = await api.changePassword(token, current, next);
      // Nothing to update on this device: it remembers the e-mail address only (F-20).
      await notifyUser('Passwort geändert', res.message ?? 'Dein neues Passwort gilt ab sofort.');
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(Object.keys(e.errors).length ? e.errors : { password: [e.firstError()] });
      } else {
        setErrors({ password: ['Unbekannter Fehler.'] });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SecurityScreen
      title="Passwort ändern"
      intro="Gib zuerst dein aktuelles Passwort ein. Danach meldet sich GÖ4Fun auf allen anderen Geräten ab.">
      <TextField
        label="Aktuelles Passwort"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoComplete="current-password"
        leftIcon={<LockIcon />}
        error={errors.current_password?.[0]}
      />
      <TextField
        label="Neues Passwort"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoComplete="new-password"
        leftIcon={<LockIcon />}
        error={errors.password?.[0]}
      />
      <PasswordMeter password={next} personal={personal} />
      <TextField
        label="Neues Passwort wiederholen"
        value={repeat}
        onChangeText={setRepeat}
        secureTextEntry
        autoComplete="new-password"
        leftIcon={<LockIcon />}
        error={mismatch ? 'Die beiden Passwörter sind nicht gleich.' : undefined}
      />
      <BrandButton title="Passwort speichern" onPress={onSave} loading={saving} disabled={!canSave} />
      <SecurityNote>
        <Text style={styles.bold}>Tipp: </Text>
        Ein Satz aus vier, fünf Wörtern mit einer Zahl ist stärker als ein kurzes Passwort voller
        Sonderzeichen – und du vergisst ihn nicht.
      </SecurityNote>
    </SecurityScreen>
  );
}

const styles = StyleSheet.create({
  bold: { fontFamily: FontFamily.bold },
});
