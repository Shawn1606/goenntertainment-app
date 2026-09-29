import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { BrandButton } from '@/components/ui/brand-button';
import { GlassSurface } from '@/components/ui/glass';
import { TextField } from '@/components/ui/text-field';
import { formatDateTimeCompact, formatDay } from '@/domain/date-format';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';
import { useBrandSurface } from '@/hooks/use-theme';
import { accountLabel } from '@/domain/account';
import { ApiError, type AdminUser, type ImageUpload, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { UiIconName } from '@/domain/ui-icon';
import { confirmAction } from '@/lib/confirm';

const TIMEOUTS: { label: string; minutes: number }[] = [
  { label: '1 Std', minutes: 60 },
  { label: '1 Tag', minutes: 60 * 24 },
  { label: '7 Tage', minutes: 60 * 24 * 7 },
];

/** Sperr-Status als kurzer Text, oder null wenn aktiv. */
function banLabel(u: AdminUser): string | null {
  if (!u.banned) return null;
  if (u.banned_permanent) return 'Gebannt';
  return `Timeout bis ${formatDateTimeCompact(u.banned_until)}`;
}

export default function AdminUsersScreen() {
  const insets = useSafeAreaInsets();
  // Das Aktions-Blatt klebt am unteren Rand und liegt in einem `Modal` – dort
  // gibt es keine ScrollView, die etwas freischieben könnte. Also wandert die
  // Tastaturhöhe direkt in den unteren Innenabstand.
  const keyboardInset = useKeyboardInset();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Aktions-Menü für einen ausgewählten Nutzer.
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<ImageUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.adminUsers(token);
      setUsers(res.data);
    } catch {
      setError('Nutzer konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function openSheet(u: AdminUser) {
    setSelected(u);
    setRenaming(false);
    setRenameValue(u.username ?? '');
    setReason('');
    setEvidence(null);
    setSheetError(null);
  }

  // Beweis-Bild aus der Galerie wählen (optional).
  async function pickEvidence() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Kein Zugriff', 'Bitte erlaube den Zugriff auf deine Galerie.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setEvidence({
      uri: asset.uri,
      name: asset.fileName ?? `beweis.${asset.uri.split('.').pop() ?? 'jpg'}`,
      type: asset.mimeType ?? 'image/jpeg',
    });
  }

  function closeSheet() {
    setSelected(null);
    setBusy(false);
  }

  // Führt eine Aktion aus, lädt neu und schließt (bei Erfolg) das Menü.
  const run = useCallback(
    async (fn: () => Promise<unknown>, close = true) => {
      if (!token) return;
      setBusy(true);
      setSheetError(null);
      try {
        await fn();
        await load();
        if (close) closeSheet();
      } catch (e) {
        setSheetError(e instanceof ApiError ? e.firstError() : 'Aktion fehlgeschlagen.');
      } finally {
        setBusy(false);
      }
    },
    [token, load],
  );

  async function onRename() {
    if (!token || !selected) return;
    await run(() => api.adminRenameUser(token, selected.id, renameValue.trim()));
  }

  /** Prüft, dass ein Grund eingegeben wurde (Pflicht für Timeout/Bann). */
  function reasonOk(): boolean {
    if (reason.trim().length < 3) {
      setSheetError('Bitte einen Grund angeben (mind. 3 Zeichen) – der Nutzer sieht ihn beim Login.');
      return false;
    }
    return true;
  }

  async function onTimeout(minutes: number) {
    if (!token || !selected || !reasonOk()) return;
    await run(() => api.adminTimeoutUser(token, selected.id, minutes, reason.trim(), evidence));
  }

  async function onBan() {
    if (!token || !selected || !reasonOk()) return;
    const ok = await confirmAction(
      'Nutzer bannen',
      `„${selected.name}" dauerhaft sperren? Die Person kann sich dann nicht mehr anmelden.`,
      'Bannen',
      true,
    );
    if (ok) await run(() => api.adminBanUser(token, selected.id, reason.trim(), evidence));
  }

  async function onUnban() {
    if (!token || !selected) return;
    await run(() => api.adminUnbanUser(token, selected.id));
  }

  async function onDelete() {
    if (!token || !selected) return;
    const ok = await confirmAction(
      'Nutzer löschen',
      `„${selected.name}" endgültig löschen? Alle Events und Daten dieser Person gehen verloren.`,
      'Löschen',
      true,
    );
    if (ok) await run(() => api.adminDeleteUser(token, selected.id));
  }

  const header = <Stack.Screen options={{ headerShown: true, title: 'Alle Nutzer' }} />;

  if (!user?.is_admin) {
    return (
      <HomeBackground style={[styles.screen, styles.centered]}>
        {header}
        <ThemedText style={{ color: surface.textMuted }}>Kein Admin-Zugang.</ThemedText>
      </HomeBackground>
    );
  }

  return (
    <HomeBackground style={styles.screen}>
      {header}
      <FlatList
        data={users}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        ListHeaderComponent={
          <ThemedText type="small" style={[styles.count, { color: surface.textMuted }]}>
            {users.length} Nutzer insgesamt · zum Verwalten antippen
          </ThemedText>
        }
        renderItem={({ item }) => {
          const status = banLabel(item);
          return (
            <Pressable
              onPress={() => openSheet(item)}
              style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <GlassSurface radius={Radius.card} style={styles.card}>
              <View style={[styles.avatar, { backgroundColor: surface.chipBg }]}>
                <ThemedText type="smallBold" style={{ color: surface.chipText }}>
                  {item.name?.trim()?.[0]?.toUpperCase() ?? '?'}
                </ThemedText>
              </View>

              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  {item.is_admin ? (
                    <ThemedText
                      type="small"
                      style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBg }]}>
                      ADMIN
                    </ThemedText>
                  ) : null}
                </View>

                <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                  {[item.username ? `@${item.username}` : null, accountLabel(item.account_type)]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>

                <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                  {item.email}
                </ThemedText>

                <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
                  {item.hosted_count} erstellt · {item.joined_count} beigetreten
                  {item.created_at ? ` · seit ${formatDay(item.created_at)}` : ''}
                </ThemedText>

                {status ? (
                  <ThemedText type="small" style={{ color: '#ef4444', fontSize: 11 }}>
                    {status}
                  </ThemedText>
                ) : null}
              </View>

              <ThemedText style={{ color: surface.accent, fontSize: 20 }}>›</ThemedText>
              </GlassSurface>
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={surface.accent} />
            </View>
          ) : (
            <View style={styles.centered}>
              <ThemedText style={{ color: error ? '#ef4444' : surface.textMuted, textAlign: 'center' }}>
                {error ?? 'Noch keine Nutzer.'}
              </ThemedText>
            </View>
          )
        }
      />

      {/* Aktions-Menü */}
      <Modal
        visible={selected !== null}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <GlassSurface
          tone="panel"
          radius={Radius.panel}
          style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four + keyboardInset }]}>
          {selected ? (
            <>
              <ThemedText type="smallBold" style={{ color: surface.text }}>
                {selected.name}
              </ThemedText>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {selected.username ? `@${selected.username} · ` : ''}
                {selected.email}
              </ThemedText>
              {banLabel(selected) ? (
                <ThemedText type="small" style={{ color: '#ef4444' }}>
                  {banLabel(selected)}
                  {selected.ban_reason ? ` · Grund: ${selected.ban_reason}` : ''}
                </ThemedText>
              ) : null}
              {sheetError ? (
                <ThemedText type="small" style={{ color: '#ef4444' }}>
                  {sheetError}
                </ThemedText>
              ) : null}

              {renaming ? (
                <View style={styles.renameBox}>
                  <TextField
                    label="Neuer Benutzername"
                    value={renameValue}
                    onChangeText={setRenameValue}
                    autoCapitalize="none"
                    placeholder="benutzername"
                  />
                  <View style={styles.rowButtons}>
                    <View style={styles.flex1}>
                      <BrandButton title="Speichern" onPress={onRename} loading={busy} />
                    </View>
                    <Pressable
                      onPress={() => setRenaming(false)}
                      style={[styles.secondaryBtn, { borderColor: surface.cardBorder }]}>
                      <ThemedText type="small" style={{ color: surface.textMuted }}>
                        Zurück
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  <ActionRow label="Umbenennen" icon="edit" onPress={() => setRenaming(true)} surface={surface} disabled={busy} />

                  {selected.banned ? (
                    <ActionRow label="Sperre aufheben" icon="check" onPress={onUnban} surface={surface} disabled={busy} />
                  ) : (
                    <>
                      <TextField
                        label="Grund (Pflicht)"
                        value={reason}
                        onChangeText={setReason}
                        placeholder="z. B. Spam, Beleidigung …"
                      />

                      {/* Optionaler Bild-Beweis (Screenshot) */}
                      {evidence ? (
                        <View style={styles.evidenceRow}>
                          <Image source={{ uri: evidence.uri }} style={styles.evidenceThumb} resizeMode="cover" />
                          <ThemedText type="small" style={{ color: surface.textMuted, flex: 1 }} numberOfLines={1}>
                            Beweis-Bild angehängt
                          </ThemedText>
                          <Pressable onPress={() => setEvidence(null)} hitSlop={8}>
                            <ThemedText type="small" style={{ color: '#ef4444' }}>
                              Entfernen
                            </ThemedText>
                          </Pressable>
                        </View>
                      ) : (
                        <ActionRow
                          label="Beweis-Bild anhängen (optional)" icon="paperclip"
                          onPress={pickEvidence}
                          surface={surface}
                          disabled={busy}
                        />
                      )}

                      <ThemedText type="small" style={[styles.groupLabel, { color: surface.textMuted }]}>
                        Timeout (befristet sperren)
                      </ThemedText>
                      <View style={styles.rowButtons}>
                        {TIMEOUTS.map((t) => (
                          <Pressable
                            key={t.minutes}
                            disabled={busy}
                            onPress={() => onTimeout(t.minutes)}
                            style={[styles.timeoutBtn, { borderColor: surface.cardBorder, backgroundColor: surface.chipBg }]}>
                            <ThemedText type="small" style={{ color: surface.chipText }}>
                              {t.label}
                            </ThemedText>
                          </Pressable>
                        ))}
                      </View>

                      <ActionRow label="Dauerhaft bannen" icon="ban" onPress={onBan} surface={surface} disabled={busy} danger />
                    </>
                  )}

                  <ActionRow label="Nutzer löschen" icon="trash" onPress={onDelete} surface={surface} disabled={busy} danger />

                  {busy ? <ActivityIndicator color={surface.accent} style={{ marginTop: Spacing.two }} /> : null}
                </View>
              )}
            </>
          ) : null}
        </GlassSurface>
      </Modal>
    </HomeBackground>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

function ActionRow({
  label,
  icon,
  onPress,
  surface,
  disabled,
  danger,
}: {
  label: string;
  /** Symbol links – trennt die Zeilen schneller als der Text allein. */
  icon?: UiIconName;
  onPress: () => void;
  surface: Surface;
  disabled?: boolean;
  danger?: boolean;
}) {
  const tint = danger ? '#ef4444' : surface.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionRow,
        { borderColor: surface.cardBorder },
        pressed && { opacity: 0.6 },
        disabled && { opacity: 0.4 },
      ]}>
      {icon ? <Icon name={icon} size={17} color={tint} /> : null}
      <ThemedText type="small" style={{ color: tint }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  count: { marginBottom: Spacing.three },
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.field,
    padding: Spacing.three,
    alignItems: 'center',
  },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.four,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  actions: { gap: Spacing.two, marginTop: Spacing.two },
  groupLabel: { marginTop: Spacing.two },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowButtons: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  timeoutBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  evidenceThumb: { width: 40, height: 40, borderRadius: 8 },
  renameBox: { gap: Spacing.three, marginTop: Spacing.two },
  flex1: { flex: 1 },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    justifyContent: 'center',
  },
});
