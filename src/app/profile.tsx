import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { PlanBadge } from '@/components/plan-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, MaxContentWidth, PlanLook, Spacing } from '@/constants/theme';
import { planFor } from '@/domain/club';
import { initialsOf } from '@/domain/initials';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { blockedTermMessage } from '@/lib/blocked-terms';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { pickImage } from '@/lib/pick-image';

/**
 * Profil bearbeiten: Profilbild, Name, Benutzername.
 *
 * Das Bild sehen andere nur in gemeinsamen Gruppen (Mitgliederliste, Chat) –
 * ein öffentliches Profil gibt es nicht. E-Mail und Passwort stehen in den
 * Einstellungen unter „Anmeldung & Sicherheit".
 */
export default function ProfileScreen() {
  const colors = useTheme();
  const { token, user, patchUser, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [errors, setErrors] = useState<{ name?: string; username?: string }>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(0);

  if (!user) return null;

  const plan = planFor(CLUB_RULES, user.club_plan);
  const cleanUsername = username.trim().replace(/^@+/, '');
  const changed = name.trim() !== (user.name ?? '') || cleanUsername !== (user.username ?? '');

  const changePhoto = async () => {
    if (!token) return;
    const image = await pickImage('Profilbild', 'profilbild', { aspect: [1, 1], shape: 'oval' });
    if (!image) return;
    setUploading(true);
    try {
      const res = await api.uploadAvatar(token, image);
      patchUser({ avatar: res.user.avatar });
      feedback.achieved();
      setSaved((n) => n + 1);
    } catch (e) {
      feedback.failed();
      await notifyUser('Bild nicht gespeichert', errorMessage(e));
    }
    setUploading(false);
  };

  const removePhoto = async () => {
    if (!token) return;
    if (!(await confirmAction('Profilbild entfernen?', 'Statt des Bildes stehen dann deine Initialen.', 'Entfernen', true))) return;
    setUploading(true);
    try {
      const res = await api.removeAvatar(token);
      patchUser({ avatar: res.user.avatar });
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setUploading(false);
  };

  const save = async () => {
    const next: { name?: string; username?: string } = {};
    if (!name.trim()) next.name = 'Bitte gib deinen Namen an.';
    if (cleanUsername.length < 3) next.username = 'Mindestens 3 Zeichen.';
    else {
      const blocked = blockedTermMessage(cleanUsername, 'username');
      if (blocked) next.username = blocked;
    }
    setErrors(next);
    if (next.name || next.username) return;

    setSaving(true);
    try {
      await updateProfile({ name: name.trim(), username: cleanUsername });
      setUsername(cleanUsername);
      feedback.achieved();
      setSaved((n) => n + 1);
    } catch (e) {
      feedback.failed();
      if (e instanceof ApiError) {
        setErrors({ name: e.fieldError('name') ?? undefined, username: e.fieldError('username') ?? undefined });
        if (!e.fieldError('name') && !e.fieldError('username')) await notifyUser('Nicht gespeichert', e.firstError());
      } else {
        await notifyUser('Nicht gespeichert', errorMessage(e));
      }
    }
    setSaving(false);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Profil bearbeiten' }} />
      <KeyboardForm contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.photoCard}>
          <PressableScale onPress={changePhoto} disabled={uploading} accessibilityRole="button" accessibilityLabel="Profilbild ändern" scaleTo={0.96}>
            <View style={[styles.ring, { borderColor: PlanLook[plan.key].ring }]}>
              <View style={[styles.avatar, { backgroundColor: colors.backgroundSelected }]}>
                {user.avatar ? (
                  <Image source={{ uri: user.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
                ) : (
                  <Text style={[styles.initials, { color: colors.tint }]}>{initialsOf(user.name)}</Text>
                )}
                {uploading ? (
                  <View style={styles.uploading}>
                    <ActivityIndicator color="#ffffff" />
                  </View>
                ) : null}
              </View>
              <View style={[styles.camera, { backgroundColor: colors.tint, borderColor: colors.background }]}>
                <Icon name="camera" size={16} color="#ffffff" />
              </View>
            </View>
          </PressableScale>
          {/* Hülle: Die Plakette richtet sich selbst links aus (alignSelf). */}
          <View style={styles.center}>
            <PlanBadge plan={plan.key} />
          </View>
          <View style={styles.photoButtons}>
            <Button title={user.avatar ? 'Foto ändern' : 'Foto hinzufügen'} icon="camera" size="small" onPress={changePhoto} disabled={uploading} />
            {user.avatar ? <Button title="Entfernen" variant="ghost" size="small" onPress={removePhoto} disabled={uploading} /> : null}
          </View>
          <Text style={[styles.note, { color: colors.textSecondary }]}>Dein Bild sehen nur Mitglieder deiner Gruppen.</Text>
        </Card>

        <Card style={styles.form}>
          <TextField
            label="Name"
            value={name}
            onChangeText={(v) => {
              setName(v);
              setErrors((e) => ({ ...e, name: undefined }));
            }}
            autoComplete="name"
            error={errors.name}
            returnKeyType="next"
          />
          <TextField
            label="Benutzername"
            value={username}
            onChangeText={(v) => {
              setUsername(v);
              setErrors((e) => ({ ...e, username: undefined }));
            }}
            autoCapitalize="none"
            autoCorrect={false}
            leftIcon={<Text style={[styles.at, { color: colors.textSecondary }]}>@</Text>}
            error={errors.username}
            hint="3–30 Zeichen: Buchstaben, Zahlen, - und _"
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <Button title="Speichern" icon="check" onPress={save} loading={saving} disabled={!changed} />
        </Card>

        {saved > 0 ? (
          <View style={styles.savedRow} accessibilityLiveRegion="polite">
            <Mascot mood="cheer" size={48} trick="hop" trickKey={saved} />
            <Text style={[styles.savedText, { color: colors.text }]}>Gespeichert – sieht super aus!</Text>
          </View>
        ) : null}
      </KeyboardForm>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  photoCard: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.four },
  ring: { width: 124, height: 124, borderRadius: 62, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 108, height: 108, borderRadius: 54, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FontFamily.bold, fontSize: 38 },
  uploading: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(12,4,24,0.45)', alignItems: 'center', justifyContent: 'center' },
  camera: { position: 'absolute', right: 2, bottom: 2, width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  center: { alignSelf: 'center' },
  photoButtons: { flexDirection: 'row', gap: Spacing.two },
  note: { fontFamily: FontFamily.medium, fontSize: 12.5, textAlign: 'center' },
  form: { gap: Spacing.three },
  at: { fontFamily: FontFamily.semibold, fontSize: 16 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'center' },
  savedText: { fontFamily: FontFamily.bold, fontSize: 15 },
});
