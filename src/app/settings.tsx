import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { InterestPicker, type InterestPickerPalette } from '@/components/interest-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListNote, ListRow, ListSection, ListSwitch } from '@/components/ui/list-row';
import { Links, supportMailto } from '@/constants/links';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { initialsOf } from '@/domain/initials';
import { LEGAL_VERSION, type LegalDocId } from '@/domain/legal';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/lib/app-settings';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { clearSavedEmail } from '@/lib/credential-store';
import { previewSound } from '@/lib/feedback';
import { useThemePreference } from '@/lib/theme-preference';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** Externe Seite im In-App-Browser öffnen; `mailto:` muss ans System gehen. */
async function openLink(url: string) {
  try {
    if (url.startsWith('mailto:')) {
      await Linking.openURL(url);
      return;
    }
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await notifyUser('Link ließ sich nicht öffnen', url);
  }
}

/**
 * Einstellungen – offene Abschnitte statt Klapp-Gruppen.
 *
 * Reihenfolge nach Häufigkeit: Profil, Anmeldung & Sicherheit, Interessen,
 * Mitteilungen, App (Standort, Vibration, Klänge, Darstellung), Privatsphäre,
 * Hilfe, Rechtliches – und ganz unten Abmelden und Konto löschen. Alles hier
 * wirkt sofort; die Mitteilungs-Wünsche werden gespeichert und gelten, sobald
 * der Versand steht (das sagt der Hinweis in der Karte).
 */
export default function SettingsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { user, logout } = useAuth();
  const { preference, isDark, setDark, followSystem } = useThemePreference();
  const { settings, update } = useAppSettings();

  const openLegal = (doc: LegalDocId) => router.push({ pathname: '/legal', params: { doc } });

  const onForgetDevice = async () => {
    const ok = await confirmAction(
      'E-Mail-Adresse löschen',
      'Die auf diesem Gerät gemerkte E-Mail-Adresse wird entfernt. Beim nächsten Login gibst du sie neu ein.',
      'Löschen',
      true,
    );
    if (!ok) return;
    await clearSavedEmail();
    await notifyUser('Erledigt', 'Auf diesem Gerät ist keine E-Mail-Adresse mehr gespeichert.');
  };

  const onLogout = async () => {
    if (await confirmAction('Abmelden', 'Möchtest du dich wirklich abmelden?', 'Abmelden', true)) await logout();
  };

  const followsSystem = preference === null;

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Einstellungen' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ListSection title="Profil">
          <ListRow
            first
            icon="user"
            title={user?.name ?? 'Profil'}
            hint={user?.username ? `@${user.username} · Profilbild, Name, Benutzername` : 'Profilbild, Name, Benutzername'}
            onPress={() => router.push('/profile')}
            right={<ProfileThumb />}
          />
        </ListSection>

        <ListSection title="Anmeldung & Sicherheit">
          {/* The e-mail address changes on its own screen: with the password (and a code), and
              only after the code sent to the new address comes back (security/email.tsx). */}
          <ListRow first icon="mail" title="E-Mail-Adresse ändern" hint={user?.email ?? '—'} onPress={() => router.push('/security/email')} />
          <ListRow icon="lock" title="Passwort ändern" hint="Mit altem Passwort bestätigen" onPress={() => router.push('/security/password')} />
          <ListRow
            icon={user?.two_factor_method ? 'shield-check' : 'shield'}
            title="Zwei-Faktor-Anmeldung"
            value={user?.two_factor_method ? 'An' : 'Aus'}
            hint={user?.two_factor_method === 'totp' ? 'Code aus der Authenticator-App' : user?.two_factor_method === 'email' ? 'Code per E-Mail' : 'Zusätzlicher Code beim Anmelden'}
            onPress={() => router.push('/security/two-factor')}
          />
          <ListRow icon="key" title="Gespeicherte E-Mail-Adresse löschen" hint="Entfernt die gemerkte E-Mail-Adresse von diesem Gerät" onPress={onForgetDevice} />
        </ListSection>

        <InterestsSection />

        <ListSection title="Mitteilungen">
          <ListSwitch first icon="map-pin" title="Neue Partner in der Nähe" value={settings.notifyNearby} onValueChange={(v) => update('notifyNearby', v)} />
          <ListSwitch icon="clock" title="Erinnerung an Buchungen" hint="Bevor eine Buchung abläuft" value={settings.notifyReminder} onValueChange={(v) => update('notifyReminder', v)} />
          <ListSwitch icon="users" title="Neues in deinen Gruppen" hint="Nachrichten und neue Mitglieder" value={settings.notifyJoins} onValueChange={(v) => update('notifyJoins', v)} />
          <ListSwitch icon="percent" title="Angebote und Aktionen" hint="Neue Rabatte bei unseren Partnern" value={settings.notifyUpdates} onValueChange={(v) => update('notifyUpdates', v)} />
          <ListSwitch icon="mail" title="Wochenrückblick" hint="Stempel, Credits und Tipps – einmal pro Woche" value={settings.notifyDigest} onValueChange={(v) => update('notifyDigest', v)} />
          <ListNote>Der Versand wird gerade aufgebaut. Deine Auswahl ist gespeichert und gilt, sobald es losgeht.</ListNote>
        </ListSection>

        <ListSection title="App">
          <ListSwitch
            first
            icon="compass"
            title="Standort verwenden"
            hint={settings.useLocation ? 'Für Entfernungen, die Karte und den Stempel am Aufkleber' : 'Aus – Entfernungen bleiben leer'}
            value={settings.useLocation}
            onValueChange={(v) => update('useLocation', v)}
          />
          <ListSwitch icon="vibrate" title="Vibration" hint="Kurze Rückmeldung beim Tippen, Buchen und Stempeln" value={settings.haptics} onValueChange={(v) => update('haptics', v)} />
          <ListSwitch
            icon="speaker"
            title="Klänge"
            hint="Kurze Töne beim Buchen und bei vollen Stempelkarten"
            value={settings.sounds}
            onValueChange={(next) => {
              update('sounds', next);
              // Beim Einschalten einmal vorspielen – sonst weiß man nicht, ob es geht.
              if (next) previewSound();
            }}
          />
          <ListSwitch
            icon="sparkles"
            title="Goenni als Begleiter"
            hint="Sitzt unten über der Leiste, gibt Tipps und reagiert aufs Antippen"
            value={settings.mascotCompanion}
            onValueChange={(v) => update('mascotCompanion', v)}
          />
          <ListSwitch icon="star" title="Saison-Deko" hint="Kürbisse, Christbaumkugeln & Co. passend zur Jahreszeit" value={settings.seasonalDecor} onValueChange={(v) => update('seasonalDecor', v)} />
          <ListSwitch icon="contrast" title="Wie das Handy (hell/dunkel)" value={followsSystem} onValueChange={(on) => (on ? followSystem() : setDark(isDark))} />
          <ListSwitch icon="moon" title="Dunkles Design" hint={followsSystem ? 'Bestimmt gerade dein Handy' : undefined} value={isDark} onValueChange={setDark} disabled={followsSystem} />
        </ListSection>

        <ListSection title="Privatsphäre">
          <ListRow first icon="lock" title="Datenschutz" hint="Was wir speichern und warum" onPress={() => openLegal('privacy')} />
          <ListRow icon="ban" title="Blockierte Konten" hint="Wen du blockiert hast – und wie du es zurücknimmst" onPress={() => router.push('/blocked')} />
        </ListSection>

        <ListSection title="Hilfe">
          <ListRow first icon="help" title="Hilfe & häufige Fragen" onPress={() => openLink(Links.help)} />
          <ListRow icon="chat" title="Feedback senden" hint="Was fehlt dir? Was nervt?" onPress={() => openLink(supportMailto('Feedback zu GÖ4Fun'))} />
          <ListRow
            icon="flag"
            title="Problem melden"
            hint="Fehler, unangemessene Inhalte oder Nutzer"
            onPress={() => openLink(supportMailto('Problem melden', 'Was ist passiert?\n\nWo ist es passiert (Partner, Gruppe, Screen)?\n\n'))}
          />
        </ListSection>

        <ListSection title="Rechtliches" footer={`GÖ4Fun ${APP_VERSION} · Rechtstexte Stand ${LEGAL_VERSION}`}>
          <ListRow first icon="document" title="Nutzungsbedingungen" onPress={() => openLegal('terms')} />
          <ListRow icon="shield" title="Haftung und Partner" onPress={() => openLegal('liability')} />
          <ListRow icon="users" title="Regeln für das Miteinander" onPress={() => openLegal('conduct')} />
          <ListRow icon="building" title="Impressum" onPress={() => openLegal('imprint')} />
        </ListSection>

        <ListSection title="Konto">
          <ListRow first icon="logout" title="Abmelden" onPress={onLogout} danger />
          <ListRow icon="trash" title="Konto löschen" hint="Konto, Credits und Stempel endgültig entfernen" onPress={() => router.push('/security/delete-account')} danger />
        </ListSection>
      </ScrollView>
    </View>
  );
}

/** Kleines Profilbild rechts in der Profil-Zeile. */
function ProfileThumb() {
  const colors = useTheme();
  const { user } = useAuth();
  return (
    <View style={[styles.thumb, { backgroundColor: colors.backgroundSelected }]}>
      {user?.avatar ? (
        <Image source={{ uri: user.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Text style={[styles.thumbText, { color: colors.tint }]}>{initialsOf(user?.name)}</Text>
      )}
    </View>
  );
}

/** Interessen: was dir auf der Startseite zuerst vorgeschlagen wird. */
function InterestsSection() {
  const colors = useTheme();
  const { user, updateProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const palette: InterestPickerPalette = {
    chipBg: colors.background,
    chipBorder: colors.border,
    chipText: colors.text,
    activeBg: colors.tint,
    activeBorder: colors.tint,
    activeText: colors.tintText,
    muted: colors.textSecondary,
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ interests: draft });
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.firstError() : 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  };

  const interests = user?.interests ?? [];

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]} accessibilityRole="header">
        INTERESSEN
      </Text>
      <Card style={styles.interests}>
        {editing ? (
          <>
            <Text style={[styles.small, { color: colors.textSecondary }]}>Tippe an, was dich interessiert – das schlagen wir dir zuerst vor.</Text>
            <InterestPicker value={draft} onChange={setDraft} palette={palette} disabled={saving} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.editActions}>
              <Button title="Abbrechen" variant="ghost" size="small" onPress={() => setEditing(false)} disabled={saving} />
              <Button title="Speichern" size="small" icon="check" onPress={save} loading={saving} />
            </View>
          </>
        ) : (
          <>
            {interests.length > 0 ? (
              <View style={styles.chips}>
                {interests.map((interest) => (
                  <View key={interest.id} style={[styles.chip, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
                    <Text style={[styles.chipText, { color: colors.text }]}>{interest.name}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.small, { color: colors.textSecondary }]}>Noch keine Interessen ausgewählt.</Text>
            )}
            <Button
              title={interests.length > 0 ? 'Interessen bearbeiten' : 'Interessen wählen'}
              icon="edit"
              variant="secondary"
              size="small"
              onPress={() => {
                setDraft(interests.map((i) => i.id));
                setError(null);
                setEditing(true);
              }}
            />
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  thumb: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbText: { fontFamily: FontFamily.bold, fontSize: 14 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  section: { gap: Spacing.two },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.8, marginLeft: Spacing.two },
  interests: { gap: Spacing.three },
  small: { fontFamily: FontFamily.medium, fontSize: 13.5, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 13.5 },
  error: { color: '#e11d48', fontFamily: FontFamily.medium, fontSize: 13 },
});
