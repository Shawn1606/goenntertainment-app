/**
 * Teilen-Blatt für ein Event.
 *
 * ## Zwei Arten von Zielen, klar getrennt
 *
 * Oben die **Gruppen-Chats**: Dort landet das Event als Karte, die man antippen
 * kann – die Empfänger:innen sind schon in der App und sagen mit einem Tipp zu.
 * Unten **außerhalb**: WhatsApp, Telegram, System-Dialog. Dort geht Text raus.
 *
 * Die Reihenfolge ist eine Aussage: Ein Event in die eigene Runde zu schicken
 * führt zu Zusagen, ein Text in einen fremden Chat zu einem „klingt gut". Was
 * öfter zum Ziel führt, steht oben.
 *
 * ## Warum das Blatt die Gruppen selbst lädt
 *
 * Es hängt an drei Stellen (Event-Popup, Karte, später mehr). Würde jede davon
 * die Gruppenliste mitgeben, müsste jede sie laden – und zwar auch dann, wenn
 * niemand teilt. Geladen wird beim Öffnen, also genau dann, wenn die Liste
 * gebraucht wird.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Spacing } from '@/constants/theme';
import { shareSubjectFor, shareTextFor, telegramUrl, whatsappUrl } from '@/domain/share-activity';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import { ApiError, api, type Activity, type FriendGroup } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';
import { openShareTarget, shareText } from '@/lib/share';

type Props = {
  /** Das zu teilende Event – `null` schließt das Blatt. */
  activity: Activity | null;
  onClose: () => void;
};

export function ShareSheet({ activity, onClose }: Props) {
  const surface = useBrandSurface();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [loading, setLoading] = useState(false);
  /** In welche Gruppen schon gesendet wurde – der Knopf sagt danach „Gesendet". */
  const [sentTo, setSentTo] = useState<number[]>([]);
  /** Welche Gruppe gerade sendet (damit nur diese Zeile einen Spinner zeigt). */
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = activity !== null;

  // Each opening starts fresh, and so does a token change while open, as
  // before. Reset while rendering, not in the effect (react.dev: "Adjusting
  // some state when a prop changes"); the effect below only fetches. Starts as
  // "closed", so a sheet that mounts open is reset and loads too.
  const [shownFor, setShownFor] = useState<{ visible: boolean; token: string | null }>({
    visible: false,
    token,
  });
  if (shownFor.visible !== visible || shownFor.token !== token) {
    setShownFor({ visible, token });
    if (visible) {
      setSentTo([]);
      setError(null);
      // Without a token nothing is fetched, so no spinner either.
      setLoading(Boolean(token));
    }
  }

  useEffect(() => {
    if (!visible || !token) return;
    let ignore = false;
    api
      .groups(token)
      .then(
        (res) => {
          if (!ignore) setGroups(res.data);
        },
        () => {
          // Kein Fehlertext: Die Gruppen sind hier ein Angebot, nicht der Zweck.
          // Fehlen sie, bleiben die Ziele außerhalb der App trotzdem benutzbar.
          if (!ignore) setGroups([]);
        },
      )
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [visible, token]);

  async function sendToGroup(group: FriendGroup) {
    if (!token || !activity || sending !== null) return;
    setSending(group.id);
    setError(null);
    try {
      await api.sendChatMessage(token, 'group', group.id, { activityId: activity.id });
      feedback.joined();
      setSentTo((prev) => [...prev, group.id]);
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Das Senden hat nicht geklappt.');
    } finally {
      setSending(null);
    }
  }

  async function sendOutside(kind: 'whatsapp' | 'telegram' | 'system') {
    if (!activity) return;
    const text = shareTextFor(activity);
    feedback.pressed();

    const outcome =
      kind === 'system'
        ? await shareText(text, shareSubjectFor(activity))
        : await openShareTarget(kind === 'whatsapp' ? whatsappUrl(text) : telegramUrl(text));

    if (outcome === 'failed') {
      feedback.failed();
      setError('Das ließ sich nicht öffnen.');
      return;
    }
    // Nach einem erfolgreichen Teilen schließt das Blatt: Wer zurückkommt, ist
    // fertig – ein offenes Blatt wäre dann eine Frage, die schon beantwortet ist.
    if (outcome === 'shared' || outcome === 'copied') onClose();
  }

  if (!activity) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Schließen" />

        <GlassSurface
          tone="panel"
          radius={Radius.panel}
          style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
          <View style={styles.handleZone}>
            <View style={[styles.handle, { backgroundColor: surface.cardBorder }]} />
          </View>

          <View style={styles.header}>
            <ThemedText type="subtitle" style={{ color: surface.text }}>
              Teilen
            </ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={2}>
              {activity.title}
            </ThemedText>
          </View>

          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
              In einen Gruppen-Chat
            </ThemedText>

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={surface.accent} />
              </View>
            ) : groups.length === 0 ? (
              <Pressable
                onPress={() => {
                  onClose();
                  router.push('/friends');
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.hint, pressed && styles.pressed]}>
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  Du hast noch keine Gruppe. Leg eine an – dann kannst du Events direkt in eure
                  Runde schicken.
                </ThemedText>
                <ThemedText type="smallBold" style={{ color: surface.accent }}>
                  Zu den Freunden ›
                </ThemedText>
              </Pressable>
            ) : (
              groups.map((group) => {
                const done = sentTo.includes(group.id);
                return (
                  <TargetRow
                    key={group.id}
                    icon={done ? 'check' : 'users'}
                    label={group.name}
                    hint={
                      done
                        ? 'Gesendet'
                        : group.members.length === 1
                          ? 'Nur du bist drin'
                          : `${group.members.length} Leute`
                    }
                    busy={sending === group.id}
                    done={done}
                    onPress={() => (done ? undefined : sendToGroup(group))}
                  />
                );
              })
            )}

            <View style={styles.divider} />

            <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
              Außerhalb der App
            </ThemedText>

            <TargetRow
              icon="chat"
              label="WhatsApp"
              hint="Öffnet WhatsApp mit fertiger Nachricht"
              onPress={() => sendOutside('whatsapp')}
            />
            <TargetRow
              icon="send"
              label="Telegram"
              hint="Öffnet Telegram mit fertiger Nachricht"
              onPress={() => sendOutside('telegram')}
            />
            <TargetRow
              icon="share"
              label="Andere Apps"
              hint="Mail, Signal, Notizen, Kopieren …"
              onPress={() => sendOutside('system')}
            />

            {error ? (
              <ThemedText type="small" style={styles.errorText}>
                {error}
              </ThemedText>
            ) : null}
          </ScrollView>

          <PressableScale
            onPress={onClose}
            haptic="none"
            scaleTo={0.97}
            style={[styles.closeButton, { borderColor: surface.cardBorder }]}>
            <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
              Schließen
            </ThemedText>
          </PressableScale>
        </GlassSurface>
      </View>
    </Modal>
  );
}

/**
 * Eine Zeile im Blatt: Symbol, Beschriftung, Erläuterung.
 *
 * Ein Baustein für Gruppen UND für die Ziele außerhalb – beide sind aus Sicht der
 * Bedienung dasselbe („hier tippen, dann geht es dorthin"). Zwei Zeilen-Arten
 * hätten zwei Layouts, die sich mit der Zeit auseinanderentwickeln.
 */
function TargetRow({
  icon,
  label,
  hint,
  busy = false,
  done = false,
  onPress,
}: {
  icon: UiIconName;
  label: string;
  hint: string;
  busy?: boolean;
  done?: boolean;
  onPress?: () => void;
}) {
  const surface = useBrandSurface();

  return (
    <Pressable
      onPress={onPress}
      disabled={busy || done || !onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} – ${hint}`}
      style={({ pressed }) => [
        styles.row,
        { borderColor: surface.chipBorder, backgroundColor: surface.chipBg },
        pressed && styles.pressed,
        done && styles.rowDone,
      ]}>
      <Icon name={icon} size={20} color={surface.accent} />
      <View style={styles.rowText}>
        <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
          {label}
        </ThemedText>
        <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
          {hint}
        </ThemedText>
      </View>
      {busy ? <ActivityIndicator size="small" color={surface.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: Radius.panel,
    borderTopRightRadius: Radius.panel,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    maxHeight: '85%',
  },
  handleZone: { paddingBottom: Spacing.three, alignItems: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { gap: 2, marginBottom: Spacing.three },
  list: { gap: Spacing.two, paddingBottom: Spacing.three },
  loading: { paddingVertical: Spacing.four, alignItems: 'center' },
  hint: { gap: Spacing.two, paddingVertical: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    minHeight: 56,
  },
  /** Gesendet: bleibt lesbar, ist aber sichtbar erledigt. */
  rowDone: { opacity: 0.65 },
  rowText: { flex: 1, gap: 1 },
  /** Nur Luft zwischen den beiden Zielgruppen – keine Linie: Die Überschriften
      trennen schon, eine Linie dazu wäre die zweite Trennung an derselben Stelle. */
  divider: { height: Spacing.two },
  closeButton: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  errorText: { color: '#ef4444' },
  pressed: { opacity: 0.7 },
});
