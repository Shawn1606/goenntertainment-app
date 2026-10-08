import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { SecurityNote, SecurityScreen } from '@/components/security/security-screen';
import { BrandButton } from '@/components/ui/brand-button';
import { LockIcon, MailIcon } from '@/components/ui/icons';
import { TextField } from '@/components/ui/text-field';
import { FontFamily } from '@/constants/theme';
import { isEmailAddress } from '@/domain/email';
import { normalizeResetCode } from '@/domain/reset-code';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import { loadSavedEmail, saveEmail } from '@/lib/credential-store';

/**
 * Change the e-mail address: with the current password, and with two-factor sign-in also the code.
 *
 * The address is the way back into the account (forgotten password, codes by e-mail). Whoever can
 * change it can take the account over, so being signed in is not enough (F-04). Two steps: the
 * new address with the password (and code) only makes the server mail a one-time code to the NEW
 * address; the address takes effect when that code is typed here. So the account can only move to
 * an address whose mail its owner reads. Then the server signs out every other device and sends a
 * notice to the previous address; if that notice cannot be sent, nothing changes.
 */
export default function ChangeEmailScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { token, user, applyUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'address' | 'code'>('address');
  /** The address the code went to: step 2 confirms exactly this one. Kept in memory only. */
  const [pending, setPending] = useState<string | null>(null);
  const [mailCode, setMailCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const method = user?.two_factor_method ?? null;
  const canSend = isEmailAddress(email.trim()) && password.length > 0 && (!method || code.trim().length > 0) && !saving;
  // The same six digits as every mailed code; anything else is refused here, before it costs a try.
  const canConfirm = pending !== null && normalizeResetCode(mailCode) !== null && !saving;

  function showError(e: unknown, field: string) {
    if (e instanceof ApiError) {
      setErrors(Object.keys(e.errors).length ? e.errors : { [field]: [e.firstError()] });
    } else {
      setErrors({ [field]: ['Unbekannter Fehler.'] });
    }
  }

  /** E-mail method: have the code sent to the CURRENT address, not the new one. */
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

  /** Step 1: nothing changes yet; the server mails a code to the new address. */
  async function onSend() {
    if (!token || !canSend) return;
    const target = email.trim();
    setSaving(true);
    setErrors({});
    try {
      await api.changeEmail(token, {
        email: target,
        current_password: password,
        ...(method ? { code: code.trim() } : {}),
      });
      setPending(target);
      setMailCode('');
      // A second-factor code is used up once checked; going back needs a fresh one.
      setCode('');
      setStep('code');
    } catch (e) {
      showError(e, 'email');
    } finally {
      setSaving(false);
    }
  }

  /** Step 2: the code from the new address makes the change. */
  async function onConfirm() {
    if (!token || !canConfirm || pending === null) return;
    const previous = user?.email ?? null;
    setSaving(true);
    setErrors({});
    try {
      const res = await api.confirmEmailChange(token, { email: pending, code: normalizeResetCode(mailCode) ?? '' });
      applyUser(res.user);
      // Carry the remembered address over if this device remembered the previous one.
      if (previous && (await loadSavedEmail()) === previous) await saveEmail(res.user.email);
      await notifyUser('E-Mail-Adresse geändert', 'Deine neue Adresse gilt ab sofort. Andere Geräte wurden abgemeldet.');
      router.back();
    } catch (e) {
      showError(e, 'code');
    } finally {
      setSaving(false);
    }
  }

  /** Back to step 1, for another address or a new code; the typed address and password stay. */
  function backToAddress() {
    setStep('address');
    setErrors({});
  }

  if (step === 'code' && pending !== null) {
    return (
      <SecurityScreen
        title="E-Mail-Adresse bestätigen"
        intro={`Wir haben dir einen Code an ${pending} geschickt. Gib ihn hier ein – erst dann gilt die neue Adresse.`}>
        <TextField
          label="Code aus der E-Mail"
          value={mailCode}
          onChangeText={setMailCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={7}
          leftIcon={<LockIcon />}
          error={errors.code?.[0] ?? errors.email?.[0]}
        />
        <BrandButton title="Neue Adresse bestätigen" onPress={onConfirm} loading={saving} disabled={!canConfirm} />
        <Pressable onPress={backToAddress} disabled={saving} hitSlop={8}>
          <Text style={[styles.link, { color: colors.tint }]}>Keinen Code bekommen? Zurück</Text>
        </Pressable>
        <SecurityNote>
          Deine bisherige Adresse: {user?.email ?? '—'}
        </SecurityNote>
      </SecurityScreen>
    );
  }

  return (
    <SecurityScreen
      title="E-Mail-Adresse ändern"
      intro="Zum Ändern brauchst du dein aktuelles Passwort (und einen Code). Danach schicken wir einen Code an die neue Adresse; erst mit ihm gilt sie. Dann meldet sich GÖ4Fun auf allen anderen Geräten ab, und an deine bisherige Adresse geht ein Hinweis.">
      <TextField
        label="Neue E-Mail-Adresse"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        leftIcon={<MailIcon />}
        error={errors.email?.[0] ?? (method ? undefined : errors.code?.[0])}
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
      <BrandButton title="Code an die neue Adresse schicken" onPress={onSend} loading={saving} disabled={!canSend} />
      <SecurityNote>
        Deine bisherige Adresse: {user?.email ?? '—'}
      </SecurityNote>
    </SecurityScreen>
  );
}

const styles = StyleSheet.create({
  link: { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: 'center' },
});
