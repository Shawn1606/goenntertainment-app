import { useRouter, type Href } from 'expo-router';
// Nur für den weichgezeichneten Hintergrund: `blurRadius` gibt es bei
// `expo-image` am Gerät UND im Web, bei RNs `Image` nicht überall. Der scharfe
// Banner oben bleibt RNs `Image`. Gleiche Aufteilung wie auf der Profilseite.
import { Image as BlurImage } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mascot } from '@/components/mascot';
import { ReportSheet } from '@/components/report-sheet';
import { ShareSheet } from '@/components/share-sheet';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Glow, PulseDot } from '@/components/ui/glow';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { useSheetDrag } from '@/components/ui/use-sheet-drag';
import { Radius, Spacing } from '@/constants/theme';
import { calendarLinkFor } from '@/domain/calendar-link';
import { formatDateTime } from '@/domain/date-format';
import { formatDistance } from '@/domain/distance';
import { urgencyFor } from '@/domain/urgency';
import { useBrandSurface, useGlass, useSignals, useTheme } from '@/hooks/use-theme';
import { type Activity, api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';
import { openCalendar } from '@/lib/open-calendar';

type Props = {
  /** Die anzuzeigende Activity – `null` schließt das Popup. */
  activity: Activity | null;
  onClose: () => void;
  /** Wird nach Beitreten/Verlassen mit der aktualisierten Activity aufgerufen. */
  onChanged?: (updated: Activity) => void;
  /**
   * Optional: zeigt einen „Route anzeigen"-Knopf. Wird z. B. von der Karte
   * gesetzt, um die Route in Google/Apple Maps zu öffnen. Ohne diese Prop
   * (z. B. auf der Startseite) erscheint der Knopf nicht.
   */
  onRoute?: () => void;
  /** Entfernung in km, falls bekannt (Ticket #5: „Entfernung zum Standort"). */
  distanceKm?: number | null;
  /**
   * Löschen – nur für die eigene Aktivität (bzw. Admins). Der Aufrufer fragt nach
   * und entfernt das Event aus seiner Liste; ohne Rückruf gibt es keinen Knopf.
   */
  onDelete?: () => void;
};

/** Rot für das Löschen – dieselbe Warnfarbe wie bei den übrigen Löschknöpfen. */
const DANGER = '#ed4956';

/** Wie im Konto-Blatt: Animationen laufen im Web-Build dieser App nicht. */
const NATIVE = Platform.OS !== 'web';

/** Aus dieser Höhe steigt das Blatt auf. */
const SHEET_RISE = 32;

/** So lange bleibt der Jubel stehen, bevor er wieder verschwindet. */
const CELEBRATION_MS = 1700;

/**
 * Der weichgezeichnete Hintergrund des Blattes.
 *
 * ## Warum das Blatt vorher durchsichtig war
 *
 * `GlassSurface` zeichnet nur an zwei Stellen wirklich weich: im Web über
 * `backdrop-filter` und auf iOS 26 über Liquid Glass. Auf Android bleibt von
 * „Glas" eine Füllung mit 84–86 % Deckkraft übrig – also eine Fläche, durch die
 * die Startseite sichtbar durchscheint. Über einem Regal voller bunter
 * Event-Karten wird der Text darauf dadurch unruhig und schlecht lesbar.
 *
 * ## Warum hier kein `BlurView` steht
 *
 * `expo-blur` zeichnet nur weich, was in SEINEM Fenster liegt. Dieses Blatt ist
 * ein `Modal` und damit ein eigenes Fenster – ein `BlurView` darin fände nichts
 * zu verwischen (dieselbe Falle steht ausführlich in `account-widget.tsx`, das
 * deshalb bewusst KEIN Modal ist).
 *
 * Der Ausweg: Das Blatt bringt seinen Hintergrund selbst mit. Unten ein deckender
 * Grund – der allein löst schon die Lesbarkeit –, darüber der Banner DIESES
 * Events, weichgezeichnet. Damit ist der Hintergrund nicht nur ruhig, sondern
 * gehört auch sichtbar zu dem Event, das man gerade geöffnet hat.
 */
const SHEET_BLUR = 40;

/**
 * Wie kräftig der weichgezeichnete Banner durchkommt.
 *
 * Er ist Stimmung, nicht Motiv: Bei mehr als der Hälfte kämpft das Bild mit der
 * Schrift, bei deutlich weniger ist es reine Deko ohne Bezug zum Event.
 */
const SHEET_BANNER_OPACITY = 0.5;

/**
 * Der Überhang des Hintergrundbildes.
 *
 * Weichzeichnen mischt jeden Bildpunkt mit seinen Nachbarn – am Bildrand fehlen
 * die, und dort bliebe ein durchsichtiger Saum. Der Überhang schiebt ihn aus dem
 * Blatt heraus, wo `overflow: 'hidden'` der Glasfläche ihn abschneidet. Faktor 3,
 * weil `blurRadius` im Web die Streuung σ einer Gauß-Glocke ist und die rund 3 σ
 * weit reicht – dieselbe Rechnung wie auf der Profilseite.
 */
const SHEET_BLEED = SHEET_BLUR * 3;

/**
 * Detail-Popup für ein Event: zeigt alle Infos (Banner, Beschreibung, Ort, Zeit,
 * Teilnehmer:innen) und unten einen Knopf zum Beitreten/Verlassen.
 *
 * ## Warum hier mehr Bewegung steckt als sonst
 *
 * Das ist der Bildschirm, auf dem die Entscheidung fällt. Alles andere in dieser
 * App ist Stöbern; hier sagt jemand zu. Entsprechend arbeiten hier drei Dinge
 * zusammen, die es sonst nirgends gleichzeitig gibt:
 *
 *  - **Das Blatt steigt auf und lässt sich wegwischen.** Ein Popup, das man nur
 *    über einen Knopf loswird, fühlt sich wie eine Sackgasse an. Die Geste steckt
 *    in `use-sheet-drag.ts` und ist dieselbe wie im Konto-Blatt – zwei Blätter,
 *    die sich unterschiedlich anfassen, wären schlimmer als gar keine Geste.
 *  - **Der Beitritt bekommt einen Moment.** Kurz das Maskottchen, ein Klang, ein
 *    Stoß – und dann ist es wieder weg. Das ist der einzige Ort in der App mit
 *    einer echten Belohnung, und er ist es wert: Hier ist gerade eine Verabredung
 *    entstanden.
 *  - **Rückmeldung läuft über `feedback`**, nicht über Haptik direkt. Was bei
 *    „beigetreten" passiert, entscheidet `src/lib/feedback.ts` – nicht dieser
 *    Screen.
 *
 * Bei „Bewegung reduzieren" fällt die Bewegung weg, der Inhalt bleibt: Das
 * erledigen `Glow`, `PressableScale` und `Mascot` jeweils selbst.
 */
export function ActivityDetailModal({ activity, onClose, onChanged, onRoute, distanceKm, onDelete }: Props) {
  const surface = useBrandSurface();
  const glass = useGlass();
  /** Deckender Grund des Blattes – nimmt der Startseite dahinter jede Sicht. */
  const canvas = useTheme().background;
  const signal = useSignals();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  // Eigene Kopie, damit Teilnehmerzahl/-liste nach dem Beitreten sofort passt.
  const [current, setCurrent] = useState<Activity | null>(activity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<number | null>(null);
  /** Der kurze Jubel nach einem Beitritt. */
  const [celebrating, setCelebrating] = useState(false);
  /** Teilen-Blatt offen? Trägt das Event selbst, damit es unabhängig schließt. */
  const [sharing, setSharing] = useState<Activity | null>(null);
  /** Melde-Blatt offen? */
  const [reporting, setReporting] = useState(false);
  /** Läuft das Merken gerade? Nur damit der Stern nicht doppelt gedrückt wird. */
  const [saving, setSaving] = useState(false);

  const visible = activity !== null;

  /** 0 = weg, 1 = da. Trägt Hintergrund-Abdunklung und Aufsteigen. */
  const appear = useRef(new Animated.Value(0)).current;
  const drag = useSheetDrag({ onDismiss: onClose, open: visible });

  useEffect(() => {
    setCurrent(activity);
    setError(null);
    setViews(activity?.views_count ?? null);
    setCelebrating(false);
    setSharing(null);
    setReporting(false);
  }, [activity]);

  // Aufsteigen beim Öffnen. Der Klang begleitet die Bewegung – deshalb hier und
  // nicht im Screen, der das Popup öffnet: Nur hier weiß man, wann es aufgeht.
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
    const rise = Animated.spring(appear, {
      toValue: 1,
      useNativeDriver: true,
      bounciness: 4,
      speed: 14,
    });
    rise.start();
    return () => rise.stop();
  }, [visible, appear]);

  // Aufruf zählen, sobald das Popup aufgeht (pro Person nur einmal – das
  // Hochzählen erledigt der Server). Schlägt es fehl, bleibt einfach der
  // bisherige Stand stehen; dafür stört den Nutzer keine Fehlermeldung.
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

  // Der Jubel räumt sich selbst weg. Der Aufräumer ist wichtig: Wird das Blatt
  // vorher geschlossen, dürfte der Zeitgeber nicht in einen abgebauten Baum
  // schreiben.
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [celebrating]);

  const data = current ?? activity;

  /**
   * Adresse der Profilseite des Hosts – null, wenn es keine gibt: Ein
   * Standard-Konto hat kein öffentliches Profil (src/domain/account.ts), und
   * ohne Benutzernamen fehlt die Adresse. Dann bleibt der Name schlichter Text
   * statt eines Links, der ins Leere führt.
   */
  const hostProfile: Href | null =
    // Seit jedes Konto eine Profilseite hat, reicht der Benutzername.
    data?.host?.username
      ? { pathname: '/profile/[username]', params: { username: data.host.username } }
      : null;

  async function toggleJoin() {
    if (!token || !data) return;
    const joining = !data.is_joined;
    setBusy(true);
    setError(null);
    try {
      const res = joining
        ? await api.joinActivity(token, data.id)
        : await api.leaveActivity(token, data.id);
      setCurrent(res.data);
      onChanged?.(res.data);
      // Der Moment, auf den die ganze App hinausläuft. Beim Verlassen bewusst
      // nur ein leichter Tipp und kein Jubel: Austreten soll sich nicht wie ein
      // Erfolg anfühlen.
      if (joining) {
        feedback.joined();
        setCelebrating(true);
      } else {
        feedback.left();
      }
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      // „Voll" ist keine Störung, sondern eine Auskunft – deshalb Warnung statt
      // Fehlerstoß.
      if (apiError?.status === 409 || apiError?.status === 422) feedback.blocked();
      else feedback.failed();
      setError(
        apiError?.firstError() ?? 'Das hat leider nicht geklappt. Bitte erneut versuchen.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Merken bzw. nicht mehr merken.
   *
   * Bewusst ohne Rückfrage und ohne Jubel: Merken ist eine Notiz an sich selbst,
   * keine Zusage. Der Server antwortet mit dem vollständigen Event, also wandert
   * die Antwort auch nach oben (`onChanged`) – sonst zeigte die Liste hinter dem
   * Popup weiter den alten Stern.
   */
  async function toggleSave() {
    if (!token || !data || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = data.is_saved
        ? await api.unsaveActivity(token, data.id)
        : await api.saveActivity(token, data.id);
      setCurrent(res.data);
      onChanged?.(res.data);
      feedback.selected();
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Das Merken hat nicht geklappt.');
    } finally {
      setSaving(false);
    }
  }

  if (!data) return null;

  const when = formatDateTime(data.starts_at);
  // Zeit- und Platz-Lage in Worten: „Läuft jetzt", „in 40 Min", „Nur 2 Plätze
  // frei". Im Popup steht die Entscheidung an – genau hier zählt es am meisten.
  const urgency = urgencyFor(data, new Date());
  // Voll = Maximum gesetzt und erreicht. Wer schon dabei ist, darf trotzdem
  // verlassen; nur das Beitreten wird gesperrt.
  const isFull =
    data.max_participants != null && data.participants_count >= data.max_participants;
  const joinBlocked = isFull && !data.is_joined;
  // null, wenn das Event keine (brauchbare) Startzeit hat – dann kein Knopf.
  const calendarLink = calendarLinkFor(data);
  const countLabel =
    data.max_participants != null
      ? `${data.participants_count}/${data.max_participants}`
      : String(data.participants_count);

  /** Das Blatt steigt auf und folgt zugleich dem Finger. */
  const riseShift = appear.interpolate({ inputRange: [0, 1], outputRange: [SHEET_RISE, 0] });

  return (
    /* `animationType="none"`: Das Auf- und Zufahren machen wir selbst – die
       eingebaute Variante ließe sich nicht mit dem Wischen verrechnen. */
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Der abgedunkelte Hintergrund blendet mit auf; ohne das erschiene er
            hart, während das Blatt noch unterwegs ist. */}
        <Animated.View style={[styles.backdrop, { opacity: appear }]} pointerEvents="none" />

        <Pressable style={styles.backdropTouch} onPress={onClose} accessibilityLabel="Schließen" />

        <Animated.View
          onLayout={drag.onSheetLayout}
          style={[
            styles.sheetWrap,
            {
              opacity: appear,
              transform: [{ translateY: Animated.add(riseShift, drag.dragY) }],
            },
          ]}>
          {/* Kräftiges Glas: über dem abgedunkelten Hintergrund muss der Inhalt
              gut lesbar bleiben, deshalb `panel` statt `card`. */}
          <GlassSurface
            tone="panel"
            radius={Radius.panel}
            style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
            {/* Der Hintergrund des Blattes – siehe {@link SHEET_BLUR}.
                Liegt als erstes Kind und mit `zIndex: 0` unter allem: Die
                Geschwister ohne eigenen Wert stehen darüber. Das ist dieselbe
                Schichtung wie auf der Profilseite. */}
            <View pointerEvents="none" style={styles.sheetBackdrop}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: canvas }]} />
              {data.banner_url ? (
                <>
                  <BlurImage
                    source={{ uri: data.banner_url }}
                    style={[styles.sheetBackdropImage, { opacity: SHEET_BANNER_OPACITY }]}
                    contentFit="cover"
                    blurRadius={SHEET_BLUR}
                    cachePolicy="memory-disk"
                    accessible={false}
                  />
                  {/* Ein Schleier über dem Bild: Er nimmt dem Foto den Kontrast,
                      damit jede Zeile darauf lesbar bleibt – auch über einem
                      hellen Himmel oder einem dunklen Innenraum. */}
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.fill }]} />
                </>
              ) : null}
            </View>

            {/* Griffzone: steht außerhalb der Liste, damit hier keine ScrollView
                um die Bewegung streitet. */}
            <View {...drag.headPan.panHandlers} style={styles.handleZone}>
              <View style={[styles.handle, { backgroundColor: surface.cardBorder }]} />
            </View>

            {/* Über der Liste nimmt die Capture-Fassung die Geste nur ab, wenn
                die Liste schon ganz oben steht – sonst könnte man nicht mehr
                nach oben scrollen, ohne das Blatt zuzuziehen. */}
            <View {...drag.listPan.panHandlers} style={styles.listWrap}>
              <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                bounces={false}
                scrollEventThrottle={16}
                onScroll={drag.onScroll}>
                {data.banner_url ? (
                  <Image source={{ uri: data.banner_url }} style={styles.banner} resizeMode="cover" />
                ) : null}

                <ThemedText type="subtitle" style={{ color: surface.text }}>
                  {data.title}
                </ThemedText>

                {/* Erst die Lage, dann die Details. Wer das Popup öffnet, will
                    zuerst wissen, ob das überhaupt noch geht. */}
                {urgency.label || urgency.seatsLabel ? (
                  <View style={styles.statusRow}>
                    {urgency.label ? (
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor:
                              urgency.tone === 'live' || urgency.tone === 'soon'
                                ? signal.warnBg
                                : surface.chipBg,
                            borderColor:
                              urgency.tone === 'live' || urgency.tone === 'soon'
                                ? signal.warnBorder
                                : surface.chipBorder,
                          },
                        ]}>
                        {urgency.tone === 'live' ? <PulseDot color={signal.warn} size={7} /> : null}
                        <ThemedText
                          type="smallBold"
                          style={{
                            color:
                              urgency.tone === 'live' || urgency.tone === 'soon'
                                ? signal.warn
                                : surface.chipText,
                          }}>
                          {urgency.label}
                        </ThemedText>
                      </View>
                    ) : null}

                    {urgency.seatsLabel ? (
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: urgency.scarce ? signal.warnBg : surface.chipBg,
                            borderColor: urgency.scarce ? signal.warnBorder : surface.chipBorder,
                          },
                        ]}>
                        <ThemedText
                          type="smallBold"
                          style={{ color: urgency.scarce ? signal.warn : surface.textMuted }}>
                          {urgency.seatsLabel}
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.metaRow}>
                  {when ? (
                    <View style={styles.metaItem}>
                      <Icon name="calendar" size={16} color={surface.textMuted} />
                      <ThemedText type="small" style={{ color: surface.textMuted }}>
                        {when}
                      </ThemedText>
                    </View>
                  ) : null}
                  {data.location ? (
                    <View style={styles.metaItem}>
                      <Icon name="map-pin" size={16} color={surface.textMuted} />
                      <ThemedText type="small" style={{ color: surface.textMuted }}>
                        {data.location}
                        {formatDistance(distanceKm) ? ` · ${formatDistance(distanceKm)} entfernt` : ''}
                      </ThemedText>
                    </View>
                  ) : null}
                  {views !== null && views > 0 ? (
                    <View style={styles.metaItem}>
                      <Icon name="eye" size={16} color={surface.textMuted} />
                      <ThemedText type="small" style={{ color: surface.textMuted }}>
                        {views === 1
                          ? '1 Person hat reingeschaut'
                          : `${views} Leute haben reingeschaut`}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>

                {data.host ? (
                  hostProfile ? (
                    // Ab Creator hat der Host eine öffentliche Seite – das ist der
                    // Weg, auf dem andere ein Profil überhaupt finden. Erst das
                    // Popup schließen, sonst läge es über dem Ziel.
                    <Pressable
                      onPress={() => {
                        onClose();
                        router.push(hostProfile);
                      }}
                      accessibilityRole="link"
                      accessibilityLabel={`Profil von ${data.host.name} öffnen`}
                      hitSlop={6}>
                      <ThemedText type="small" style={{ color: surface.accent }}>
                        Veranstaltet von {data.host.name} ›
                      </ThemedText>
                    </Pressable>
                  ) : (
                    <ThemedText type="small" style={{ color: surface.chipText }}>
                      Veranstaltet von {data.host.name}
                    </ThemedText>
                  )
                ) : null}

                {data.interests.length > 0 ? (
                  <View style={styles.chips}>
                    {data.interests.map((interest) => (
                      <View
                        key={interest.id}
                        style={[styles.chip, { backgroundColor: surface.chipBg }]}>
                        <ThemedText type="small" style={{ color: surface.chipText }}>
                          {interest.name}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : null}

                {data.description ? (
                  <ThemedText style={{ color: surface.text }}>{data.description}</ThemedText>
                ) : null}

                {/* Teilnehmer:innen */}
                <View style={styles.participantsBlock}>
                  <ThemedText type="smallBold" style={{ color: surface.text }}>
                    Teilnehmer:innen ({countLabel}){isFull ? ' · voll' : ''}
                  </ThemedText>
                  {data.participants.length > 0 ? (
                    <View style={styles.participants}>
                      {data.participants.map((p) => (
                        <View
                          key={p.id}
                          style={[styles.participantPill, { backgroundColor: surface.chipBg }]}>
                          <ThemedText type="small" style={{ color: surface.chipText }}>
                            {p.name}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <ThemedText type="small" style={{ color: surface.textMuted }}>
                      Noch niemand dabei – sei die:der Erste!
                    </ThemedText>
                  )}
                </View>

                {/* Haftung und Melden – bewusst am Ende und klein.
                    Es MUSS in der App stehen (die Nutzungsbedingungen können
                    nicht das Einzige sein, was das sagt), aber es ist nicht das,
                    weswegen jemand das Popup öffnet. Der ausführliche Text steht
                    einen Tipp entfernt unter „Haftung", siehe src/domain/legal.ts. */}
                <View style={[styles.legalRow, { borderTopColor: surface.cardBorder }]}>
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    Dieses Event kommt von {data.host?.name ?? 'einer Nutzer:in'}, nicht von GÖ4Fun.
                    Die Teilnahme erfolgt auf eigene Verantwortung.
                  </ThemedText>
                  <View style={styles.legalActions}>
                    <Pressable
                      onPress={() => {
                        feedback.tapped();
                        onClose();
                        router.push({ pathname: '/legal', params: { doc: 'liability' } });
                      }}
                      accessibilityRole="link"
                      hitSlop={6}>
                      <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                        Mehr dazu ›
                      </ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        feedback.pressed();
                        setReporting(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Dieses Event melden"
                      hitSlop={6}
                      style={styles.reportLink}>
                      <Icon name="flag" size={14} color={surface.textMuted} />
                      <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                        Melden
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>

                {error ? (
                  <ThemedText type="small" style={styles.errorText}>
                    {error}
                  </ThemedText>
                ) : null}
              </ScrollView>
            </View>

            {/* Erste Nebenweg-Reihe: Teilen, Merken und – wenn man dabei ist –
                der Event-Chat. Diese drei stehen ÜBER Route und Kalender, weil sie
                häufiger gebraucht werden: Ein Event schickt man weiter oder legt
                es sich zur Seite, lange bevor man hinfährt. */}
            <View style={styles.sideActions}>
              <Pressable
                onPress={() => {
                  feedback.pressed();
                  setSharing(data);
                }}
                accessibilityRole="button"
                accessibilityLabel="Event teilen"
                style={({ pressed }) => [
                  styles.sideButton,
                  { borderColor: surface.cardBorder },
                  pressed && styles.pressed,
                ]}>
                <Icon name="share" size={16} color={surface.accent} />
                <ThemedText type="smallBold" style={{ color: surface.accent }}>
                  Teilen
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={toggleSave}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(data.is_saved) }}
                accessibilityLabel={data.is_saved ? 'Nicht mehr merken' : 'Event merken'}
                style={({ pressed }) => [
                  styles.sideButton,
                  {
                    borderColor: data.is_saved ? surface.accent : surface.cardBorder,
                    backgroundColor: data.is_saved ? surface.chipBg : 'transparent',
                  },
                  pressed && styles.pressed,
                ]}>
                {saving ? (
                  <ActivityIndicator size="small" color={surface.accent} />
                ) : (
                  <Icon
                    name={data.is_saved ? 'bookmark-filled' : 'bookmark'}
                    size={16}
                    color={surface.accent}
                  />
                )}
                <ThemedText type="smallBold" style={{ color: surface.accent }}>
                  {data.is_saved ? 'Gemerkt' : 'Merken'}
                </ThemedText>
              </Pressable>

              {/* Der Chat gehört den Teilnehmenden. Wer nur hineinschaut, sieht
                  den Knopf nicht – der Server würde ihn ohnehin mit 404 abweisen. */}
              {data.is_joined ? (
                <Pressable
                  onPress={() => {
                    feedback.tapped();
                    onClose();
                    router.push({
                      pathname: '/chat',
                      params: { kind: 'activity', id: String(data.id), title: data.title },
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Event-Chat öffnen"
                  style={({ pressed }) => [
                    styles.sideButton,
                    { borderColor: surface.cardBorder },
                    pressed && styles.pressed,
                  ]}>
                  <Icon name="chat" size={16} color={surface.accent} />
                  <ThemedText type="smallBold" style={{ color: surface.accent }}>
                    Chat
                  </ThemedText>
                </Pressable>
              ) : null}

              {onDelete ? (
                <Pressable
                  onPress={() => {
                    feedback.pressed();
                    onDelete();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Aktivität löschen"
                  style={({ pressed }) => [
                    styles.sideButton,
                    { borderColor: surface.cardBorder },
                    pressed && styles.pressed,
                  ]}>
                  <Icon name="trash" size={16} color={DANGER} />
                  <ThemedText type="smallBold" style={{ color: DANGER }}>
                    Löschen
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>

            {/* Nebenwege: Route und Kalender. Beide nur, wenn es sie gibt –
                ein Knopf, der nichts tun kann, ist schlimmer als keiner. */}
            {onRoute || calendarLink ? (
              <View style={styles.sideActions}>
                {onRoute ? (
                  <Pressable
                    onPress={onRoute}
                    style={({ pressed }) => [
                      styles.sideButton,
                      { borderColor: surface.cardBorder },
                      pressed && styles.pressed,
                    ]}>
                    <Icon name="map-pin" size={16} color={surface.accent} />
                    <ThemedText type="smallBold" style={{ color: surface.accent }}>
                      Route
                    </ThemedText>
                  </Pressable>
                ) : null}

                {/* Der wirksamste Hebel gegen leere Treffpunkte, den wir haben:
                    eine Erinnerung im eigenen Kalender. Warum ausführlich in
                    `src/domain/calendar-link.ts`. */}
                {calendarLink ? (
                  <Pressable
                    onPress={() => openCalendar(calendarLink)}
                    accessibilityRole="button"
                    accessibilityLabel="Event im Kalender speichern"
                    style={({ pressed }) => [
                      styles.sideButton,
                      { borderColor: surface.cardBorder },
                      pressed && styles.pressed,
                    ]}>
                    <Icon name="calendar" size={16} color={surface.accent} />
                    <ThemedText type="smallBold" style={{ color: surface.accent }}>
                      In den Kalender
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Aktionsleiste */}
            <View style={styles.actions}>
              <PressableScale
                onPress={onClose}
                disabled={busy}
                haptic="none"
                scaleTo={0.96}
                style={[styles.secondaryButton, { borderColor: surface.cardBorder }]}>
                <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                  Schließen
                </ThemedText>
              </PressableScale>

              {/* Der Beitreten-Knopf leuchtet nur, wenn es tatsächlich eng wird
                  (letzte Plätze oder gleich Start) und man noch nicht dabei ist.
                  Ein dauerhaft leuchtender Hauptknopf wäre nach zwei Popups Tapete. */}
              <Glow
                active={!data.is_joined && !joinBlocked && urgency.glow}
                color={signal.warnGlow}
                radius={14}
                intensity="strong"
                style={styles.primaryWrap}>
                <PressableScale
                  onPress={toggleJoin}
                  disabled={busy || joinBlocked}
                  haptic="none"
                  scaleTo={0.96}
                  style={[
                    styles.primaryButton,
                    { backgroundColor: data.is_joined ? surface.chipBg : surface.accent },
                    joinBlocked && styles.blocked,
                  ]}>
                  {busy ? (
                    <ActivityIndicator color={data.is_joined ? surface.chipText : surface.accentText} />
                  ) : (
                    <>
                      {data.is_joined ? (
                        <Icon name="check" size={16} color={surface.chipText} />
                      ) : null}
                      <ThemedText
                        type="smallBold"
                        style={{ color: data.is_joined ? surface.chipText : surface.accentText }}>
                        {data.is_joined ? 'Du bist dabei' : joinBlocked ? 'Event ist voll' : 'Beitreten'}
                      </ThemedText>
                    </>
                  )}
                </PressableScale>
              </Glow>
            </View>

            {celebrating ? <Celebration name={data.title} /> : null}
          </GlassSurface>
        </Animated.View>
      </View>

      {/* Beide Blätter liegen INNERHALB dieses Modals: Ein zweites `Modal`
          daneben würde auf Android hinter dem ersten landen. */}
      <ShareSheet activity={sharing} onClose={() => setSharing(null)} />
      <ReportSheet
        target={reporting ? { type: 'activity', id: data.id, label: data.title } : null}
        onClose={() => setReporting(false)}
      />
    </Modal>
  );
}

/**
 * Der kurze Jubel nach einem Beitritt.
 *
 * Liegt über dem Blatt und lässt alles durch (`pointerEvents="none"`): Wer schon
 * weitertippen will, soll nicht warten müssen, bis die Figur fertig gehüpft ist.
 * Genau daran scheitern die meisten Belohnungs-Animationen – sie halten den
 * Ablauf auf, den sie feiern.
 */
function Celebration({ name }: { name: string }) {
  const surface = useBrandSurface();
  const signal = useSignals();
  const fade = useRef(new Animated.Value(0)).current;

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
    <Animated.View
      pointerEvents="none"
      style={[styles.celebration, { opacity: fade, backgroundColor: signal.goodBg }]}>
      <Mascot mood="cheer" size={104} color={signal.good} celebrate />
      <ThemedText type="subtitle" style={{ color: surface.text }}>
        Du bist dabei!
      </ThemedText>
      <ThemedText type="small" style={[styles.celebrationText, { color: surface.textMuted }]} numberOfLines={2}>
        {name}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  /** Eigene Fläche für den Tipp daneben – der Hintergrund selbst ist nur Optik. */
  backdropTouch: { ...StyleSheet.absoluteFill },
  sheetWrap: {
    // Nur zum Tragen der Bewegung – die Optik macht die Glasfläche darin.
    width: '100%',
  },
  sheet: {
    borderTopLeftRadius: Radius.panel,
    borderTopRightRadius: Radius.panel,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    maxHeight: '88%',
    ...Platform.select({
      android: { elevation: 8 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
      },
    }),
  },
  /** Der Hintergrund des Blattes: deckender Grund + weichgezeichneter Banner. */
  sheetBackdrop: { ...StyleSheet.absoluteFill, zIndex: 0, overflow: 'hidden' },
  sheetBackdropImage: {
    position: 'absolute',
    top: -SHEET_BLEED,
    right: -SHEET_BLEED,
    bottom: -SHEET_BLEED,
    left: -SHEET_BLEED,
  },
  /** Großzügige Griffzone: der Balken allein wäre zu klein zum Treffen. */
  handleZone: { paddingBottom: Spacing.three, alignItems: 'center' },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  /** Nimmt die Höhe, die das Blatt der Liste lässt. */
  listWrap: { flexShrink: 1 },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  banner: {
    width: '100%',
    height: 170,
    borderRadius: Spacing.three,
  },
  metaRow: {
    gap: Spacing.two,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  participantsBlock: {
    gap: Spacing.two,
  },
  participants: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  participantPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  errorText: {
    color: '#ef4444',
  },
  sideActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  /** Haftung und Melden: durch eine Linie abgesetzt, damit es Fußnote bleibt. */
  legalRow: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  reportLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  /** Teilen sich die Breite; einer allein nimmt sie ganz. */
  sideButton: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  /** Der Lichthof-Rahmen trägt die Breite, der Knopf darin füllt ihn aus. */
  primaryWrap: {
    flex: 2,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: 14,
    paddingVertical: Spacing.three,
  },
  /** Voll: bleibt lesbar, ist aber sichtbar nicht mehr im Angebot. */
  blocked: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
  celebration: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderTopLeftRadius: Radius.panel,
    borderTopRightRadius: Radius.panel,
  },
  celebrationText: { textAlign: 'center' },
});
