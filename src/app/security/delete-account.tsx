import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SecurityNote, SecurityScreen } from '@/components/security/security-screen';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon } from '@/components/ui/icons';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { clearSavedEmail } from '@/lib/credential-store';
import { clearSearchHistory } from '@/lib/search-history-store';

/**
 * Konto endgültig löschen – direkt in der App.
 *
 * Apple (Richtlinie 5.1.1) und Google Play verlangen, dass man die Löschung IN
 * der App auslösen kann. Vorher öffnete dieser Weg nur eine Mail an den Support.
 *
 * Zwei Sicherungen, weil es kein Zurück gibt: das Passwort (bzw. bei aktiver 2FA
 * zusätzlich ein Code) und danach noch eine ausdrückliche Rückfrage. Wer kein
 * Passwort hat (reine Google-Anmeldung), tippt stattdessen „LÖSCHEN".
 */
export default function DeleteAccountScreen() {
  const colors = useTheme();
  const { token, user, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [usePhrase, setUsePhrase] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  const needsCode = !!user?.two_factor_method;
  const ready = (usePhrase ? typed.trim().toUpperCase() === 'LÖSCHEN' : password.length > 0) && (!needsCode || code.trim().length >= 6);

  async function sendCode() {
    if (!token) return;
    try {
      const res = await api.twoFactorSendCode(token);
      await notifyUser('Code unterwegs', `Wir haben dir einen Code an ${res.destination} geschickt.`);
    } catch (e) {
      setErrors({ code: [e instanceof ApiError ? e.firstError() : 'Der Code konnte nicht verschickt werden.'] });
    }
  }

  async function onDelete() {
    if (!token || !ready) return;
    const ok = await confirmAction(
      'Wirklich löschen?',
      'Dein Konto, deine Aktivitäten, Gruppen und Nachrichten werden endgültig entfernt. Das lässt sich nicht rückgängig machen.',
      'Endgültig löschen',
      true,
    );
    if (!ok) return;

    setBusy(true);
    setErrors({});
    try {
      const res = await api.deleteAccount(token, {
        ...(usePhrase ? { confirm: 'LÖSCHEN' } : { password }),
        ...(needsCode ? { code: code.trim() } : {}),
      });
      await clearSavedEmail();
      // The search history goes now (F-44), not only with the sign-out after the dialog: the
      // dialog waits for a tap, and an app closed there would never reach that sign-out.
      // Never throws.
      await clearSearchHistory(user?.id ?? null);
      await notifyUser('Konto gelöscht', res.message ?? 'Dein Konto wurde gelöscht. Schade, dass du gehst!');
      // Der Token ist mit dem Konto verschwunden – lokal abmelden, dann zeigt die App
      // wieder den Willkommensbildschirm.
      await logout();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(Object.keys(e.errors).length ? e.errors : { password: [e.firstError()] });
      } else {
        setErrors({ password: ['Unbekannter Fehler.'] });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SecurityScreen
      title="Konto löschen"
      intro="Damit werden dein Konto und alles, was daran hängt, endgültig entfernt.">
      <SecurityNote tone="danger">
        Gelöscht werden: dein Profil mit Bildern, deine Aktivitäten (auch für alle, die dabei sind),
        deine Gruppen, Freundschaften und Merkliste. Nachrichten in Gruppen-Chats können für die
        anderen als „gelöschtes Konto“ stehen bleiben.
      </SecurityNote>

      {usePhrase ? (
        <TextField
          label='Zur Bestätigung „LÖSCHEN" eintippen'
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          error={errors.confirm?.[0] ?? errors.password?.[0]}
        />
      ) : (
        <TextField
          label="Dein Passwort"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          leftIcon={<LockIcon />}
          error={errors.password?.[0]}
        />
      )}

      {needsCode ? (
        <>
        {user?.two_factor_method === 'email' ? (
          <Text onPress={sendCode} accessibilityRole="button" style={[styles.switch, { color: colors.tint }]}>
            Code per E-Mail schicken
          </Text>
        ) : null}
        <TextField
          label="Code aus deiner Zwei-Faktor-Anmeldung"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          maxLength={9}
          leftIcon={<LockIcon />}
          error={errors.code?.[0]}
        />
        </>
      ) : null}

      <View style={styles.actions}>
        <BrandButton title="Konto endgültig löschen" onPress={onDelete} loading={busy} disabled={!ready} />
        <Text
          onPress={() => setUsePhrase((v) => !v)}
          style={[styles.switch, { color: colors.textSecondary }]}
          accessibilityRole="button">
          {usePhrase ? 'Doch mit Passwort bestätigen' : 'Kein Passwort? (Anmeldung mit Google)'}
        </Text>
      </View>
    </SecurityScreen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.three },
  switch: { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: 'center' },
});
