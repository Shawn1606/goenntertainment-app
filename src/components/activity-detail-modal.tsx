import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityPoster } from '@/components/feed/activity-poster';
import { Mascot } from '@/components/mascot';
import { ReportSheet } from '@/components/report-sheet';
import { ShareSheet } from '@/components/share-sheet';
import { StoryAvatar } from '@/components/story-avatar';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Glow, PulseDot } from '@/components/ui/glow';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { OptionsSheet, type SheetOption } from '@/components/ui/options-sheet';
import { PressableScale } from '@/components/ui/pressable-scale';
import { useSheetDrag } from '@/components/ui/use-sheet-drag';
import { BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import { formatCount, participantsSentence, toggledLike } from '@/domain/activity-social';
import { calendarLinkFor } from '@/domain/calendar-link';
import { formatRelativeShort } from '@/domain/date-format';
import { formatDistance } from '@/domain/distance';
import { formatEventWhen } from '@/domain/event-when';
import type { UiIconName } from '@/domain/ui-icon';
import { urgencyFor } from '@/domain/urgency';
import { useSignals, useTheme } from '@/hooks/use-theme';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';
import { type Activity, type ActivityComment, api, ApiError, type ReportTarget } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { openCalendar } from '@/lib/open-calendar';

type Props = {
  /** Die anzuzeigende Activity – `null` schließt das Blatt. */
  activity: Activity | null;
  onClose: () => void;
  /** Nach jeder Änderung (Beitreten, Merken, Herz, Kommentar) mit dem neuen Stand. */
  onChanged?: (updated: Activity) => void;
  /**
   * Nach dem Löschen (eigene Aktivität oder als Admin). Der Aufrufer nimmt sie aus
   * seiner Liste; das Blatt schließt sich selbst. Ohne Rückruf bleibt die Liste
   * dahinter bis zum nächsten Laden stehen – gelöscht ist trotzdem.
   */
  onDeleted?: (id: number) => void;
  /** Optional: Route in der Karten-App (von der Karte gesetzt, dort sind Koordinaten bekannt). */
  onRoute?: () => void;
  /** Entfernung in km, falls bekannt. */
  distanceKm?: number | null;
  /** Gleich bei den Kommentaren öffnen – aus dem Sprechblasen-Symbol im Feed. */
  focusComments?: boolean;
};

/** Wie im Konto-Blatt: Die Auf-Bewegung läuft nur am Gerät, im Web steht das Blatt sofort. */
const NATIVE = Platform.OS !== 'web';

/** Höhe des Banners oben. */
const HERO = 280;

/** Ab hier ist der Banner weggescrollt und die kleine Leiste übernimmt. */
const COLLAPSE_START = HERO - 120;
const COLLAPSE_END = HERO - 60;

/** So lange bleibt der Jubel stehen, bevor er wieder verschwindet. */
const CELEBRATION_MS = 1700;

/** Höchstlänge eines Kommentars – wie auf dem Server. */
const MAX_COMMENT = 500;

const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** „Mittwoch, 30. September" – steht unter „Morgen, 18:00", das das Datum nicht nennt. */
function longDate(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${WEEKDAYS_LONG[date.getDay()]}, ${date.getDate()}. ${MONTHS_LONG[date.getMonth()]}`;
}

/**
 * Das Detail-Blatt einer Aktivität.
 *
 * ## Aufbau
 *
 *   ┌───────────────────────────────┐  ← oben bleibt ein Streifen der Seite
 *   │  ✕        [ Banner ]        … │     dahinter sichtbar: Das Blatt hebt
 *   │  „in 40 Min" · „2 Plätze frei" │     sich ab, man ist nicht „woanders".
 *   ├───────────────────────────────┤
 *   │  Titel, Host                  │
 *   │  [Wann] [Wo] [Dabei]          │  ← drei Kacheln statt einer Textwand
 *   │  Beschreibung                 │
 *   │  Wer ist dabei                │
 *   │  Kommentare                   │
 *   ├───────────────────────────────┤
 *   │  Herz Sprechblase Merken [Mit-]│  ← klebt unten, immer erreichbar
 *   │                     [machen]  │
 *   └───────────────────────────────┘
 *
 * ## Warum der Banner beim Scrollen zu einer kleinen Leiste wird
 *
 * Vorher war alles eine lange Liste, und nach dem ersten Wischen wusste man nicht
 * mehr, welches Event man gerade liest. Jetzt schrumpft der Banner beim Scrollen
 * zu einer schmalen Leiste mit Bild und Titel, die oben stehen bleibt – der
 * Zusammenhang ist nie weg, und Schließen ist immer einen Tipp entfernt.
 *
 * ## Warum die Knöpfe unten kleben
 *
 * Die Entscheidung („mitmachen?") fällt irgendwo beim Lesen, nicht erst am Ende.
 * Deshalb steht der Hauptknopf nicht unter dem Text, sondern in einer Leiste, die
 * nie wegscrollt. Daneben die Nebenhandlungen aus dem Feed an derselben Stelle:
 * Herz, Kommentar, Teilen, Merken. Alles Seltene (Kalender, Route, Melden,
 * Löschen) liegt hinter „…" oben rechts.
 *
 * ## Löschen
 *
 * Die eigene Aktivität – und als Admin JEDE. Das entscheidet dieses Blatt selbst
 * anhand des Kontos, damit es überall gilt, wo es aufgeht (Feed, Profil, Karte,
 * Suche, Chat); der Server prüft dieselbe Regel noch einmal.
 */
export function ActivityDetailModal({
  activity,
  onClose,
  onChanged,
  onDeleted,
  onRoute,
  distanceKm,
  focusComments,
}: Props) {
  const colors = useTheme();
  const signal = useSignals();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user, logout } = useAuth();
  const keyboard = useKeyboardInset();

  // Eigene Kopie, damit Zahlen und Knöpfe nach jeder Handlung sofort passen.
  const [current, setCurrent] = useState<Activity | null>(activity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [sharing, setSharing] = useState<Activity | null>(null);
  /** What the report sheet is open for: the event or one of its comments (F-08); null = closed. */
  const [reportTarget, setReportTarget] = useState<{ type: ReportTarget; id: number; label: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /** Kommentare samt dem Event, zu dem sie gehören – so zeigt ein neu geöffnetes Event nie die alten. */
  const [loaded, setLoaded] = useState<{ id: number; list: ActivityComment[] } | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const visible = activity !== null;
  const scrollRef = useRef<ScrollView>(null);
  /** Schon zu den Kommentaren gesprungen? Pro Öffnen nur einmal. */
  const jumped = useRef(false);
  // Als Zustand statt als Ref gehalten: Die Werte werden beim Zeichnen gelesen
  // (Interpolationen), und ein Ref darf man dort nicht anfassen.
  const [scrollY] = useState(() => new Animated.Value(0));

  /** 0 = weg, 1 = da. Trägt Abdunklung und Aufsteigen. */
  const [appear] = useState(() => new Animated.Value(0));
  const drag = useSheetDrag({ onDismiss: onClose, open: visible });

  // Neues Event → alles auf Anfang. Während des Zeichnens statt in einem Effekt
  // (so empfiehlt es React): sonst stünde für einen Durchgang das alte Event da.
  const [shownFor, setShownFor] = useState(activity);
  if (shownFor !== activity) {
    setShownFor(activity);
    setCurrent(activity);
    setError(null);
    setViews(activity?.views_count ?? null);
    setCelebrating(false);
    setSharing(null);
    setReportTarget(null);
    setMenuOpen(false);
    setComposing(false);
    setDraft('');
  }

  useEffect(() => {
    scrollY.setValue(0);
    jumped.current = false;
  }, [activity, scrollY]);

  useEffect(() => {
    if (!visible) {
      appear.setValue(0);
      return;
    }
    feedback.opened();
    if (!NATIVE) {
      appear.setValue(1);
      return;
    }
    appear.setValue(0);
    const rise = Animated.spring(appear, { toValue: 1, useNativeDriver: true, bounciness: 3, speed: 14 });
    rise.start();
    return () => rise.stop();
  }, [visible, appear]);

  // Aufruf zählen (pro Person einmal – das erledigt der Server).
  useEffect(() => {
    if (!token || !activity) return;
    let alive = true;
    api
      .viewActivity(token, activity.id)
      .then((res) => alive && setViews(res.views_count))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, activity]);

  // Kommentare laden, sobald das Blatt aufgeht.
  const activityId = activity?.id;
  useEffect(() => {
    if (!token || activityId == null) return;
    let alive = true;
    api
      .activityComments(token, activityId)
      .then((res) => alive && setLoaded({ id: activityId, list: res.data }))
      .catch(() => alive && setLoaded({ id: activityId, list: [] }));
    return () => {
      alive = false;
    };
  }, [token, activityId]);

  const comments = loaded && loaded.id === activityId ? loaded.list : null;
  const setComments = useCallback(
    (next: (prev: ActivityComment[] | null) => ActivityComment[] | null) => {
      setLoaded((prev) => {
        if (activityId == null) return prev;
        const list = next(prev && prev.id === activityId ? prev.list : null);
        return list ? { id: activityId, list } : prev;
      });
    },
    [activityId],
  );

  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [celebrating]);

  const data = current ?? activity;

  const apply = useCallback(
    (updated: Activity) => {
      setCurrent(updated);
      onChanged?.(updated);
    },
    [onChanged],
  );

  /**
   * Zu den Kommentaren. Sie stehen am Ende des Blatts (danach nur noch die
   * Fußnote), also reicht „ans Ende" – ohne Messen, das im Web-Modal nicht
   * zuverlässig ein Layout-Ereignis liefert.
   */
  const scrollToComments = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Aus der Sprechblase im Feed geöffnet: einmal hinunter, sobald die
  // Kommentare da sind – vorher wäre das Ende noch weiter oben.
  const commentsReady = comments !== null;
  useEffect(() => {
    if (!visible || !focusComments || !commentsReady || jumped.current) return;
    // Erst im Zeitgeber als erledigt markieren: Wird der Effekt vorher
    // aufgeräumt, darf der nächste Durchlauf es noch einmal versuchen.
    const timer = setTimeout(() => {
      jumped.current = true;
      scrollToComments();
    }, 350);
    return () => clearTimeout(timer);
  }, [visible, focusComments, commentsReady, scrollToComments]);

  if (!data) return null;

  const now = new Date();
  const isOwn = !!user && data.host?.id === user.id;
  const canDelete = !!user && (isOwn || !!user.is_admin);
  const urgency = urgencyFor(data, now);
  const isFull = data.max_participants != null && data.participants_count >= data.max_participants;
  const joinBlocked = isFull && !data.is_joined;
  const calendarLink = data.is_permanent ? null : calendarLinkFor(data);
  const distance = formatDistance(distanceKm ?? null);
  const liked = !!data.liked_by_me;
  const likes = data.likes_count ?? 0;
  const commentCount = comments?.length ?? data.comments_count ?? 0;

  const whenLine = data.is_permanent ? 'Jederzeit' : formatEventWhen(data.starts_at, now);
  const whenSub = data.is_permanent ? 'Dauerangebot, ohne Termin' : longDate(data.starts_at);
  const who = participantsSentence(
    data.participants.map((p) => p.name),
    data.participants_count,
  );

  // ------------------------------------------------------------ Handlungen

  async function toggleJoin() {
    if (!token || !data) return;
    const joining = !data.is_joined;
    if (!joining) {
      const ok = await confirmAction(
        'Nicht mehr dabei sein?',
        'Dein Platz wird frei, und den Event-Chat siehst du danach nicht mehr.',
        'Austreten',
        true,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = joining ? await api.joinActivity(token, data.id) : await api.leaveActivity(token, data.id);
      apply(res.data);
      if (joining) {
        feedback.joined();
        setCelebrating(true);
      } else {
        feedback.left();
      }
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.status === 409 || apiError?.status === 422) feedback.blocked();
      else feedback.failed();
      setError(apiError?.firstError() ?? 'Das hat leider nicht geklappt. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike() {
    if (!token || !data) return;
    const before = data;
    feedback.selected();
    setCurrent(toggledLike(data));
    try {
      const res = before.liked_by_me ? await api.unlikeActivity(token, before.id) : await api.likeActivity(token, before.id);
      apply(res.data);
    } catch {
      setCurrent(before);
    }
  }

  async function toggleSave() {
    if (!token || !data) return;
    const before = data;
    feedback.selected();
    setCurrent({ ...data, is_saved: !data.is_saved });
    try {
      const res = before.is_saved ? await api.unsaveActivity(token, before.id) : await api.saveActivity(token, before.id);
      apply(res.data);
    } catch {
      setCurrent(before);
      setError('Das Merken hat nicht geklappt.');
    }
  }

  function openChat() {
    if (!data) return;
    feedback.tapped();
    onClose();
    router.push({ pathname: '/chat', params: { kind: 'activity', id: String(data.id), title: data.title } });
  }

  function openHost() {
    const username = data?.host?.username;
    if (!username) return;
    feedback.tapped();
    onClose();
    if (isOwn) router.navigate('/me');
    else router.push({ pathname: '/profile/[username]', params: { username } });
  }

  function openPlace() {
    if (!data) return;
    feedback.tapped();
    if (onRoute) {
      onRoute();
      return;
    }
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.location)}`).catch(() => {});
  }

  async function removeActivity() {
    if (!token || !data) return;
    const ok = await confirmAction(
      'Aktivität löschen',
      isOwn
        ? `„${data.title}" wirklich löschen? Alle, die dabei sind, verlieren ihren Platz.`
        : `„${data.title}" von ${data.host?.name ?? 'dieser Person'} als Admin löschen? Das lässt sich nicht rückgängig machen.`,
      'Löschen',
      true,
    );
    if (!ok) return;
    try {
      await api.deleteActivity(token, data.id);
      feedback.left();
      onDeleted?.(data.id);
      onClose();
    } catch (err) {
      feedback.failed();
      await notifyUser('Löschen fehlgeschlagen', err instanceof ApiError ? err.firstError() : 'Bitte versuch es noch mal.');
    }
  }

  async function sendComment() {
    const body = draft.trim();
    if (!token || !data || !body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await api.addActivityComment(token, data.id, body);
      feedback.achieved();
      setComments((prev) => [...(prev ?? []), res.data]);
      apply(res.activity);
      setDraft('');
      setComposing(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    } catch (err) {
      feedback.failed();
      const apiError = err instanceof ApiError ? err : null;
      // Nicht jugendfrei + automatische Sperre: Der Token ist entwertet – Grund
      // zeigen und abmelden, sonst laufen alle weiteren Anfragen ins Leere.
      const ban = apiError?.status === 403 ? apiError.body?.ban : undefined;
      if (ban) {
        onClose();
        await notifyUser('Konto gesperrt', ban.reason ?? 'Dein Kommentar war nicht jugendfrei.', 'Verstanden');
        await logout();
        return;
      }
      setError(apiError?.firstError() ?? 'Der Kommentar konnte nicht gesendet werden.');
    } finally {
      setPosting(false);
    }
  }

  async function removeComment(comment: ActivityComment) {
    if (!token || !data) return;
    const ok = await confirmAction('Kommentar löschen', 'Der Kommentar verschwindet für alle.', 'Löschen', true);
    if (!ok) return;
    try {
      const res = await api.deleteActivityComment(token, data.id, comment.id);
      setComments((prev) => prev?.filter((c) => c.id !== comment.id) ?? prev);
      apply(res.activity);
      feedback.left();
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Löschen hat nicht geklappt.');
    }
  }

  const menu: SheetOption[] = [
    { key: 'share', label: 'Teilen', icon: 'share', onPress: () => setSharing(data) },
    ...(calendarLink
      ? [{ key: 'calendar', label: 'In den Kalender', icon: 'calendar' as UiIconName, onPress: () => openCalendar(calendarLink) }]
      : []),
    { key: 'route', label: onRoute ? 'Route anzeigen' : 'In Karten öffnen', icon: 'map-pin', onPress: openPlace },
    ...(data.host?.username && !isOwn
      ? [{ key: 'host', label: `Profil von ${data.host.name}`, icon: 'user' as UiIconName, onPress: openHost }]
      : []),
    {
      key: 'liability',
      label: 'Haftung & Regeln',
      icon: 'document',
      onPress: () => {
        onClose();
        router.push({ pathname: '/legal', params: { doc: 'liability' } });
      },
    },
    ...(!isOwn ? [{ key: 'report', label: 'Melden', icon: 'flag' as UiIconName, destructive: true, onPress: () => setReportTarget({ type: 'activity', id: data.id, label: data.title }) }] : []),
    ...(canDelete
      ? [
          {
            key: 'delete',
            label: isOwn ? 'Aktivität löschen' : 'Als Admin löschen',
            icon: 'trash' as UiIconName,
            destructive: true,
            onPress: removeActivity,
          },
        ]
      : []),
  ];

  // ------------------------------------------------------------ Bewegung

  const riseShift = appear.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const miniOpacity = scrollY.interpolate({
    inputRange: [COLLAPSE_START, COLLAPSE_END],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const heroShift = scrollY.interpolate({
    inputRange: [0, HERO],
    outputRange: [0, HERO * 0.35],
    extrapolate: 'clamp',
  });
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: NATIVE,
    listener: drag.onScroll,
  });

  const barBottom = composing ? keyboard : 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: appear }]} pointerEvents="none" />
        <Pressable style={styles.backdropTouch} onPress={onClose} accessibilityLabel="Schließen" />

        {/* Der Streifen oben bleibt frei: Man sieht die Seite dahinter und weiß,
            dass das Blatt nur darüber liegt. Tippen dort schließt (die Fläche
            lässt durch zur Schließen-Fläche darunter). */}
        <View style={{ height: insets.top + Spacing.four }} pointerEvents="none" />

        {/* Im normalen Fluss und NICHT absolut positioniert: Im Web schrumpft ein
            absolutes Element mit `alignSelf: 'center'` auf seine Inhaltshöhe –
            das Blatt wurde dann so lang wie sein Inhalt und ließ sich nicht mehr
            scrollen. */}
        <Animated.View
          onLayout={drag.onSheetLayout}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              opacity: appear,
              transform: [{ translateY: Animated.add(riseShift, drag.dragY) }],
            },
          ]}>
          <View {...drag.listPan.panHandlers} style={styles.flex}>
            <Animated.ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
              showsVerticalScrollIndicator={false}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              onScroll={onScroll}>
              {/* Banner */}
              <View style={styles.hero}>
                <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: heroShift }] }]}>
                  <ActivityPoster activity={data} titleSize={28} iconSize={62} />
                </Animated.View>
                <LinearGradient colors={['rgba(0,0,0,0.38)', 'transparent']} style={styles.heroTopShade} pointerEvents="none" />
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={styles.heroBottomShade} pointerEvents="none">
                  <View style={styles.heroBadges}>
                    {!data.is_permanent && (urgency.tone === 'live' || urgency.tone === 'soon') && urgency.label ? (
                      <View style={[styles.heroBadge, urgency.glow && { backgroundColor: colors.tint }]}>
                        {urgency.tone === 'live' ? <PulseDot color="#ffffff" size={7} /> : null}
                        <Text style={styles.heroBadgeText}>{urgency.tone === 'live' ? 'Läuft gerade' : urgency.label}</Text>
                      </View>
                    ) : null}
                    {data.is_permanent ? (
                      <View style={styles.heroBadge}>
                        <Icon name="sparkles" size={12} color="#ffffff" />
                        <Text style={styles.heroBadgeText}>Jederzeit möglich</Text>
                      </View>
                    ) : null}
                    {urgency.seatsLabel ? (
                      <View style={[styles.heroBadge, urgency.scarce && { backgroundColor: colors.tint }]}>
                        <Text style={styles.heroBadgeText}>{urgency.seatsLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                </LinearGradient>
              </View>

              <View style={styles.body}>
                {data.interests.length > 0 ? (
                  <View style={styles.chips}>
                    {data.interests.map((interest) => (
                      <View key={interest.id} style={[styles.chip, { backgroundColor: colors.backgroundElement }]}>
                        <CategoryIcon interest={interest} size={13} color={colors.tint} />
                        <Text style={[styles.chipText, { color: colors.text }]}>{interest.name}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                  {data.title}
                </Text>

                {/* Veranstalter:in */}
                {data.host ? (
                  <Pressable
                    onPress={data.host.username ? openHost : undefined}
                    disabled={!data.host.username}
                    accessibilityRole={data.host.username ? 'link' : undefined}
                    accessibilityLabel={`Veranstaltet von ${data.host.name}`}
                    style={({ pressed }) => [styles.hostRow, pressed && styles.pressed]}>
                    <StoryAvatar size={42} avatar={data.host.avatar_url} name={data.host.name} />
                    <View style={styles.flex}>
                      <Text style={[styles.hostLabel, { color: colors.textSecondary }]}>Veranstaltet von</Text>
                      <Text style={[styles.hostName, { color: colors.text }]} numberOfLines={1}>
                        {isOwn ? 'Dir' : data.host.name}
                      </Text>
                    </View>
                    {data.host.username ? <Icon name="chevron-right" size={20} color={colors.textSecondary} /> : null}
                  </Pressable>
                ) : null}

                {/* Status, wenn man schon dabei ist – mit dem Weg hinaus direkt daneben. */}
                {data.is_joined || isOwn ? (
                  <View style={[styles.status, { backgroundColor: signal.goodBg }]}>
                    <Icon name={isOwn ? 'star' : 'check'} size={18} color={signal.good} />
                    <Text style={[styles.statusText, { color: colors.text }]}>
                      {isOwn ? 'Das ist deine Aktivität' : 'Du bist dabei'}
                    </Text>
                    {data.is_joined && !isOwn ? (
                      <Pressable onPress={toggleJoin} disabled={busy} hitSlop={8} accessibilityRole="button">
                        <Text style={[styles.statusAction, { color: colors.textSecondary }]}>Austreten</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {/* Wann · Wo · Dabei */}
                <View style={[styles.facts, { backgroundColor: colors.backgroundElement }]}>
                  <Fact
                    icon={data.is_permanent ? 'sparkles' : 'calendar'}
                    label="Wann"
                    value={whenLine}
                    sub={whenSub}
                    hint={calendarLink ? 'Kalender' : undefined}
                    onPress={calendarLink ? () => openCalendar(calendarLink) : undefined}
                  />
                  <View style={[styles.factDivider, { backgroundColor: colors.backgroundSelected }]} />
                  <Fact
                    icon="map-pin"
                    label="Wo"
                    value={data.location}
                    sub={distance ? `${distance} entfernt` : undefined}
                    hint={onRoute ? 'Route' : 'Karte'}
                    onPress={openPlace}
                  />
                  <View style={[styles.factDivider, { backgroundColor: colors.backgroundSelected }]} />
                  <Fact
                    icon="users"
                    label="Dabei"
                    value={
                      data.max_participants != null
                        ? `${data.participants_count} von ${data.max_participants}`
                        : data.participants_count === 1
                          ? '1 Person'
                          : `${data.participants_count} Personen`
                    }
                    sub={
                      isFull
                        ? 'Ausgebucht'
                        : urgency.seatsFree != null
                          ? `${urgency.seatsFree} frei`
                          : 'Offen für alle'
                    }
                  />
                </View>

                {/* Zahlen in einer ruhigen Zeile */}
                <View style={styles.stats}>
                  <Text style={[styles.statsText, { color: colors.textSecondary }]}>
                    {[
                      likes > 0 ? `${formatCount(likes)} Gefällt mir` : null,
                      commentCount > 0 ? `${formatCount(commentCount)} ${commentCount === 1 ? 'Kommentar' : 'Kommentare'}` : null,
                      views && views > 0 ? `${formatCount(views)}× angesehen` : null,
                    ]
                      .filter(Boolean)
                      .join('  ·  ') || 'Sei die erste Person, die reagiert.'}
                  </Text>
                </View>

                {data.description ? (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Worum es geht</Text>
                    <Text style={[styles.description, { color: colors.text }]}>{data.description}</Text>
                  </View>
                ) : null}

                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Wer ist dabei</Text>
                  {data.participants.length > 0 ? (
                    <View style={styles.peopleRow}>
                      <AvatarStack
                        people={data.participants.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar_url ?? null }))}
                        total={data.participants_count}
                        size={34}
                        max={6}
                      />
                      <Text style={[styles.peopleText, { color: colors.textSecondary }]} numberOfLines={2}>
                        {who}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.muted, { color: colors.textSecondary }]}>
                      Noch niemand dabei – sei die erste Person!
                    </Text>
                  )}
                </View>

                {/* Kommentare */}
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Kommentare{commentCount > 0 ? ` · ${commentCount}` : ''}
                  </Text>

                  <Pressable
                    onPress={() => {
                      feedback.tapped();
                      setComposing(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Kommentar schreiben"
                    style={({ pressed }) => [
                      styles.fakeInput,
                      { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected },
                      pressed && styles.pressed,
                    ]}>
                    <StoryAvatar size={30} avatar={user?.avatar} name={user?.name ?? ''} />
                    <Text style={[styles.fakeInputText, { color: colors.textSecondary }]}>
                      Frag was oder sag Hallo …
                    </Text>
                  </Pressable>

                  {comments === null ? (
                    <ActivityIndicator color={colors.tint} style={styles.commentsLoading} />
                  ) : comments.length === 0 ? (
                    <Text style={[styles.muted, { color: colors.textSecondary }]}>
                      Noch keine Kommentare. Schreib den ersten!
                    </Text>
                  ) : (
                    comments.map((comment) => (
                      <CommentRow
                        key={comment.id}
                        comment={comment}
                        isHost={comment.user.id === data.host?.id}
                        now={now}
                        onDelete={comment.can_delete ? () => removeComment(comment) : undefined}
                        onReport={
                          comment.user.id !== user?.id
                            ? () => setReportTarget({ type: 'activity_comment', id: comment.id, label: comment.body })
                            : undefined
                        }
                      />
                    ))
                  )}
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Text style={[styles.legal, { color: colors.textSecondary }]}>
                  Diese Aktivität kommt von {data.host?.name ?? 'einer Nutzer:in'}, nicht von GÖ4Fun. Die Teilnahme
                  erfolgt auf eigene Verantwortung.
                </Text>
              </View>
            </Animated.ScrollView>
          </View>

          {/* Oben: Griff, Schließen, Optionen – und die kleine Leiste, die den
              Banner ablöst, sobald er weggescrollt ist. Die Fläche selbst lässt
              Berührungen durch: Nach unten ziehen nimmt dann die Liste darunter
              entgegen (`listPan`), und das schließt das Blatt, solange sie oben steht. */}
          <View style={styles.top} pointerEvents="box-none">
            <Animated.View
              pointerEvents="none"
              style={[
                styles.mini,
                { backgroundColor: colors.background, borderBottomColor: colors.backgroundSelected, opacity: miniOpacity },
              ]}>
              <View style={styles.miniThumb}>
                <ActivityPoster activity={data} iconSize={16} showTitle={false} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.miniTitle, { color: colors.text }]} numberOfLines={1}>
                  {data.title}
                </Text>
                <Text style={[styles.miniSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {whenLine}
                  {data.location ? ` · ${data.location}` : ''}
                </Text>
              </View>
            </Animated.View>
            <View style={styles.handle} pointerEvents="none" />
            <View style={styles.topButtons} pointerEvents="box-none">
              <IconButton icon="close" label="Schließen" variant="elevated" size={38} onPress={onClose} />
              <IconButton icon="more" label="Weitere Optionen" variant="elevated" size={38} onPress={() => setMenuOpen(true)} />
            </View>
          </View>

          {/* Unten: Aktionsleiste bzw. Kommentarfeld. */}
          <View
            style={[
              styles.bar,
              {
                backgroundColor: colors.background,
                borderTopColor: colors.backgroundSelected,
                paddingBottom: (barBottom > 0 ? Spacing.two : insets.bottom + Spacing.two),
                bottom: barBottom,
              },
            ]}>
            {composing ? (
              <View style={styles.composer}>
                <TextInput
                  value={draft}
                  onChangeText={(text) => setDraft(text.slice(0, MAX_COMMENT))}
                  placeholder="Kommentar schreiben …"
                  placeholderTextColor={colors.textSecondary}
                  autoFocus
                  multiline
                  maxLength={MAX_COMMENT}
                  accessibilityLabel="Kommentar"
                  style={[
                    styles.composerInput,
                    { color: colors.text, backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected },
                  ]}
                />
                <IconButton
                  icon="close"
                  label="Abbrechen"
                  variant="filled"
                  size={40}
                  onPress={() => {
                    setComposing(false);
                    setDraft('');
                  }}
                />
                <IconButton
                  icon="arrow-up"
                  label="Kommentar senden"
                  variant="accent"
                  size={40}
                  disabled={!draft.trim() || posting}
                  onPress={sendComment}
                />
              </View>
            ) : (
              <View style={styles.barRow}>
                <BarIcon
                  icon={liked ? 'heart-filled' : 'heart'}
                  color={liked ? colors.tint : colors.text}
                  count={likes}
                  label={liked ? 'Gefällt mir nicht mehr' : 'Gefällt mir'}
                  onPress={toggleLike}
                />
                <BarIcon
                  icon="chat"
                  color={colors.text}
                  count={commentCount}
                  label="Kommentieren"
                  onPress={() => {
                    scrollToComments();
                    setComposing(true);
                  }}
                />
                <BarIcon
                  icon={data.is_saved ? 'bookmark-filled' : 'bookmark'}
                  color={colors.text}
                  label={data.is_saved ? 'Nicht mehr merken' : 'Merken'}
                  onPress={toggleSave}
                />

                <View style={styles.primarySlot}>
                  {isOwn || data.is_joined ? (
                    <PressableScale
                      onPress={openChat}
                      haptic="tap"
                      scaleTo={0.97}
                      accessibilityRole="button"
                      accessibilityLabel="Event-Chat öffnen"
                      style={[styles.primary, { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected, borderWidth: StyleSheet.hairlineWidth }]}>
                      <Icon name="chat" size={18} color={colors.text} />
                      <Text style={[styles.primaryText, { color: colors.text }]}>Zum Chat</Text>
                    </PressableScale>
                  ) : joinBlocked ? (
                    <View style={[styles.primary, { backgroundColor: colors.backgroundSelected }]}>
                      <Text style={[styles.primaryText, { color: colors.textSecondary }]}>Ausgebucht</Text>
                    </View>
                  ) : (
                    <Glow active={urgency.glow} color={signal.warnGlow} radius={14} intensity="strong">
                      <PressableScale
                        onPress={toggleJoin}
                        disabled={busy}
                        haptic="press"
                        scaleTo={0.97}
                        accessibilityRole="button"
                        accessibilityLabel={`Bei ${data.title} mitmachen`}
                        style={styles.primaryWrap}>
                        <LinearGradient
                          colors={[...BrandGradient]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.primary}>
                          {busy ? (
                            <ActivityIndicator color="#ffffff" />
                          ) : (
                            <>
                              <Icon name="plus" size={18} color="#ffffff" />
                              <Text style={[styles.primaryText, { color: '#ffffff' }]}>Mitmachen</Text>
                            </>
                          )}
                        </LinearGradient>
                      </PressableScale>
                    </Glow>
                  )}
                </View>
              </View>
            )}
          </View>

          {celebrating ? <Celebration name={data.title} /> : null}
        </Animated.View>
      </View>

      {/* Alle Blätter liegen INNERHALB dieses Modals: Ein zweites `Modal`
          daneben würde auf Android hinter dem ersten landen. */}
      <OptionsSheet visible={menuOpen} title={data.title} options={menu} onClose={() => setMenuOpen(false)} />
      <ShareSheet activity={sharing} onClose={() => setSharing(null)} />
      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />
    </Modal>
  );
}

/**
 * Eine Zeile der Karte „Wann / Wo / Dabei".
 *
 * Zeilen statt drei Kacheln nebeneinander: Auf einem Handy blieben pro Kachel
 * rund 100 px, und genau die wichtigsten Angaben (Ort, Datum) wurden dann
 * abgeschnitten. Als Zeile hat jede Angabe die volle Breite, und die Handlung
 * dazu („Karte", „Kalender") steht rechts, wo der Daumen sie erwartet.
 */
function Fact({
  icon,
  label,
  value,
  sub,
  hint,
  onPress,
}: {
  icon: UiIconName;
  label: string;
  value: string;
  sub?: string;
  /** Kleiner Hinweis, dass die Kachel etwas tut („Karte"). */
  hint?: string;
  onPress?: () => void;
}) {
  const colors = useTheme();
  const content = (
    <>
      <View style={[styles.factIcon, { backgroundColor: colors.background }]}>
        <Icon name={icon} size={18} color={colors.tint} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.factLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.factValue, { color: colors.text }]} numberOfLines={2}>
          {value}
        </Text>
        {sub ? (
          <Text style={[styles.factSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {hint && onPress ? (
        <View style={[styles.factHint, { backgroundColor: colors.background }]}>
          <Text style={[styles.factHintText, { color: colors.tint }]} numberOfLines={1}>
            {hint}
          </Text>
        </View>
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.fact}>{content}</View>;
  return (
    <Pressable
      onPress={() => {
        feedback.tapped();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}
      style={({ pressed }) => [styles.fact, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function CommentRow({
  comment,
  isHost,
  now,
  onDelete,
  onReport,
}: {
  comment: ActivityComment;
  isHost: boolean;
  now: Date;
  onDelete?: () => void;
  /** Report this comment (F-08); not offered for one's own. */
  onReport?: () => void;
}) {
  const colors = useTheme();
  return (
    <View style={styles.comment}>
      <StoryAvatar size={34} avatar={comment.user.avatar} name={comment.user.name} />
      <View style={styles.flex}>
        <View style={styles.commentHead}>
          <Text style={[styles.commentName, { color: colors.text }]} numberOfLines={1}>
            {comment.user.name}
          </Text>
          {isHost ? (
            <View style={[styles.hostTag, { backgroundColor: colors.backgroundElement }]}>
              <Text style={[styles.hostTagText, { color: colors.tint }]}>Host</Text>
            </View>
          ) : null}
          <Text style={[styles.commentTime, { color: colors.textSecondary }]}>
            {formatRelativeShort(comment.created_at, now)}
          </Text>
        </View>
        <Text style={[styles.commentBody, { color: colors.text }]}>{comment.body}</Text>
      </View>
      {onReport ? (
        <Pressable onPress={onReport} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kommentar melden" style={({ pressed }) => pressed && styles.pressed}>
          <Icon name="flag" size={16} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      {onDelete ? (
        <Pressable onPress={onDelete} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kommentar löschen" style={({ pressed }) => pressed && styles.pressed}>
          <Icon name="trash" size={16} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function BarIcon({
  icon,
  color,
  count,
  label,
  onPress,
}: {
  icon: 'heart' | 'heart-filled' | 'chat' | 'bookmark' | 'bookmark-filled';
  color: string;
  count?: number;
  label: string;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      scaleTo={0.86}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      style={styles.barIcon}>
      <Icon name={icon} size={25} color={color} />
      {count ? <Text style={[styles.barCount, { color: colors.text }]}>{formatCount(count)}</Text> : null}
    </PressableScale>
  );
}

/**
 * Der kurze Jubel nach einem Beitritt. Lässt alles durch (`pointerEvents="none"`):
 * Wer weitertippen will, soll nicht warten müssen, bis die Figur fertig gehüpft ist.
 */
function Celebration({ name }: { name: string }) {
  const colors = useTheme();
  const signal = useSignals();
  const [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!NATIVE) {
      fade.setValue(1);
      return;
    }
    const run = Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(CELEBRATION_MS - 460),
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [fade]);

  return (
    <Animated.View pointerEvents="none" style={[styles.celebration, { opacity: fade, backgroundColor: signal.goodBg }]}>
      <View style={[styles.celebrationCard, { backgroundColor: colors.background }]}>
        <Mascot mood="cheer" size={104} color={signal.good} celebrate />
        <Text style={[styles.celebrationTitle, { color: colors.text }]}>Du bist dabei!</Text>
        <Text style={[styles.celebrationText, { color: colors.textSecondary }]} numberOfLines={2}>
          {name}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  backdropTouch: { ...StyleSheet.absoluteFill },
  sheet: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 16 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: -6 },
      },
    }),
  },
  hero: { height: HERO, overflow: 'hidden', backgroundColor: '#111' },
  heroTopShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 90 },
  heroBottomShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  heroBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: 5,
  },
  heroBadgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12 },
  body: { paddingHorizontal: Spacing.four - 4, paddingTop: Spacing.three + 2, gap: Spacing.three + 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: -Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
  },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  title: { fontFamily: FontFamily.bold, fontSize: 25, lineHeight: 31, letterSpacing: -0.3 },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  hostLabel: { fontFamily: FontFamily.regular, fontSize: 12 },
  hostName: { fontFamily: FontFamily.bold, fontSize: 15 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  statusText: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14 },
  statusAction: { fontFamily: FontFamily.semibold, fontSize: 13, textDecorationLine: 'underline' },
  facts: { borderRadius: Radius.panel, overflow: 'hidden' },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
  },
  factIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  factLabel: { fontFamily: FontFamily.semibold, fontSize: 12 },
  factValue: { fontFamily: FontFamily.bold, fontSize: 15, lineHeight: 20 },
  factSub: { fontFamily: FontFamily.regular, fontSize: 13 },
  factHint: { borderRadius: Radius.chip, paddingHorizontal: Spacing.three - 4, paddingVertical: 6 },
  factHintText: { fontFamily: FontFamily.bold, fontSize: 12 },
  factDivider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three + 38 + Spacing.three },
  stats: { marginTop: -Spacing.one },
  statsText: { fontFamily: FontFamily.medium, fontSize: 13 },
  section: { gap: Spacing.two + 2 },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  description: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  peopleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  peopleText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  muted: { fontFamily: FontFamily.regular, fontSize: 14 },
  fakeInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 6,
    paddingRight: Spacing.three,
    minHeight: 44,
  },
  fakeInputText: { fontFamily: FontFamily.regular, fontSize: 14 },
  commentsLoading: { marginVertical: Spacing.three },
  comment: { flexDirection: 'row', gap: Spacing.two + 4, alignItems: 'flex-start', paddingVertical: 2 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentName: { fontFamily: FontFamily.bold, fontSize: 13, flexShrink: 1 },
  commentTime: { fontFamily: FontFamily.regular, fontSize: 12 },
  commentBody: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, marginTop: 1 },
  hostTag: { borderRadius: Radius.chip, paddingHorizontal: 6, paddingVertical: 1 },
  hostTagText: { fontFamily: FontFamily.bold, fontSize: 10 },
  error: { color: '#ef4444', fontFamily: FontFamily.medium, fontSize: 13 },
  legal: { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 17, marginTop: Spacing.two },
  top: { position: 'absolute', top: 0, left: 0, right: 0, height: 66 },
  mini: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingLeft: 58,
    paddingRight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  miniThumb: { width: 34, height: 34, borderRadius: 8, overflow: 'hidden' },
  miniTitle: { fontFamily: FontFamily.bold, fontSize: 14 },
  miniSub: { fontFamily: FontFamily.regular, fontSize: 11 },
  handle: {
    position: 'absolute',
    top: 7,
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(160,160,160,0.75)',
  },
  topButtons: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three - 2,
    paddingTop: 6,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  barIcon: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  barCount: { fontFamily: FontFamily.semibold, fontSize: 13 },
  primarySlot: { flex: 1, marginLeft: Spacing.one },
  primaryWrap: { borderRadius: Radius.card + 2, overflow: 'hidden' },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 48,
    borderRadius: Radius.card + 2,
    paddingHorizontal: Spacing.three,
  },
  primaryText: { fontFamily: FontFamily.bold, fontSize: 15 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  composerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: FontFamily.regular,
    fontSize: 15,
  },
  pressed: { opacity: 0.65 },
  celebration: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
  },
  celebrationCard: {
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 24,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.four,
  },
  celebrationTitle: { fontFamily: FontFamily.bold, fontSize: 22 },
  celebrationText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center' },
});
