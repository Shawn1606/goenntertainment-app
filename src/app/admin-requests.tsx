/**
 * Admin: Anfragen auf eine höhere Kontostufe bestätigen oder ablehnen.
 *
 * ## Warum es diese Liste gibt
 *
 * Creator, Business und Business Plus schalten Rechte frei: veröffentlichen,
 * Zahlen sehen, Events hervorheben. Wer sich das selbst geben kann, braucht die
 * Stufe nicht – deshalb fragt die Person an (Upgrade-Bildschirm) und ein Admin
 * entscheidet. Vorher ging dieser Weg per Support-Mail: Die Anfrage lag im
 * Postfach, die Entscheidung in der Datenbank, und niemand konnte sagen, was
 * gerade offen ist. Jetzt liegt beides hier.
 *
 * ## Reihenfolge
 *
 * Offene zuerst, darin die **ältesten oben** – wer am längsten wartet, steht
 * vorne. Entschiedene bleiben darunter stehen: Man will nachsehen können, was
 * man gestern entschieden hat, ohne die Datenbank zu öffnen.
 *
 * ## Warum das Ablehnen ein Blatt aufmacht und das Bestätigen nicht
 *
 * Bestätigen ist die erwartete Antwort und braucht keine Begründung – eine
 * Rückfrage („wirklich?") genügt. Ablehnen ist für die andere Seite eine
 * Enttäuschung, und ein Grund ist das Mindeste, was man dazu sagen kann. Er
 * bleibt freiwillig: ein Pflichtfeld hätte hier nur zu „nein" als Grund geführt.
 */
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { BrandButton } from '@/components/ui/brand-button';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { accountLabel, rankOf } from '@/domain/account';
import { billingPeriodAdverb, priceLabel } from '@/domain/billing-period';
import { formatDay } from '@/domain/date-format';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';
import { useBrandSurface } from '@/hooks/use-theme';
import { ApiError, type AdminUpgradeRequest, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';

export default function AdminRequestsScreen() {
  const insets = useSafeAreaInsets();
  // Das Blatt liegt in einem `Modal`, dort schiebt keine ScrollView etwas frei –
  // die Tastaturhöhe wandert deshalb in den unteren Innenabstand (wie in
  // admin-users.tsx).
  const keyboardInset = useKeyboardInset();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [items, setItems] = useState<AdminUpgradeRequest[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Welche Anfrage gerade entschieden wird – sperrt genau ihre Knöpfe. */
  const [busyId, setBusyId] = useState<number | null>(null);

  /** Anfrage, die abgelehnt werden soll (öffnet das Blatt). */
  const [rejecting, setRejecting] = useState<AdminUpgradeRequest | null>(null);
  const [reason, setReason] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.adminUpgradeRequests(token);
      setItems(res.data);
      setPending(res.pending);
    } catch {
      setError('Anfragen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onApprove(request: AdminUpgradeRequest) {
    if (!token) return;
    const label = accountLabel(request.requested_type);
    const ok = await confirmAction(
      `${label} freischalten`,
      `„${request.user.name}" auf ${label} setzen? Die Stufe gilt sofort.`,
      'Bestätigen',
    );
    if (!ok) return;

    setBusyId(request.id);
    setError(null);
    try {
      await api.adminApproveUpgrade(token, request.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.firstError() : 'Bestätigen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  }

  async function onReject() {
    if (!token || !rejecting) return;
    setBusyId(rejecting.id);
    setSheetError(null);
    try {
      await api.adminRejectUpgrade(token, rejecting.id, reason.trim());
      setRejecting(null);
      setReason('');
      await load();
    } catch (e) {
      setSheetError(e instanceof ApiError ? e.firstError() : 'Ablehnen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  }

  const header = <Stack.Screen options={{ headerShown: true, title: 'Konto-Anfragen' }} />;

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
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="small" style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBg }]}>
              KONTO-ANFRAGEN
            </ThemedText>
            <ThemedText style={[styles.title, { color: surface.text }]}>
              {pending > 0 ? `${pending} offen` : 'Nichts offen'}
            </ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Creator, Business und Business Plus schaltest du hier frei.
            </ThemedText>
            {error ? (
              <ThemedText type="small" style={styles.errorText}>
                {error}
              </ThemedText>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const open = item.status === 'pending';
          const busy = busyId === item.id;
          return (
            <GlassSurface tone={open ? 'accent' : 'card'} radius={Radius.card} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardHeadText}>
                  <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                    {item.user.name}
                    {item.user.username ? ` (@${item.user.username})` : ''}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                    {item.user.email}
                  </ThemedText>
                </View>
                <ThemedText
                  type="small"
                  style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBg }]}>
                  {accountLabel(item.requested_type).toUpperCase()}
                </ThemedText>
              </View>

              {/* Von wo nach wo – ohne diese Zeile müsste man raten, ob das ein
                  großer oder ein kleiner Schritt ist.

                  Nach einer Bestätigung steht die Person AUF der angefragten
                  Stufe; die Zeile hieße dann „Creator → Creator" und würde nur
                  noch Platz belegen. Deshalb erscheint sie, solange der Schritt
                  einer ist. */}
              {rankOf(item.user.account_type) < rankOf(item.requested_type) ? (
                <View style={styles.stepRow}>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    {accountLabel(item.user.account_type)}
                  </ThemedText>
                  <Icon name="trend-up" size={14} color={surface.accent} />
                  <ThemedText type="smallBold" style={{ color: surface.text }}>
                    {accountLabel(item.requested_type)}
                  </ThemedText>
                </View>
              ) : null}

              {item.message ? (
                <ThemedText type="small" style={{ color: surface.text }}>
                  {`„${item.message}"`}
                </ThemedText>
              ) : (
                <ThemedText type="small" style={{ color: surface.textMuted, fontStyle: 'italic' }}>
                  Ohne Begründung angefragt
                </ThemedText>
              )}

              {/* Der gewünschte Zeitraum steht hier und nicht in der Zeile
                  darüber: Er bleibt auch nach der Entscheidung ablesbar, während
                  „Standard → Business" verschwindet, sobald der Schritt getan
                  ist. Ohne ihn wäre „Business" zwei verschiedene Beträge. */}
              <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
                {[
                  `${billingPeriodAdverb(item.billing_period)} · ${priceLabel(item.requested_type, item.billing_period)}`,
                  item.created_at ? `angefragt am ${formatDay(item.created_at)}` : null,
                  item.user.member_since ? `Konto seit ${formatDay(item.user.member_since)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>

              {open ? (
                <View style={styles.actions}>
                  <View style={styles.flex1}>
                    <BrandButton title="Bestätigen" loading={busy} onPress={() => onApprove(item)} />
                  </View>
                  <Pressable
                    onPress={() => {
                      setRejecting(item);
                      setReason('');
                      setSheetError(null);
                    }}
                    disabled={busy}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.rejectBtn,
                      { borderColor: surface.cardBorder },
                      (pressed || busy) && { opacity: 0.5 },
                    ]}>
                    <ThemedText type="small" style={{ color: '#ef4444' }}>
                      Ablehnen
                    </ThemedText>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.decided}>
                  <Icon
                    name={item.status === 'approved' ? 'check' : 'close'}
                    size={14}
                    color={item.status === 'approved' ? '#22c55e' : '#ef4444'}
                  />
                  <ThemedText
                    type="small"
                    style={{ color: item.status === 'approved' ? '#22c55e' : '#ef4444', flex: 1 }}>
                    {item.status === 'approved' ? 'Bestätigt' : 'Abgelehnt'}
                    {item.decided_at ? ` am ${formatDay(item.decided_at)}` : ''}
                    {item.admin_name ? ` von ${item.admin_name}` : ''}
                    {item.decision_note ? ` · ${item.decision_note}` : ''}
                  </ThemedText>
                </View>
              )}
            </GlassSurface>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={surface.accent} />
            </View>
          ) : (
            <View style={styles.centered}>
              <ThemedText style={{ color: surface.textMuted, textAlign: 'center' }}>
                Noch keine Anfragen. Sie entstehen, wenn jemand im Upgrade-Bildschirm eine Stufe anfragt.
              </ThemedText>
            </View>
          )
        }
      />

      {/* Ablehnen mit freiwilligem Grund */}
      <Modal
        visible={rejecting !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setRejecting(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRejecting(null)} />
        <GlassSurface
          tone="panel"
          radius={Radius.panel}
          style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four + keyboardInset }]}>
          {rejecting ? (
            <>
              <ThemedText type="smallBold" style={{ color: surface.text }}>
                {accountLabel(rejecting.requested_type)} ablehnen
              </ThemedText>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {rejecting.user.name} behält {accountLabel(rejecting.user.account_type)}. Der Grund steht
                anschließend in der App unter der Anfrage.
              </ThemedText>
              {sheetError ? (
                <ThemedText type="small" style={styles.errorText}>
                  {sheetError}
                </ThemedText>
              ) : null}

              <TextField
                label="Grund (freiwillig)"
                value={reason}
                onChangeText={setReason}
                placeholder="z. B. Bitte erst ein Gewerbe nachweisen."
                maxLength={255}
              />

              <View style={styles.sheetActions}>
                <View style={styles.flex1}>
                  <BrandButton title="Ablehnen" loading={busyId === rejecting.id} onPress={onReject} />
                </View>
                <Pressable
                  onPress={() => setRejecting(null)}
                  style={[styles.rejectBtn, { borderColor: surface.cardBorder }]}>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    Zurück
                  </ThemedText>
                </Pressable>
              </View>
            </>
          ) : null}
        </GlassSurface>
      </Modal>
    </HomeBackground>
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
  header: { gap: Spacing.half, marginBottom: Spacing.three },
  badge: {
    alignSelf: 'flex-start',
    fontWeight: '800',
    letterSpacing: 1.4,
    fontSize: 10,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  title: { fontSize: 28, fontWeight: '800' },
  errorText: { color: '#ef4444' },
  card: { padding: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardHeadText: { flex: 1, gap: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  decided: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  flex1: { flex: 1 },
  rejectBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    justifyContent: 'center',
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
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
});
