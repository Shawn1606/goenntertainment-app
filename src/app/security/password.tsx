import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { SecurityNote, SecurityScreen } from '@/components/security/security-screen';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon } from '@/components/ui/icons';
import { PasswordMeter } from '@/components/ui/password-meter';
import { TextField } from '@/components/ui/text-field';
import { FontFamily } from '@/constants/theme';
import { normalizeResetCode } from '@/domain/reset-code';
import { useTheme } from '@/hooks/use-theme';
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
 * An account without a password (former Google sign-in) has no old one to give: it sets its first
 * password with a one-time code that the server mails to the account's own address (F-04), not
 * with the session alone. The switch below the button opens that way, and the screen also takes
 * it when the server answers that a code is needed.
 *
 * Nach dem Ändern meldet der Server alle ANDEREN Geräte ab – wer das Passwort
 * ändert, weil er einen Verdacht hat, will genau das.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { token, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [firstPassword, setFirstPassword] = useState(false);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const personal = [user?.username, user?.email, user?.name];
  const strength = passwordStrength(next, personal);
  const mismatch = repeat.length > 0 && repeat !== next;
  // The mailed code has six digits; anything else is refused here, before it costs a try.
  const proven = firstPassword ? normalizeResetCode(code) !== null : current.length > 0;
  const canSave = proven && strength.meetsPolicy && repeat === next && !saving;

  /** First password: a code to the account's own address. */
  async function sendCode() {
    if (!token) return;
    setSending(true);
    try {
      const res = await api.requestFirstPasswordCode(token);
      await notifyUser('Code unterwegs', `Wir haben dir einen Code an ${res.destination} geschickt.`);
    } catch (e) {
      setErrors({ code: [e instanceof ApiError ? e.firstError() : 'Unbekannter Fehler.'] });
    } finally {
      setSending(false);
    }
  }

  async function onSave() {
    if (!token || !canSave) return;
    setSaving(true);
    setErrors({});
    try {
      const res = firstPassword
        ? await api.setFirstPassword(token, normalizeResetCode(code) ?? '', next)
        : await api.changePassword(token, current, next);
      // Nothing to update on this device: it remembers the e-mail address only (F-20).
      await notifyUser('Passwort geändert', res.message ?? 'Dein neues Passwort gilt ab sofort.');
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        // The server asks for a code only when the account has no password yet.
        if (!firstPassword && e.errors.code) setFirstPassword(true);
        setErrors(Object.keys(e.errors).length ? e.errors : { password: [e.firstError()] });
      } else {
        setErrors({ password: ['Unbekannter Fehler.'] });
      }
    } finally {
      setSaving(false);
    }
  }

  function switchWay() {
    setFirstPassword((v) => !v);
    setErrors({});
  }

  return (
    <SecurityScreen
      title="Passwort ändern"
      intro={
        firstPassword
          ? 'Dein Konto hat noch kein Passwort? Dann schicken wir dir einen Code an deine E-Mail-Adresse; mit ihm legst du dein erstes Passwort fest. Danach meldet sich GÖ4Fun auf allen anderen Geräten ab.'
          : 'Gib zuerst dein aktuelles Passwort ein. Danach meldet sich GÖ4Fun auf allen anderen Geräten ab.'
      }>
      {firstPassword ? (
        <>
          <Text onPress={sending ? undefined : sendCode} accessibilityRole="button" style={[styles.link, { color: colors.tint }]}>
            Code per E-Mail schicken
          </Text>
          <TextField
            label="Code aus der E-Mail"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={7}
            leftIcon={<LockIcon />}
            error={errors.code?.[0] ?? errors.current_password?.[0]}
          />
        </>
      ) : (
        <TextField
          label="Aktuelles Passwort"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
          leftIcon={<LockIcon />}
          error={errors.current_password?.[0]}
        />
      )}
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
      <Text onPress={switchWay} accessibilityRole="button" style={[styles.switch, { color: colors.textSecondary }]}>
        {firstPassword ? 'Doch mit aktuellem Passwort' : 'Noch kein Passwort? (Anmeldung mit Google)'}
      </Text>
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
  link: { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: 'center' },
  switch: { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: 'center' },
});
