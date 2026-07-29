import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { InterestPicker, type InterestPickerPalette } from '@/components/interest-picker';
import { TabMascot } from '@/components/tab-mascot';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { LockIcon } from '@/components/ui/icons';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { LinkRow, RowDivider, RowNote, SettingGroup, SwitchRow } from '@/components/ui/setting-row';
import { TextField } from '@/components/ui/text-field';
import { Links, supportMailto } from '@/constants/links';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { LEGAL_VERSION, type LegalDocId } from '@/domain/legal';
import {
  ACCOUNT_TIERS,
  normalizeAccountType,
  tierFor,
  type AccountTier,
  type AccountType,
} from '@/domain/account';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface, useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { useAppSettings } from '@/lib/app-settings';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { clearCredentials } from '@/lib/credential-store';
import { previewSound } from '@/lib/feedback';
import { useThemePreference } from '@/lib/theme-preference';

type EditableField = 'email' | 'username';

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
 * Einstellungen in klar getrennten Gruppen – aufgebaut entlang dessen, was
 * Nutzer in einer Social-/Event-App erwarten: Konto, Interessen,
 * Benachrichtigungen, Standort & Privatsphäre, Darstellung, Hilfe, Recht
 * und ein ehrlicher Weg zum Löschen des Kontos.
 *
 * Was hier steht, tut auch etwas: Dark-Mode, Standortnutzung und gespeicherte
 * Zugangsdaten greifen sofort. Die Benachrichtigungswünsche werden gemerkt und
 * gelten, sobald der Versand steht – das sagt der Hinweis in der Gruppe auch
 * so, statt Schalter ins Leere laufen zu lassen.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useTheme();
  const surface = useBrandSurface();

  /** Ein Rechtstext in der App – nicht im Browser (siehe Gruppe „Rechtliches"). */
  function openLegal(doc: LegalDocId) {
    router.push({ pathname: '/legal', params: { doc } });
  }

  const { user, logout, updateProfile } = useAuth();
  const { preference, isDark, setDark, followSystem } = useThemePreference();
  const { settings, update } = useAppSettings();

  const [sendingReset, setSendingReset] = useState(false);

  // Interessen-Bearbeitung (eigener Zustand, unabhängig von den Konto-Feldern).
  const [editingInterests, setEditingInterests] = useState(false);
  const [interestDraft, setInterestDraft] = useState<number[]>([]);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);

  const interestPalette: InterestPickerPalette = {
    // Die Chips liegen jetzt auf der blauen Gruppen-Karte: eine Stufe kräftiger
    // als diese, damit sie als eigene Fläche lesbar bleiben.
    chipBg: surface.chipBgStrong,
    chipBorder: surface.chipBorder,
    chipText: colors.text,
    activeBg: colors.tint,
    activeBorder: colors.tint,
    activeText: colors.tintText,
    muted: colors.textSecondary,
  };

  function startEditInterests() {
    setInterestDraft((user?.interests ?? []).map((i) => i.id));
    setInterestError(null);
    setEditingInterests(true);
  }

  function cancelEditInterests() {
    setEditingInterests(false);
    setInterestError(null);
  }

  async function saveInterests() {
    setSavingInterests(true);
    setInterestError(null);
    try {
      await updateProfile({ interests: interestDraft });
      setEditingInterests(false);
    } catch (err) {
      setInterestError(
        err instanceof ApiError ? err.firstError() : 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setSavingInterests(false);
    }
  }

  // Kontostufe (Standard/Creator/Business/Business Plus). Nur Admins dürfen
  // umstellen – das Backend weist alle anderen mit 403 ab, für sie bleibt der
  // Block eine Anzeige mit dem Weg zum Upgrade.
  const accountType: AccountType = normalizeAccountType(user?.account_type);
  const currentTier = tierFor(user?.account_type);
  const [savingAccountType, setSavingAccountType] = useState(false);
  const [accountTypeError, setAccountTypeError] = useState<string | null>(null);

  async function onSelectAccountType(next: AccountType) {
    // Gegen den ROHEN Wert prüfen, nicht gegen die normalisierte Anzeige:
    // Google-Konten starten ohne Kontotyp und Bestandskonten stehen evtl. noch
    // auf dem alten 'personal' – in beiden Fällen muss „Standard" speicherbar
    // bleiben, damit der Wert in der Datenbank gerade gezogen wird.
    if (next === user?.account_type || savingAccountType) return;
    setSavingAccountType(true);
    setAccountTypeError(null);
    try {
      await updateProfile({ account_type: next });
    } catch (err) {
      setAccountTypeError(
        err instanceof ApiError ? err.firstError() : 'Umstellen fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setSavingAccountType(false);
    }
  }

  // Inline-Bearbeitung: welches Feld gerade bearbeitet wird + Entwurf/Fehler.
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit(field: EditableField, current: string) {
    setEditing(field);
    setDraft(current);
    setFieldError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setFieldError(null);
  }

  async function saveEdit(field: EditableField) {
    // Benutzername ohne führendes @ speichern.
    const value = field === 'username' ? draft.trim().replace(/^@+/, '') : draft.trim();

    if (!value) {
      setFieldError(field === 'email' ? 'Bitte eine E-Mail angeben.' : 'Bitte einen Benutzernamen angeben.');
      return;
    }

    setSaving(true);
    setFieldError(null);
    try {
      await updateProfile({ [field]: value });
      setEditing(null);
    } catch (err) {
      setFieldError(
        err instanceof ApiError ? err.firstError() : 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword() {
    if (!user?.email) return;
    setSendingReset(true);
    try {
      await api.forgotPassword(user.email);
      Alert.alert(
        'E-Mail unterwegs',
        `Wir haben dir einen Link zum Zurücksetzen deines Passworts an ${user.email} geschickt.`,
      );
    } catch (err) {
      Alert.alert(
        'Fehlgeschlagen',
        err instanceof ApiError
          ? err.firstError()
          : 'Etwas ist schiefgelaufen. Bitte versuch es später erneut.',
      );
    } finally {
      setSendingReset(false);
    }
  }

  /** Auf diesem Gerät gemerkte Zugangsdaten entfernen (Login füllt dann leer). */
  async function onForgetDevice() {
    const ok = await confirmAction(
      'Zugangsdaten löschen',
      'Die auf diesem Gerät gespeicherte E-Mail und das Passwort werden entfernt. Beim nächsten Login musst du sie neu eingeben.',
      'Löschen',
      true,
    );
    if (!ok) return;
    await clearCredentials();
    await notifyUser('Erledigt', 'Auf diesem Gerät sind keine Zugangsdaten mehr gespeichert.');
  }

  /**
   * Konto löschen. Das Backend bietet dafür noch keinen Endpunkt, also führt
   * der Weg über den Support – aber sichtbar und mit einer fertigen Mail,
   * statt gar nicht.
   */
  async function onDeleteAccount() {
    const ok = await confirmAction(
      'Konto löschen',
      'Wir löschen dein Konto samt Events und Verlauf. Das lässt sich nicht rückgängig machen. Du schickst uns dafür eine kurze Mail – wir bestätigen die Löschung.',
      'Mail schreiben',
      true,
    );
    if (!ok) return;
    await openLink(
      supportMailto(
        'Konto löschen',
        `Bitte löscht mein Konto.\n\nKonto: ${user?.email ?? ''}${user?.username ? ` (@${user.username})` : ''}`,
      ),
    );
  }

  function onLogout() {
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: () => logout() },
    ]);
  }

  const followsSystem = preference === null;

  return (
    // Gleiche helle Leinwand wie im Rest der App – die Karten sind Glas darauf.
    <HomeBackground style={styles.screen}>
      {/* Tastatur-Freistellung macht `KeyboardForm` (siehe dort). */}
      <View style={styles.screen}>
        <KeyboardForm
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + Spacing.four,
              paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
            },
          ]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText style={styles.title}>Einstellungen</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tippe einen Bereich an, um ihn aufzuklappen.
            </ThemedText>
            <TabMascot tab="settings" style={styles.mascot} />
          </View>

          {/* Konto – die eine Gruppe, die offen startet: Von hier geht man
              weiter, hier fängt man nicht mit einem zusätzlichen Tipp an.
              Die Einordnung steht trotzdem da, weil man die Gruppe zuklappen
              kann und dann dieselbe Frage hat wie bei allen anderen. */}
          <SettingGroup
            label="Konto"
            hint="E-Mail, Benutzername und Passwort ändern."
            defaultOpen>
            <EditableRow
              field="email"
              icon="mail"
              label="E-Mail"
              displayValue={user?.email ?? '—'}
              editValue={user?.email ?? ''}
              keyboardType="email-address"
              colors={colors}
              editing={editing}
              draft={draft}
              onChangeDraft={setDraft}
              error={fieldError}
              saving={saving}
              onStart={startEdit}
              onCancel={cancelEdit}
              onSave={saveEdit}
            />

            <RowDivider />

            <EditableRow
              field="username"
              icon="user"
              label="Benutzername"
              displayValue={user?.username ? `@${user.username}` : '—'}
              editValue={user?.username ?? ''}
              prefix="@"
              colors={colors}
              editing={editing}
              draft={draft}
              onChangeDraft={setDraft}
              error={fieldError}
              saving={saving}
              onStart={startEdit}
              onCancel={cancelEdit}
              onSave={saveEdit}
            />

            <RowDivider />

            <View style={styles.row}>
              <View style={styles.rowLabel}>
                <LockIcon color={colors.tint} />
                <ThemedText type="small" style={{ color: colors.textSecondary }}>
                  Passwort
                </ThemedText>
              </View>
              <View style={styles.passwordRight}>
                <ThemedText style={styles.value}>••••••••</ThemedText>
                <Pressable
                  onPress={onChangePassword}
                  disabled={sendingReset || !user?.email}
                  hitSlop={8}
                  style={({ pressed }) => pressed && styles.pressed}>
                  {sendingReset ? (
                    <ActivityIndicator size="small" color={colors.tint} />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: colors.tint }}>
                      Ändern
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>

            <RowDivider />

            {user?.is_admin ? (
              <View style={styles.accountTypeRow}>
                <View style={styles.blockHeader}>
                  <View style={styles.rowLabel}>
                    <Icon name="tag" size={18} color={colors.tint} />
                    <ThemedText type="small" style={{ color: colors.textSecondary }}>
                      Kontotyp
                    </ThemedText>
                  </View>
                  {savingAccountType ? <ActivityIndicator size="small" color={colors.tint} /> : null}
                </View>

                {/* Untereinander statt nebeneinander: Vier Stufen mit je einem
                    erklärenden Satz passen in keine Zeile. */}
                <View style={styles.tierOptions}>
                  {ACCOUNT_TIERS.map((tier) => (
                    <TierOption
                      key={tier.type}
                      tier={tier}
                      selected={accountType === tier.type}
                      disabled={savingAccountType}
                      onPress={() => onSelectAccountType(tier.type)}
                      colors={colors}
                    />
                  ))}
                </View>

                <ThemedText type="small" style={{ color: colors.textSecondary }}>
                  Die Stufe schaltet Rechte frei: Events erstellen ab Creator, der Business-Bereich
                  mit Umsatz und Reichweite ab Business. Du kannst jederzeit wechseln.
                </ThemedText>

                {accountTypeError ? (
                  <ThemedText type="small" style={styles.errorText}>
                    {accountTypeError}
                  </ThemedText>
                ) : null}
              </View>
            ) : (
              /* Ohne Admin-Rechte ist die Stufe eine Anzeige: Umstellen darf nur
                 der Server-seitig geprüfte Admin. Der Weg zum Upgrade läuft über
                 das Feld oben links auf der Startseite – bewusst nur dort, damit
                 es nicht zwei Wege gibt, die auseinanderlaufen können. */
              <View style={styles.accountTypeRow}>
                <View style={styles.blockHeader}>
                  <View style={styles.rowLabel}>
                    <Icon name="tag" size={18} color={colors.tint} />
                    <ThemedText type="small" style={{ color: colors.textSecondary }}>
                      Kontotyp
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.value}>{currentTier.label}</ThemedText>
                </View>

                <View style={styles.perkList}>
                  {currentTier.perks.map((perk) => (
                    <ThemedText key={perk} type="small" style={{ color: colors.textSecondary }}>
                      · {perk}
                    </ThemedText>
                  ))}
                </View>

                <ThemedText type="small" style={{ color: colors.textSecondary }}>
                  {'Deinen nächsten Schritt findest du über „Upgrade" oben links auf der Startseite.'}
                </ThemedText>
              </View>
            )}
          </SettingGroup>

          {/* Interessen */}
          <SettingGroup
            label="Interessen"
            hint="Wählen, was dir vorgeschlagen wird.">
            {!editingInterests ? (
              <View style={styles.interestView}>
                <View style={styles.blockHeader}>
                  <ThemedText type="small" style={{ color: colors.textSecondary }}>
                    Deine Interessen
                  </ThemedText>
                  <Pressable
                    onPress={startEditInterests}
                    disabled={editing !== null}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: editing !== null ? colors.textSecondary : colors.tint }}>
                      Bearbeiten
                    </ThemedText>
                  </Pressable>
                </View>
                {user?.interests && user.interests.length > 0 ? (
                  <View style={styles.interestChips}>
                    {user.interests.map((interest) => (
                      <View
                        key={interest.id}
                        style={[
                          styles.readonlyChip,
                          // Auf der blauen Gruppen-Karte eine Stufe kräftiger.
                          { backgroundColor: surface.chipBgStrong, borderColor: surface.chipBorder },
                        ]}>
                        <ThemedText type="small" style={{ color: surface.chipText }}>
                          {interest.name}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : (
                  <ThemedText type="small" style={{ color: colors.textSecondary }}>
                    Noch keine Interessen ausgewählt.
                  </ThemedText>
                )}
              </View>
            ) : (
              <View style={styles.interestView}>
                <ThemedText type="small" style={{ color: colors.textSecondary }}>
                  Tippe an, um Interessen aus- oder abzuwählen.
                </ThemedText>
                <InterestPicker
                  value={interestDraft}
                  onChange={setInterestDraft}
                  palette={interestPalette}
                  disabled={savingInterests}
                />
                {interestError ? (
                  <ThemedText type="small" style={styles.errorText}>
                    {interestError}
                  </ThemedText>
                ) : null}
                <View style={styles.editActions}>
                  <Pressable
                    onPress={cancelEditInterests}
                    disabled={savingInterests}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedText type="smallBold" style={{ color: colors.textSecondary }}>
                      Abbrechen
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={saveInterests}
                    disabled={savingInterests}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}>
                    {savingInterests ? (
                      <ActivityIndicator size="small" color={colors.tint} />
                    ) : (
                      <ThemedText type="smallBold" style={{ color: colors.tint }}>
                        Speichern
                      </ThemedText>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
          </SettingGroup>

          {/* Benachrichtigungen. Der Vorbehalt („greift noch nicht") steht als
              `RowNote` UNTEN in der Gruppe, nicht in der Einordnung: Vor dem
              Aufklappen weiß man noch nicht, worauf er sich bezieht. */}
          <SettingGroup
            label="Benachrichtigungen"
            hint="Festlegen, worüber wir dich informieren.">
            <SwitchRow
              icon="map-pin"
              title="Neues in deiner Nähe"
              hint="Wenn jemand ein Event in deinem Umkreis erstellt"
              value={settings.notifyNearby}
              onValueChange={(v) => update('notifyNearby', v)}
            />
            <RowDivider />
            <SwitchRow
              icon="clock"
              title="Erinnerung vor dem Start"
              hint="Kurz bevor ein Event losgeht, bei dem du dabei bist"
              value={settings.notifyReminder}
              onValueChange={(v) => update('notifyReminder', v)}
            />
            <RowDivider />
            <SwitchRow
              icon="users"
              title="Neue Teilnehmer:innen"
              hint="Wenn jemand deinem Event beitritt"
              value={settings.notifyJoins}
              onValueChange={(v) => update('notifyJoins', v)}
            />
            <RowDivider />
            <SwitchRow
              icon="edit"
              title="Änderungen an Events"
              hint="Neue Uhrzeit, neuer Ort oder abgesagt"
              value={settings.notifyUpdates}
              onValueChange={(v) => update('notifyUpdates', v)}
            />
            <RowDivider />
            <SwitchRow
              icon="mail"
              title="Wochenrückblick"
              hint="Einmal pro Woche, was du verpasst hast"
              value={settings.notifyDigest}
              onValueChange={(v) => update('notifyDigest', v)}
            />
            <RowDivider />
            <RowNote>
              Der Versand wird gerade aufgebaut. Deine Auswahl ist gespeichert und gilt, sobald es
              losgeht.
            </RowNote>
          </SettingGroup>

          {/* Standort & Privatsphäre */}
          <SettingGroup
            label="Standort & Privatsphäre"
            hint="Standort, Vibration und Klänge einstellen.">
            <SwitchRow
              icon="compass"
              title="Standort verwenden"
              hint={
                settings.useLocation
                  ? 'Für „In deiner Nähe" und Entfernungen auf den Karten'
                  : 'Aus – Entfernungen und „In deiner Nähe" bleiben leer'
              }
              value={settings.useLocation}
              onValueChange={(v) => update('useLocation', v)}
            />
            <RowDivider />
            <SwitchRow
              icon="vibrate"
              title="Vibration"
              hint={
                settings.haptics
                  ? 'Kurze Rückmeldung beim Auswählen und Beitreten'
                  : 'Aus – die App bleibt still'
              }
              value={settings.haptics}
              onValueChange={(v) => update('haptics', v)}
            />
            <RowDivider />
            <SwitchRow
              icon="speaker"
              title="Klänge"
              hint={
                settings.sounds
                  ? 'Kurze Töne beim Beitreten und bei erreichten Zielen'
                  : 'Aus – Töne gibt es nur, wenn du sie einschaltest'
              }
              value={settings.sounds}
              onValueChange={(next) => {
                update('sounds', next);
                // Beim Einschalten einmal vorspielen: Sonst schaltet man einen
                // Ton ein, hört nichts und weiß nicht, ob es funktioniert.
                // Beim Ausschalten wäre ein Ton widersprüchlich.
                if (next) previewSound();
              }}
            />
            <RowDivider />
            <LinkRow
              icon="key"
              title="Gespeicherte Zugangsdaten löschen"
              hint="Entfernt E-Mail und Passwort von diesem Gerät"
              onPress={onForgetDevice}
            />
            <RowDivider />
            <LinkRow
              icon="lock"
              title="Datenschutz"
              hint="Was wir speichern und warum"
              onPress={() => openLegal('privacy')}
            />
            <RowDivider />
            <LinkRow
              icon="ban"
              title="Blockierte Konten"
              hint="Wen du blockiert hast – und wie du es zurücknimmst"
              onPress={() => router.push('/blocked')}
            />
          </SettingGroup>

          {/* Darstellung */}
          <SettingGroup label="Darstellung" hint="Zwischen hell und dunkel wechseln.">
            <SwitchRow
              icon="contrast"
              title="Systemeinstellung folgen"
              hint="Hell oder dunkel wie dein Handy"
              value={followsSystem}
              onValueChange={(on) => (on ? followSystem() : setDark(isDark))}
            />
            <RowDivider />
            <SwitchRow
              icon="moon"
              title="Dark Mode"
              hint={followsSystem ? 'Wird gerade vom System bestimmt' : 'Dunklere Farbpalette für die App'}
              value={isDark}
              onValueChange={setDark}
              disabled={followsSystem}
            />
          </SettingGroup>

          {/* Hilfe */}
          <SettingGroup
            label="Hilfe & Support"
            hint="Antworten finden oder uns schreiben.">
            <LinkRow icon="help" title="Hilfe & häufige Fragen" onPress={() => openLink(Links.help)} />
            <RowDivider />
            <LinkRow
              icon="chat"
              title="Feedback senden"
              hint="Was fehlt dir? Was nervt?"
              onPress={() => openLink(supportMailto('Feedback zu GÖ4Fun'))}
            />
            <RowDivider />
            <LinkRow
              icon="flag"
              title="Problem melden"
              hint="Fehler, unangemessene Inhalte oder Nutzer"
              onPress={() =>
                openLink(
                  supportMailto(
                    'Problem melden',
                    'Was ist passiert?\n\nWo ist es passiert (Event, Nutzer, Screen)?\n\n',
                  ),
                )
              }
            />
          </SettingGroup>

          {/* Rechtliches & Über.
              Die Texte liegen jetzt IN der App (src/domain/legal.ts) und nicht
              mehr hinter einem Link nach draußen. Zwei Gründe: Die Store-Prüfung
              will sie aus der App erreichbar sehen, und wer im Funkloch wissen
              will, wer für ein Event verantwortlich ist, kommt an eine externe
              Seite nicht heran. Die Fassung im Netz steht unten in jedem
              Dokument als Zweitweg. */}
          <SettingGroup
            label="Rechtliches"
            hint="Nutzungsbedingungen, Haftung, Impressum lesen.">
            <LinkRow
              icon="document"
              title="Nutzungsbedingungen"
              hint="Die Regeln für die Nutzung"
              onPress={() => openLegal('terms')}
            />
            <RowDivider />
            <LinkRow
              icon="shield"
              title="Haftung und Events"
              hint="Wer für ein Event verantwortlich ist – und wer nicht"
              onPress={() => openLegal('liability')}
            />
            <RowDivider />
            <LinkRow
              icon="users"
              title="Regeln für das Miteinander"
              hint="Was hier geht und was nicht"
              onPress={() => openLegal('conduct')}
            />
            <RowDivider />
            <LinkRow icon="building" title="Impressum" onPress={() => openLegal('imprint')} />
            <RowDivider />
            <LinkRow icon="info" title="App-Version" value={`${APP_VERSION} · Stand ${LEGAL_VERSION}`} />
          </SettingGroup>

          {/* Konto beenden */}
          <SettingGroup
            label="Konto beenden"
            hint="Dein Konto endgültig löschen.">
            <LinkRow
              icon="trash"
              title="Konto löschen"
              hint="Konto, Events und Verlauf endgültig entfernen"
              onPress={onDeleteAccount}
              danger
            />
          </SettingGroup>

          <Pressable
            onPress={onLogout}
            style={({ pressed }) => [
              styles.logoutButton,
              { borderColor: surface.chipBorder },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={{ color: '#ef4444' }}>
              Abmelden
            </ThemedText>
          </Pressable>
        </KeyboardForm>
      </View>
    </HomeBackground>
  );
}

type ThemeColors = ReturnType<typeof useTheme>;

/**
 * Eine Stufe in der Kontotyp-Auswahl.
 *
 * Was die Stufe kann, steht nur bei der ausgewählten: Vier Listen gleichzeitig
 * wären eine Wand aus Text. Der eine Satz (`tagline`) reicht, um zu erkennen,
 * worum es geht – die Einzelheiten kommen, sobald man sie gewählt hat.
 */
function TierOption({
  tier,
  selected,
  disabled,
  onPress,
  colors,
}: {
  tier: AccountTier;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  const surface = useBrandSurface();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.tierOption,
        {
          backgroundColor: selected ? surface.chipBgStrong : 'transparent',
          borderColor: selected ? colors.tint : surface.chipBorder,
        },
        pressed && styles.pressed,
      ]}>
      <View style={styles.tierHead}>
        <ThemedText type="smallBold" style={{ color: selected ? colors.tint : colors.text }}>
          {tier.label}
        </ThemedText>
        {selected ? (
          <ThemedText type="small" style={{ color: colors.tint }}>
            ✓ aktiv
          </ThemedText>
        ) : null}
      </View>

      <ThemedText type="small" style={{ color: colors.textSecondary }}>
        {tier.tagline}
      </ThemedText>

      {selected ? (
        <View style={styles.perkList}>
          {tier.perks.map((perk) => (
            <ThemedText key={perk} type="small" style={{ color: colors.textSecondary }}>
              · {perk}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Konto-Zeile mit Inline-Bearbeitung: zeigt normalerweise Wert + „Bearbeiten“;
 * beim Bearbeiten ein Eingabefeld mit Speichern/Abbrechen.
 */
function EditableRow({
  field,
  icon,
  label,
  displayValue,
  editValue,
  prefix,
  keyboardType = 'default',
  colors,
  editing,
  draft,
  onChangeDraft,
  error,
  saving,
  onStart,
  onCancel,
  onSave,
}: {
  field: EditableField;
  /** Symbol-Name aus dem Set – dieselbe Sprache wie SwitchRow und LinkRow. */
  icon: UiIconName;
  label: string;
  displayValue: string;
  editValue: string;
  prefix?: string;
  keyboardType?: 'default' | 'email-address';
  colors: ThemeColors;
  editing: EditableField | null;
  draft: string;
  onChangeDraft: (value: string) => void;
  error: string | null;
  saving: boolean;
  onStart: (field: EditableField, current: string) => void;
  onCancel: () => void;
  onSave: (field: EditableField) => void;
}) {
  const isEditing = editing === field;

  if (!isEditing) {
    return (
      <View style={styles.row}>
        <View style={styles.rowLabel}>
          <Icon name={icon} size={20} color={colors.tint} />
          <ThemedText type="small" style={{ color: colors.textSecondary }}>
            {label}
          </ThemedText>
        </View>
        <View style={styles.passwordRight}>
          <ThemedText numberOfLines={1} style={styles.value}>
            {displayValue}
          </ThemedText>
          <Pressable
            onPress={() => onStart(field, editValue)}
            disabled={editing !== null}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText
              type="smallBold"
              style={{ color: editing !== null ? colors.textSecondary : colors.tint }}>
              Bearbeiten
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.editRow}>
      <View style={styles.rowLabel}>
        <Icon name={icon} size={20} color={colors.tint} />
        <ThemedText type="small" style={{ color: colors.textSecondary }}>
          {label}
        </ThemedText>
      </View>

      {/* Kompakte Zeile: `fieldStyle`/`style` drücken die Standardhöhe des
          Feldes auf Zeilenmaß. Fehlertext und Fehlerrand kommen aus dem Feld
          selbst – deshalb steht hier keine eigene Fehlerzeile mehr. */}
      <TextField
        value={draft}
        onChangeText={onChangeDraft}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        editable={!saving}
        onSubmitEditing={() => onSave(field)}
        error={error ?? undefined}
        leftIcon={prefix ? <ThemedText style={{ color: colors.textSecondary }}>{prefix}</ThemedText> : undefined}
        fieldStyle={[styles.inputWrap, { backgroundColor: colors.background }]}
        style={styles.input}
      />

      <View style={styles.editActions}>
        <Pressable
          onPress={onCancel}
          disabled={saving}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={{ color: colors.textSecondary }}>
            Abbrechen
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => onSave(field)}
          disabled={saving}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <ThemedText type="smallBold" style={{ color: colors.tint }}>
              Speichern
            </ThemedText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
    gap: Spacing.four,
  },
  header: { gap: Spacing.half, marginBottom: Spacing.one },
  mascot: { marginTop: Spacing.two },
  title: { fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    minHeight: 56,
    gap: Spacing.three,
  },
  editRow: {
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  value: {
    fontWeight: '600',
    flexShrink: 1,
  },
  passwordRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  inputWrap: {
    // `minHeight: 0` hebt die 56 px des Standardfeldes auf – diese Zeile sitzt
    // in einer Liste und soll Zeilenhöhe haben, keine Formularhöhe.
    minHeight: 0,
    borderWidth: 1,
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  accountTypeRow: {
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  // Gleiche Maße wie die Emoji-Spalte in setting-row.tsx, damit die Zeile mit
  // den übrigen Einträgen der Gruppe fluchtet.
  rowIcon: { fontSize: 18, lineHeight: 24, width: 24, textAlign: 'center' },
  tierOptions: {
    gap: Spacing.two,
  },
  tierOption: {
    borderRadius: Radius.field,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  tierHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  perkList: {
    gap: 1,
    marginTop: Spacing.one,
  },
  interestView: {
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  // Kopfzeile eines mehrzeiligen Blocks: Beschriftung links, Aktion/Spinner rechts.
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  interestChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  readonlyChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  logoutButton: {
    marginTop: Spacing.two,
    alignSelf: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: 999,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
