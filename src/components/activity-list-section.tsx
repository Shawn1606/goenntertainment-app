import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ActivityCard } from '@/components/activity-card';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassSurface } from '@/components/ui/glass';
import { Skeleton } from '@/components/ui/glow';
import { Icon } from '@/components/ui/icon';
import { ChevronRightIcon } from '@/components/ui/icons';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Rail } from '@/components/ui/rail';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';
import { useResolvedScheme } from '@/lib/theme-preference';

type Props = {
  title: string;
  /** Kleines Zeichen vor der Überschrift – gibt jeder Sektion ein Gesicht. */
  icon?: UiIconName;
  activities: Activity[];
  onPress: (activity: Activity) => void;
  onDelete?: (activity: Activity) => void;
  distanceById?: Map<number, number>;
  /** Referenz-„jetzt", damit alle Karten von derselben Uhrzeit ausgehen. */
  now?: Date;
  /** Kurzer Hinweis unter der Überschrift (z. B. „Umkreis erweitert"). */
  note?: string;
  /** Was in der Sektion steht, wenn nichts drin ist. */
  emptyText?: string;
  /** Platzhalter statt Inhalt (z. B. während Standort/Geocoding laufen). */
  loading?: boolean;
  /**
   * Höchstens so viele Termine; der Rest hängt an `onShowAll`.
   *
   * Die Sektion ist Teil der senkrecht scrollenden Startseite: Ohne Grenze wären
   * „In den nächsten Monaten" 124 Karten, an denen man erst einmal vorbeiscrollen
   * müsste, um zur nächsten Sektion zu kommen.
   */
  limit: number;
  /**
   * So viele Termine übereinander, dann geht es waagerecht weiter.
   *
   * Ohne diese Prop ist die Sektion eine einfache senkrechte Liste. Mit ihr wird
   * sie eine Reihe von Seiten zu je `perPage` Zeilen: Zwei Termine sind dann ein
   * ruhiger Anblick, und der Rest kostet einen Wisch statt einer halben
   * Bildschirmhöhe Scrollen (siehe `rail.tsx`).
   *
   * `limit` sollte ein Vielfaches davon sein, sonst steht auf der letzten Seite
   * eine Zeile allein.
   */
  perPage?: number;
  /**
   * Höhe des Banners auf den Karten – nur im Seitenmodus.
   *
   * Ohne diese Prop bleiben es kompakte Zeilen mit Vorschaubild (68 px). Mit ihr
   * werden es Kacheln mit formatfüllendem Banner – die Form für die zwei Sektionen
   * oben, wo das Bild die Hauptsache ist.
   */
  bannerHeight?: number;
  /** „Alle ansehen" am Fuß, wenn gekappt wurde. */
  onShowAll: () => void;
};

/** Teilt eine Liste in Seiten zu je `size` Einträgen. */
function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

/**
 * Eine Sektion der Startseite in voller Breite: Überschrift, darunter ihre
 * Termine – senkrecht gestapelt oder, mit `perPage`, seitenweise zum Wischen.
 *
 * ## Die Sektion selbst liegt immer in voller Breite
 *
 * Zwei Sektionen nebeneinander wären auf einem Handy zwei halbe Sektionen. Der
 * Block nimmt deshalb stets die ganze Breite ein; waagerecht bewegt sich
 * höchstens sein INHALT – und dann in Seiten zu je `perPage` Zeilen, nicht in
 * einzelnen Karten. Eine Seite mit zwei Terminen ist ein Anblick, den man liest;
 * eine Reihe aus eineinhalb sichtbaren Karten ist einer, den man wischt.
 *
 * Die Karten sind die kompakte Form (`layout="row"`): Hier zählt, wie viele
 * Termine gleichzeitig lesbar sind – mit Bannern wären es zwei.
 */
export function ActivityListSection({
  title,
  icon,
  activities,
  onPress,
  onDelete,
  distanceById,
  now,
  note,
  emptyText,
  loading,
  limit,
  perPage,
  bannerHeight,
  onShowAll,
}: Props) {
  const surface = useBrandSurface();
  const { width } = useWindowDimensions();

  const shown = activities.slice(0, limit);
  const rest = activities.length - shown.length;

  // Fast die ganze Breite, ein Streifen der nächsten Seite bleibt sichtbar –
  // sonst sieht die Sektion aus, als wären das alle Termine.
  const contentWidth = Math.min(width, MaxContentWidth);
  const pageWidth = Math.min(360, contentWidth - Spacing.four - Spacing.five);

  /**
   * Die Einträge einer Seite.
   *
   * Mit `bannerHeight` sind es Kacheln mit großem Banner; ohne bleiben es kompakte
   * Zeilen mit kleinem Vorschaubild.
   */
  const rows = (page: Activity[], offset: number) =>
    page.map((activity, index) => (
      <Entrance key={activity.id} index={offset + index}>
        <ActivityCard
          activity={activity}
          onPress={() => onPress(activity)}
          onDelete={onDelete ? () => onDelete(activity) : undefined}
          distanceKm={distanceById?.get(activity.id) ?? null}
          layout={bannerHeight ? 'card' : 'row'}
          bannerHeight={bannerHeight}
          now={now}
        />
      </Entrance>
    ));

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <View style={styles.headRow}>
          {/* Ohne `label`: Das Symbol wiederholt nur die Überschrift daneben,
              vorgelesen wäre es Lärm. */}
          {icon ? <Icon name={icon} size={19} color={surface.accent} /> : null}
          <ThemedText style={[styles.title, { color: surface.text }]} numberOfLines={1}>
            {title}
          </ThemedText>
          {activities.length > 0 ? (
            <ThemedText
              type="small"
              style={[styles.count, { color: surface.chipText, backgroundColor: surface.chipBg }]}>
              {activities.length}
            </ThemedText>
          ) : null}
        </View>
        {note ? (
          <ThemedText type="small" style={[styles.note, { color: surface.textMuted }]}>
            {note}
          </ThemedText>
        ) : null}
      </View>

      {/* Der wischbare Teil hängt NICHT im gepolsterten Körper: Die Reihe muss
          randlos laufen, damit die nächste Seite am Bildschirmrand hervorlugt. */}
      {perPage && shown.length > 0 && !(loading && shown.length === 0) ? (
        <Rail
          itemWidth={pageWidth}
          labels={{ left: 'Vorherige Seite', right: 'Weitere Termine anzeigen' }}
          contentStyle={styles.track}>
          {chunk(shown, perPage).map((page, index) => (
            <View key={page[0].id} style={[styles.page, { width: pageWidth }]}>
              {rows(page, index * perPage)}
            </View>
          ))}
        </Rail>
      ) : null}

      <View style={styles.body}>
        {loading && shown.length === 0 ? (
          /* Platzhalter in Zeilenform statt Spinner: Das Layout steht dadurch
             schon, wenn die Daten eintreffen – es ruckelt nichts nach. */
          [0, 1, 2].map((index) => <RowSkeleton key={index} />)
        ) : shown.length === 0 ? (
          <GlassSurface tone="accent" radius={Radius.card} style={styles.empty}>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {emptyText}
            </ThemedText>
          </GlassSurface>
        ) : perPage ? null : (
          rows(shown, 0)
        )}

        {rest > 0 ? (
          <PressableScale
            onPress={onShowAll}
            accessibilityRole="button"
            accessibilityLabel={`${title}: alle ansehen, ${rest} weitere`}
            haptic="select"
            scaleTo={0.98}>
            <View style={[styles.more, { borderTopColor: surface.cardBorder }]}>
              <ThemedText type="smallBold" style={{ color: surface.accent }}>
                {`Alle ansehen · noch ${rest}`}
              </ThemedText>
              <ChevronRightIcon size={18} color={surface.accent} />
            </View>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Eine Zeile, die noch nicht da ist.
 *
 * Die Maße folgen der kompakten Karte (`layout="row"`): Nur dann ist es ein
 * Platzhalter und kein grauer Balken, und der Inhalt springt beim Eintreffen
 * nicht.
 */
function RowSkeleton() {
  const glass = useGlass();
  const isDark = useResolvedScheme() === 'dark';

  const base = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(23,23,23,0.06)';
  const sheen = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.75)';

  return (
    <View style={[styles.rowSkeleton, { borderColor: glass.border }]}>
      <Skeleton color={base} sheenColor={sheen} width={64} height={64} radius={Radius.card} />
      <View style={styles.rowSkeletonBody}>
        <Skeleton color={base} sheenColor={sheen} width="70%" height={13} />
        <Skeleton color={base} sheenColor={sheen} width="45%" height={11} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  // Kopf und Körper padden selbst, damit die Sektion wie die Regale auf einer
  // Kante mit dem übrigen Bildschirm steht.
  head: { marginHorizontal: Spacing.four, gap: 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // Maße wie `styles.title` in `activity-shelf.tsx` – gleiche Rolle, gleiche Form.
  title: {
    flexShrink: 1,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  // Und wie `styles.count` dort.
  count: {
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 16,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  note: { lineHeight: 18 },
  /** Jede Seite behält ihre eigene Höhe – eine halbe Seite streckt die andere nicht. */
  track: { alignItems: 'flex-start' },
  /** Die Zeilen einer Seite, untereinander. */
  page: { gap: Spacing.two },
  body: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  empty: { padding: Spacing.four },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  rowSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  rowSkeletonBody: { flex: 1, gap: Spacing.two },
});
