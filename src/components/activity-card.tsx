import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { HostBanner } from '@/components/host-banner';
import { ThemedText } from '@/components/themed-text';
import { BannerImage } from '@/components/ui/banner-image';
import { Icon } from '@/components/ui/icon';
import { Glow, PulseDot } from '@/components/ui/glow';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TrashIcon } from '@/components/ui/icons';
import { Radius, Spacing } from '@/constants/theme';
import { formatDateTime } from '@/domain/date-format';
import { formatDistance } from '@/domain/distance';
import { urgencyFor, type Urgency } from '@/domain/urgency';
import { useBrandSurface, useGlass, useSignals } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';
import { useResolvedScheme } from '@/lib/theme-preference';

type Props = {
  activity: Activity;
  onPress?: () => void;
  /** Wenn gesetzt, erscheint oben rechts ein Papierkorb (nur für Admins nutzen). */
  onDelete?: () => void;
  /** Entfernung in km, falls bekannt – wird in der Kopfzeile mit angezeigt. */
  distanceKm?: number | null;
  /** `card` = große Kachel mit Banner, `row` = kompakte Zeile für Trefferlisten. */
  layout?: 'card' | 'row';
  /**
   * Höhe des Banners auf der Kachel.
   *
   * Standard 130: die Höhe, mit der die Kacheln in den Regalen stehen. Größer nur
   * dort, wo eine Kachel fast die ganze Breite hat und das Bild die Hauptsache ist
   * (die Sektionen „Für dich empfohlen" und „In deiner Nähe").
   */
  bannerHeight?: number;
  /**
   * Referenz-„jetzt" für die Dringlichkeit. Kommt von außen, damit alle Karten
   * einer Liste vom selben Zeitpunkt ausgehen – sonst rechnet jede Karte mit
   * ihrer eigenen Millisekunde und zwei Karten mit gleichem Start können
   * unterschiedliche Texte zeigen.
   */
  now?: Date;
};

/** „3/8 dabei · voll" bzw. „2 dabei · du bist dabei". */
function attendanceLabel(activity: Activity): string {
  const base =
    activity.max_participants != null
      ? `${activity.participants_count}/${activity.max_participants} dabei`
      : activity.participants_count === 1
        ? '1 dabei'
        : `${activity.participants_count} dabei`;

  if (activity.is_joined) return `${base} · du bist dabei`;
  if (activity.max_participants != null && activity.participants_count >= activity.max_participants) {
    return `${base} · voll`;
  }
  return base;
}

/**
 * Das Zeit-Abzeichen: „Läuft jetzt", „in 40 Min", „Heute, 22:00".
 *
 * Sitzt bewusst auf dem Banner und nicht in der Textspalte: Beim Wischen durch
 * ein Regal liest niemand Zeilen, man scannt Formen. Ein farbiges Abzeichen an
 * immer derselben Stelle ist in dieser Situation die einzige Information, die
 * tatsächlich ankommt.
 */
function TimeBadge({ urgency, onBanner }: { urgency: Urgency; onBanner: boolean }) {
  const surface = useBrandSurface();
  const signal = useSignals();

  if (!urgency.label) return null;

  const live = urgency.tone === 'live';
  const soon = urgency.tone === 'soon';
  const past = urgency.tone === 'past';

  const background = live || soon ? signal.warn : past ? surface.chipBgSolid : surface.accent;
  const color = past ? surface.textMuted : '#ffffff';

  return (
    <Glow active={urgency.glow && (live || soon)} color={signal.warnGlow} radius={Radius.chip} intensity="soft">
      <View style={[styles.badge, { backgroundColor: background }, onBanner && styles.badgeOnBanner]}>
        {live ? <PulseDot color="#ffffff" size={6} /> : null}
        <ThemedText type="small" style={[styles.badgeText, { color }]} numberOfLines={1}>
          {urgency.label}
        </ThemedText>
      </View>
    </Glow>
  );
}

/**
 * „Du bist dabei" als eigenes, ruhig grünes Zeichen.
 *
 * Stand vorher mitten im Teilnehmer-Text („3/8 dabei · du bist dabei") und ging
 * dort unter. Beim Durchwischen einer Liste ist „bin ich hier schon drin?" aber
 * die erste Frage – die gehört an den Rand, nicht in einen Satz.
 */
function JoinedPill() {
  const signal = useSignals();

  return (
    <View style={[styles.badge, { backgroundColor: signal.goodBg }]}>
      <ThemedText type="small" style={[styles.badgeText, { color: signal.good }]}>
        ✓ dabei
      </ThemedText>
    </View>
  );
}

/**
 * Das Platz-Abzeichen. Nur sichtbar, wenn es tatsächlich knapp oder voll ist.
 *
 * „Nur 2 Plätze frei" leuchtet – das ist der Grund, jetzt zu tippen statt später.
 * „Voll" leuchtet nicht: Da ist nichts mehr zu holen, und Aufmerksamkeit auf ein
 * geschlossenes Event zu ziehen wäre schlicht gemein.
 */
function SeatsBadge({ urgency }: { urgency: Urgency }) {
  const surface = useBrandSurface();
  const signal = useSignals();

  if (!urgency.seatsLabel) return null;

  const scarce = urgency.scarce;

  return (
    <Glow
      active={scarce && urgency.glow}
      color={signal.warnGlow}
      radius={Radius.chip}
      intensity="soft"
      durationMs={2800}>
      <View
        style={[
          styles.badge,
          scarce
            ? {
                backgroundColor: signal.warnBg,
                borderColor: signal.warnBorder,
                borderWidth: StyleSheet.hairlineWidth * 2,
              }
            : { backgroundColor: surface.chipBgSolid },
        ]}>
        <ThemedText
          type="small"
          style={[styles.badgeText, { color: scarce ? signal.warn : surface.textMuted }]}
          numberOfLines={1}>
          {urgency.seatsLabel}
        </ThemedText>
      </View>
    </Glow>
  );
}

export function ActivityCard({
  activity,
  onPress,
  onDelete,
  distanceKm,
  layout = 'card',
  bannerHeight = 130,
  now,
}: Props) {
  const surface = useBrandSurface();
  const glass = useGlass();
  const isDark = useResolvedScheme() === 'dark';
  /**
   * Dauerangebot: Bowling, Trampolinhalle, Freibad.
   *
   * Hier wird `starts_at` NICHT angefasst – bei diesen Zeilen steht dort nur der
   * Anlege-Zeitpunkt (siehe server/schema.sql). Ein Datum daraus zu zeigen wäre
   * eine Falschaussage, und die Dringlichkeit würde die Karte als „vergangen"
   * ausgrauen.
   */
  const immerOffen = activity.is_permanent === true;

  const when = immerOffen ? 'Immer möglich' : formatDateTime(activity.starts_at);
  const distance = formatDistance(distanceKm);

  // Ohne `now` von außen: einmal pro Render. Für eine einzeln stehende Karte
  // völlig ausreichend, für Listen gibt der Bildschirm den Zeitpunkt vor.
  //
  // `starts_at: null` bei Dauerangeboten: Damit liefert `urgencyFor` Ton „none"
  // und kein Zeit-Abzeichen – die Platz-Lage („noch 3 frei") kommt weiterhin.
  const urgency = urgencyFor(
    immerOffen ? { ...activity, starts_at: null } : activity,
    now ?? new Date(),
  );

  // Farbton der „Worauf hast du Lust?"-Kacheln – aber DECKEND. Die Kacheln
  // nutzen chipBg mit nur 12 % Deckkraft; auf einer kleinen Kachel mit Emoji
  // liest sich das, aber eine große, fast durchsichtige Kartenfläche verschwimmt
  // mit der Leinwand. Deshalb hier die deckende Wirkfarbe + eine dezente Tiefe,
  // damit die Karte klar als Karte sichtbar ist.
  /**
   * Der Rand ist die einzige Hervorhebung – und bei Dauerangeboten kräftiger.
   *
   * Sie stehen zwischen Terminen und sind etwas anderes: Man kann jederzeit hin.
   * Ein dickerer Rand in der Markenfarbe sagt das ohne ein weiteres Abzeichen,
   * das um Platz mit Zeit und Plätzen konkurrieren würde.
   */
  const tileStyle = {
    backgroundColor: isDark ? '#1d1f30' : '#e8e8f9',
    borderColor: immerOffen ? surface.accent : glass.border,
  };

  if (layout === 'row') {
    return (
      <PressableScale onPress={onPress} accessibilityRole="button" scaleTo={0.985}>
        <View
          style={[
            styles.tile,
            styles.row,
            immerOffen && styles.permanent,
            tileStyle,
            urgency.tone === 'past' && styles.faded,
          ]}>
          {activity.banner_url ? (
            <Image source={{ uri: activity.banner_url }} style={styles.thumb} resizeMode="cover" />
          ) : (
            // Statt für jedes Event dasselbe Ballon-Symbol das Zeichen des
            // Anbieters – siehe `host-banner.tsx`.
            <HostBanner host={activity.host} variant="thumb" />
          )}
          <View style={styles.rowBody}>
            <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
              {activity.title}
            </ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
              {[when, distance].filter(Boolean).join(' · ')}
            </ThemedText>
            <View style={styles.rowMeta}>
              <TimeBadge urgency={urgency} onBanner={false} />
              <SeatsBadge urgency={urgency} />
              {activity.is_joined ? <JoinedPill /> : null}
            </View>
          </View>
        </View>
      </PressableScale>
    );
  }

  return (
    <PressableScale onPress={onPress} accessibilityRole="button" scaleTo={0.975}>
      <View
        style={[
          styles.tile,
          immerOffen && styles.permanent,
          tileStyle,
          urgency.tone === 'past' && styles.faded,
        ]}>
        {activity.banner_url ? (
          <BannerImage uri={activity.banner_url} height={bannerHeight} />
        ) : (
          // Kein eigenes Bild: der weichgezeichnete Grund des Hauses mit seinem
          // Zeichen davor. Damit hat JEDE Kachel ein Banner, und die Abzeichen
          // darüber liegen immer auf demselben Untergrund.
          <HostBanner host={activity.host} variant="banner" height={bannerHeight} />
        )}

        {/* Zeit- und Platz-Lage immer an derselben Stelle: oben links, jetzt
            immer über einem Banner – deshalb braucht es den Sonderfall für
            „ohne Banner" nicht mehr. */}
        {urgency.label || urgency.seatsLabel ? (
          <View style={styles.overlay}>
            {/* Immer `true`: Seit `HostBanner` einspringt, liegt das Abzeichen
                auf jeder Kachel über einem Bild und braucht denselben dunklen
                Grund. */}
            <TimeBadge urgency={urgency} onBanner />
            <SeatsBadge urgency={urgency} />
          </View>
        ) : null}

        {onDelete ? (
          <Pressable
            onPress={onDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Event löschen"
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
            <TrashIcon size={18} color="#ef4444" />
          </Pressable>
        ) : null}

        <View style={styles.body}>
          <ThemedText type="smallBold" style={{ color: surface.text }}>
            {activity.title}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {[when, activity.location].filter(Boolean).join(' · ')}
          </ThemedText>

          <View style={styles.metaRow}>
            <View style={[styles.attendees, { backgroundColor: surface.accent }]}>
              <Icon name="users" size={13} color={surface.accentText} />
              <ThemedText type="small" style={{ color: surface.accentText }}>
                {attendanceLabel(activity)}
              </ThemedText>
            </View>
            {distance ? (
              <View style={[styles.attendees, { backgroundColor: surface.accent }]}>
                <Icon name="map-pin" size={13} color={surface.accentText} />
                <ThemedText type="small" style={{ color: surface.accentText }}>
                  {distance}
                </ThemedText>
              </View>
            ) : null}
            {activity.is_joined ? <JoinedPill /> : null}
          </View>

          <View style={styles.footer}>
            <View style={styles.chips}>
              {activity.interests.slice(0, 3).map((interest) => (
                <View key={interest.id} style={[styles.chip, { backgroundColor: surface.accent }]}>
                  <ThemedText type="small" style={{ color: surface.accentText }}>
                    {interest.name}
                  </ThemedText>
                </View>
              ))}
            </View>

            {activity.host ? (
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                von {activity.host.name}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  /** Vergangene Events bleiben lesbar, treten aber zurück. */
  /**
   * Der kräftigere Rand für Dauerangebote.
   *
   * Nur die BREITE steht hier, die Farbe kommt aus `tileStyle` – sie hängt am
   * Thema (hell/dunkel) und kann deshalb nicht in einem StyleSheet stehen.
   *
   * 3 px, und der Wert ist gemessen und nicht geraten: Die normale Karte nutzt
   * `StyleSheet.hairlineWidth * 2`, und das sind im Browser bereits 2 px. Mit 2 px
   * wäre der Rand hier also nur andersfarbig, nicht dicker – am Gerät (hairline
   * ≈ 0,5) wäre er es gewesen. 3 px liest sich auf BEIDEN als kräftiger.
   */
  permanent: { borderWidth: 3 },
  faded: { opacity: 0.55 },
  // Kachel-Optik: deckende Füllung + Haarlinie und eine dezente Tiefe, damit
  // die große Fläche klar sichtbar bleibt. Farbe kommt aus `tileStyle`.
  tile: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 2 },
      default: {
        shadowColor: 'rgba(23,23,23,0.12)',
        shadowOpacity: 1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  overlay: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    zIndex: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    // Platz für den Papierkorb rechts oben freihalten.
    maxWidth: '72%',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.chip,
  },
  /** Über einem Foto braucht das Abzeichen eine harte Kante, sonst verschwimmt es. */
  badgeOnBanner: {
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: 'rgba(0,0,0,0.45)',
        shadowOpacity: 1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  badgeText: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  deleteButton: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    zIndex: 3,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  body: { padding: Spacing.three, gap: Spacing.two },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  attendees: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Radius.chip,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, flexShrink: 1 },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Radius.chip,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, alignItems: 'center' },
  thumb: { width: 68, height: 68, borderRadius: Radius.field },
  rowBody: { flex: 1, gap: 2, paddingRight: Spacing.two },
});
