/**
 * Ein Chat-Raum – für eine Gruppe oder für ein Event.
 *
 * ## Ein Screen für beide Arten
 *
 * `kind` (`group` | `activity`) und `id` kommen als Parameter. Zwei Screens für
 * dasselbe Gespräch wären zwei Layouts, die auseinanderlaufen; der Unterschied
 * zwischen „Gruppe" und „Event" ist genau eine Zeile in der Kopfzeile.
 *
 * ## Nachfragen statt zuhören
 *
 * Das Backend hat keine offene Verbindung (siehe server/src/routes/chat.js).
 * Dieser Screen fragt deshalb alle {@link POLL_MS} nach dem, was **nach** der
 * höchsten bekannten ID kam. Das ist meist eine leere Antwort und damit ein
 * winziger Aufruf. Drei Dinge machen es erträglich:
 *
 *  - Gefragt wird nur, solange der Screen im Vordergrund ist (`useFocusEffect`).
 *  - Gefragt wird mit Cursor, nicht nach dem ganzen Verlauf.
 *  - Läuft eine Anfrage noch, wird keine zweite gestartet (`polling`-Merker) –
 *    sonst stapeln sich bei langsamem Netz die Abrufe.
 *
 * ## Warum die Liste nicht umgedreht ist
 *
 * Übliche Chats benutzen eine `inverted` FlatList. Hier steht eine normale
 * ScrollView, die ans Ende springt: Der Verlauf ist in dieser App kurz (eine
 * Runde verabredet sich, sie führt keinen Dauerchat), und `inverted` dreht auf
 * Android auch die Scroll-Schatten und die Reihenfolge beim Vorlesen um. Für
 * lange Verläufe wäre das die falsche Entscheidung – dann käme hier eine
 * FlatList hin.
 */
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { HomeBackground } from '@/components/home-background';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { MAX_MESSAGE_LENGTH, groupByDay, highestId, showsAuthor, validateDraft } from '@/domain/chat';
import { formatClock } from '@/domain/date-format';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';
import {
  ApiError,
  api,
  type Activity,
  type ChatKind,
  type ChatMessage,
  type ChatRoomMeta,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { BackButton } from '@/components/ui/icon-button';

/** Abstand zwischen zwei Nachfragen nach neuen Nachrichten. */
const POLL_MS = 4000;

export default function ChatScreen() {
  const params = useLocalSearchParams<{ kind?: string; id?: string; title?: string }>();
  const kind: ChatKind = params.kind === 'activity' ? 'activity' : 'group';
  const refId = Number(params.id) || 0;

  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const keyboard = useKeyboardInset();
  const { token } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [room, setRoom] = useState<ChatRoomMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  /** Ein angetipptes geteiltes Event – wird als vollständiges Popup gezeigt. */
  const [openActivity, setOpenActivity] = useState<Activity | null>(null);
  /** Die gemeldete Nachricht (`null` = kein Melde-Blatt offen). */
  const [reporting, setReporting] = useState<{ id: number; label: string } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /**
   * Höchste bekannte Nachrichten-ID. Als Ref und nicht als State: Der Zeitgeber
   * unten liest sie bei jedem Tick, und mit State müsste er dafür neu aufgesetzt
   * werden – ein Intervall, das sich selbst alle vier Sekunden neu anlegt.
   */
  const cursor = useRef(0);
  /** Läuft gerade ein Abruf? Verhindert, dass sich Abrufe stapeln. */
  const polling = useRef(false);

  const remember = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      // Nach ID zusammenführen: Die eben selbst gesendete Nachricht steht schon
      // in der Liste, und der nächste Abruf bringt sie erneut mit.
      const seen = new Set(prev.map((message) => message.id));
      const fresh = incoming.filter((message) => !seen.has(message.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh].sort((a, b) => a.id - b.id);
    });
    cursor.current = Math.max(cursor.current, highestId(incoming));
  }, []);

  /** Erster Aufbau: Verlauf und Kopfdaten. */
  const loadFirst = useCallback(async () => {
    if (!token || !refId) return;
    setError(null);
    try {
      const res = await api.chatMessages(token, kind, refId);
      setRoom(res.room);
      setMessages(res.data);
      cursor.current = highestId(res.data);
      // Beim Betreten ist gelesen, was da ist – dafür ist man hier.
      if (res.data.length > 0) {
        api.markChatRead(token, kind, refId, cursor.current).catch(() => {});
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'Diesen Chat gibt es nicht mehr.'
          : 'Der Chat ließ sich nicht laden. Läuft das Backend?',
      );
    } finally {
      setLoading(false);
    }
  }, [token, kind, refId]);

  /** Ein Tick: nur das, was nach dem Cursor kam. */
  const pollOnce = useCallback(async () => {
    if (!token || !refId || polling.current) return;
    polling.current = true;
    try {
      const res = await api.chatMessages(token, kind, refId, { after: cursor.current });
      if (res.data.length > 0) {
        remember(res.data);
        api.markChatRead(token, kind, refId, highestId(res.data)).catch(() => {});
      }
      // Kopfdaten mitziehen: Eine Gruppe kann zwischenzeitlich umbenannt worden
      // sein, und dann soll oben nicht der alte Name stehen bleiben.
      setRoom(res.room);
    } catch {
      // Ein fehlgeschlagener Tick bleibt still. Eine Fehlermeldung alle vier
      // Sekunden wäre für ein kurz weggebrochenes Netz die falsche Antwort.
    } finally {
      polling.current = false;
    }
  }, [token, kind, refId, remember]);

  useFocusEffect(
    useCallback(() => {
      loadFirst();
      const timer = setInterval(pollOnce, POLL_MS);
      return () => clearInterval(timer);
    }, [loadFirst, pollOnce]),
  );

  async function onSend() {
    if (!token || sending) return;
    const check = validateDraft(draft);
    if (!check.ok) {
      if (check.error) setError(check.error);
      return;
    }

    setSending(true);
    setError(null);
    const text = draft.trim();
    // Das Feld sofort leeren: Wer gesendet hat, will weitertippen und nicht
    // warten, bis das Netz geantwortet hat.
    setDraft('');
    try {
      const res = await api.sendChatMessage(token, kind, refId, { body: text });
      remember([res.data]);
      feedback.tapped();
    } catch (err) {
      feedback.failed();
      // Den Text zurückgeben, statt ihn zu verlieren – das ist der Unterschied
      // zwischen „nochmal senden" und „nochmal schreiben".
      setDraft(text);
      setError(err instanceof ApiError ? err.firstError() : 'Die Nachricht ging nicht raus.');
    } finally {
      setSending(false);
    }
  }

  async function onDelete(message: ChatMessage) {
    if (!token) return;
    const ok = await confirmAction(
      'Nachricht löschen',
      'Sie verschwindet für alle im Chat.',
      'Löschen',
      true,
    );
    if (!ok) return;
    try {
      await api.deleteChatMessage(token, message.id);
      setMessages((prev) => prev.filter((row) => row.id !== message.id));
      feedback.left();
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Löschen hat nicht geklappt.');
    }
  }

  /**
   * Antippen einer Nachricht: eigene bzw. als Verantwortliche:r löschen, fremde
   * melden. Beides über eine Rückfrage, weil ein einzelner Tipp auf eine
   * Nachricht sonst überraschend etwas täte.
   */
  async function onMessageAction(message: ChatMessage) {
    const mayDelete = message.is_mine || room?.can_moderate;
    if (mayDelete) {
      await onDelete(message);
      return;
    }
    setReporting({
      id: message.id,
      label: message.body || `Geteiltes Event: ${message.shared?.title ?? ''}`,
    });
  }

  /** Ein angetipptes geteiltes Event vollständig holen und im Popup zeigen. */
  async function openShared(activityId: number) {
    if (!token) return;
    feedback.tapped();
    try {
      const res = await api.activity(token, activityId);
      setOpenActivity(res.data);
    } catch {
      setError('Dieses Event gibt es nicht mehr.');
    }
  }

  const sections = useMemo(() => groupByDay(messages, new Date()), [messages]);

  const title = room?.title ?? params.title ?? 'Chat';
  const subtitle = kind === 'group' ? 'Gruppen-Chat' : 'Event-Chat';

  return (
    <HomeBackground style={styles.screen}>
      <View style={[styles.frame, { paddingTop: insets.top + Spacing.two }]}>
        {/* Kopfzeile */}
        <View style={styles.header}>
          <BackButton />
          <View style={styles.headerText}>
            <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
              {title}
            </ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {subtitle}
            </ThemedText>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={surface.accent} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            // Ans Ende springen, sobald der Inhalt wächst: Das Neueste ist das,
            // worum es geht. `animated: false` beim ersten Aufbau würde ruckeln,
            // deshalb immer sanft.
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {error ? <MascotError detail={error} onRetry={loadFirst} /> : null}

            {messages.length === 0 && !error ? (
              <View style={styles.empty}>
                <MascotEmpty mood="cheer" size={88} gesture="wave">
                  <ThemedText style={{ color: surface.text }}>Noch nichts geschrieben.</ThemedText>
                  <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                    {kind === 'group'
                      ? 'Schreib den ersten Satz – oder teile ein Event in diese Runde.'
                      : 'Frag, wer was mitbringt, oder sag, wo genau ihr euch trefft.'}
                  </ThemedText>
                </MascotEmpty>
              </View>
            ) : null}

            {sections.map((section) => (
              <View key={section.label} style={styles.section}>
                <View style={styles.dayRow}>
                  <View style={[styles.dayLine, { backgroundColor: surface.chipBorder }]} />
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    {section.label}
                  </ThemedText>
                  <View style={[styles.dayLine, { backgroundColor: surface.chipBorder }]} />
                </View>

                {section.messages.map((message, index) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    withAuthor={showsAuthor(message, section.messages[index - 1] ?? null)}
                    onLongPress={() => onMessageAction(message)}
                    onOpenShared={openShared}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        )}

        {/* Eingabe. Die Tastaturhöhe wandert in den unteren Innenabstand – siehe
            src/hooks/use-keyboard-inset.ts, warum nicht KeyboardAvoidingView. */}
        <View style={{ paddingBottom: insets.bottom + keyboard + Spacing.two }}>
          <GlassSurface tone="panel" radius={Radius.field} style={styles.inputBar}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Nachricht schreiben"
              placeholderTextColor={surface.textMuted}
              multiline
              maxLength={MAX_MESSAGE_LENGTH}
              editable={!sending}
              style={[styles.input, { color: surface.text }]}
              accessibilityLabel="Nachricht schreiben"
            />
            <Pressable
              onPress={onSend}
              disabled={sending || !validateDraft(draft).ok}
              accessibilityRole="button"
              accessibilityLabel="Senden"
              hitSlop={8}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: validateDraft(draft).ok ? surface.accent : surface.chipBg,
                },
                pressed && styles.pressed,
              ]}>
              {sending ? (
                <ActivityIndicator size="small" color={surface.accentText} />
              ) : (
                <Icon
                  name="send"
                  size={18}
                  color={validateDraft(draft).ok ? surface.accentText : surface.textMuted}
                />
              )}
            </Pressable>
          </GlassSurface>
        </View>
      </View>

      {/* Ein geteiltes Event vollständig – mit Beitreten. Genau das ist der Sinn
          des Teilens in einen Chat: aus „schau mal" wird eine Zusage. */}
      <ActivityDetailModal
        activity={openActivity}
        onClose={() => setOpenActivity(null)}
        onChanged={(updated) => setOpenActivity(updated)}
      />

      <ReportSheet
        target={reporting ? { type: 'message', id: reporting.id, label: reporting.label } : null}
        onClose={() => setReporting(null)}
      />
    </HomeBackground>
  );
}

/**
 * Eine Nachricht.
 *
 * Eigene rechts und in der Akzentfarbe, fremde links auf Glas – die räumliche
 * Trennung ist schneller zu lesen als jeder Name. Der Name steht nur über der
 * ersten Nachricht einer Folge (siehe `showsAuthor` in src/domain/chat.ts).
 */
function MessageRow({
  message,
  withAuthor,
  onLongPress,
  onOpenShared,
}: {
  message: ChatMessage;
  withAuthor: boolean;
  onLongPress: () => void;
  onOpenShared: (activityId: number) => void;
}) {
  const surface = useBrandSurface();
  const glass = useGlass();
  const mine = message.is_mine;

  return (
    <View style={[styles.messageWrap, mine ? styles.messageMine : styles.messageTheirs]}>
      {withAuthor && !mine ? (
        <ThemedText type="small" style={[styles.author, { color: surface.textMuted }]}>
          {message.user.name}
        </ThemedText>
      ) : null}

      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={
          mine ? 'Eigene Nachricht – lang drücken zum Löschen' : 'Nachricht – lang drücken zum Melden'
        }
        style={({ pressed }) => pressed && styles.pressed}>
        <View
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: surface.accent, borderColor: surface.accent }
              : { backgroundColor: glass.fill, borderColor: glass.border },
          ]}>
          {/* Geteiltes Event: eine Karte im Chat, antippbar. Ohne `activity_id`
              wurde es gelöscht – dann bleibt der Titel als Erinnerung, aber
              nichts mehr zum Öffnen. */}
          {message.shared ? (
            <Pressable
              onPress={
                message.shared.activity_id
                  ? () => onOpenShared(message.shared!.activity_id!)
                  : undefined
              }
              disabled={!message.shared.activity_id}
              accessibilityRole="button"
              accessibilityLabel={`Event ${message.shared.title}`}
              style={({ pressed }) => [
                styles.sharedCard,
                {
                  backgroundColor: mine ? 'rgba(255,255,255,0.16)' : surface.chipBg,
                  borderColor: mine ? 'rgba(255,255,255,0.28)' : surface.chipBorder,
                },
                pressed && styles.pressed,
              ]}>
              {message.shared.banner_url ? (
                <Image
                  source={{ uri: message.shared.banner_url }}
                  style={styles.sharedBanner}
                  contentFit="cover"
                />
              ) : null}
              <View style={styles.sharedText}>
                <ThemedText
                  type="smallBold"
                  style={{ color: mine ? surface.accentText : surface.text }}
                  numberOfLines={2}>
                  {message.shared.title}
                </ThemedText>
                <ThemedText
                  type="small"
                  style={{ color: mine ? surface.accentText : surface.textMuted }}
                  numberOfLines={1}>
                  {message.shared.activity_id
                    ? [message.shared.location, formatClock(message.shared.starts_at)]
                        .filter(Boolean)
                        .join(' · ') || 'Event ansehen'
                    : 'Dieses Event gibt es nicht mehr'}
                </ThemedText>
              </View>
              {message.shared.activity_id ? (
                <Icon
                  name="ticket"
                  size={18}
                  color={mine ? surface.accentText : surface.accent}
                />
              ) : null}
            </Pressable>
          ) : null}

          {message.body ? (
            <ThemedText style={{ color: mine ? surface.accentText : surface.text }}>
              {message.body}
            </ThemedText>
          ) : null}

          <ThemedText
            type="small"
            style={[
              styles.time,
              { color: mine ? surface.accentText : surface.textMuted },
            ]}>
            {formatClock(message.created_at)}
          </ThemedText>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  headerText: { flex: 1, gap: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.three, paddingBottom: Spacing.three, flexGrow: 1 },
  empty: { paddingTop: Spacing.five },
  centered: { textAlign: 'center' },
  section: { gap: Spacing.one },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth * 2 },
  messageWrap: { maxWidth: '86%' },
  messageMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  author: { paddingHorizontal: Spacing.two, paddingBottom: 2 },
  bubble: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  sharedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    padding: Spacing.two,
    minWidth: 220,
  },
  sharedBanner: { width: 44, height: 44, borderRadius: Spacing.two },
  sharedText: { flex: 1, gap: 1 },
  /** Die Uhrzeit ist Beiwerk – klein, rechts, gedämpft. */
  time: { alignSelf: 'flex-end', fontSize: 11, opacity: 0.75, fontFamily: FontFamily.regular },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    // Höchstens vier Zeilen: Danach scrollt das Feld, statt den Verlauf zu
    // verdrängen.
    maxHeight: 96,
    paddingVertical: Spacing.two,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
