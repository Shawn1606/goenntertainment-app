import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ActivityCard } from '@/components/activity-card';
import { HostGroupCard } from '@/components/host-group-card';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { CategoryIcon } from '@/components/ui/category-icon';
import { GlassSurface } from '@/components/ui/glass';
import { Skeleton } from '@/components/ui/glow';
import { Icon } from '@/components/ui/icon';
import { ScrollHint } from '@/components/ui/scroll-hint';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { groupByHost, type GroupableHost } from '@/domain/host-group';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';
import { useResolvedScheme } from '@/lib/theme-preference';

type Props = {
  title: string;
  /** Kleines Zeichen vor der Überschrift – gibt jedem Regal ein Gesicht. */
  icon?: UiIconName;
  /**
   * Statt `icon`: das Zeichen DIESER Kategorie.
   *
   * Nötig, weil Kategorie- und Oberflächen-Symbole zwei getrennte Sätze sind
   * (`CategoryIconName` vs. `UiIconName`) – ein Musik-Regal kann sein Zeichen
   * nicht aus dem Oberflächen-Satz nehmen, dort gibt es keine Note. Bei den
   * Regalen je Interesse ist genau das der Punkt: Ohne eigenes Zeichen sähen
   * zehn Kategorien gleich aus.
   */
  interest?: { name?: string | null; icon?: string | null } | null;
  activities: Activity[];
  onPress: (activity: Activity) => void;
  onDelete?: (activity: Activity) => void;
  /**
   * Ein Veranstalter mit mehreren Terminen wurde angetippt – der Bildschirm
   * öffnet damit die Liste. Ohne diese Prop wird NICHT gebündelt: Ein Regal, das
   * gruppiert, aber die Gruppe nicht öffnen kann, wäre eine Sackgasse.
   */
  onOpenHost?: (host: GroupableHost, activities: Activity[]) => void;
  /** Spinner statt Inhalt (z. B. während Standort/Geocoding laufen). */
  loading?: boolean;
  /** Text, wenn nichts in diesem Regal liegt. */
  emptyText: string;
  /** Bekannte Entfernungen je Activity-ID – werden auf den Karten angezeigt. */
  distanceById?: Map<number, number>;
  /** Kurzer Hinweis unter der Überschrift (z. B. „Umkreis erweitert"). */
  note?: string;
  /**
   * Karten übereinander je Spalte. 1 = klassisches Regal (eine Reihe), was
   * ruhiger wirkt; mehr staffelt sie und packt mehr auf den Bildschirm.
   */
  rows?: number;
  /**
   * Referenz-„jetzt" für die Dringlichkeits-Abzeichen auf den Karten. Kommt vom
   * Bildschirm, damit alle Regale von derselben Uhrzeit ausgehen.
   */
  now?: Date;
};

/** Teilt eine Liste in Spalten zu je `size` Einträgen. */
function chunk<T>(items: T[], size: number): T[][] {
  const columns: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    columns.push(items.slice(i, i + size));
  }
  return columns;
}

/** Ein Event als Regal-Eintrag, wenn nicht gebündelt wird. */
function asSingle(activity: Activity) {
  return { kind: 'single' as const, key: `activity-${activity.id}`, activity };
}

/**
 * Ein „Regal": Überschrift + horizontal wischbare Karten. Standardmäßig eine
 * Reihe – das liest sich ruhiger als ein Raster und ist aus Streaming-Apps
 * vertraut. Die nächste Karte lugt am Rand hervor, damit klar ist, dass es
 * weitergeht.
 */
export function ActivityShelf({
  title,
  icon,
  interest,
  activities,
  onPress,
  onDelete,
  onOpenHost,
  loading,
  emptyText,
  distanceById,
  note,
  rows = 1,
  now,
}: Props) {
  const surface = useBrandSurface();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  // Spaltenbreite mit „Peek" auf die nächste Spalte. Einreihige Regale
  // bekommen schmalere Karten, damit mehr als eine ins Blickfeld passt.
  const contentWidth = Math.min(width, MaxContentWidth);
  const columnWidth = Math.min(rows > 1 ? 360 : 272, contentWidth - Spacing.four - Spacing.five);
  const step = columnWidth + Spacing.three;

  /**
   * Was im Regal steht: einzelne Events, und je Veranstalter mit vielen Terminen
   * EINE Karte.
   *
   * Ohne `onOpenHost` bleibt alles einzeln – dann kann der Bildschirm die Gruppe
   * nicht öffnen, und eine Karte, die auf nichts führt, ist schlimmer als
   * Wiederholung. Warum überhaupt gebündelt wird: `src/domain/host-group.ts`.
   */
  const entries = useMemo(
    () => (onOpenHost ? groupByHost(activities) : activities.map(asSingle)),
    [activities, onOpenHost],
  );

  const columns = chunk(entries, Math.max(1, rows));

  // Wohin lässt sich noch wischen? Die Maße liegen in einem Ref, damit das
  // Scrollen selbst nichts neu rendert – nur wenn ein Pfeil tatsächlich
  // erscheint oder verschwindet, geht ein Render los.
  const geo = useRef({ x: 0, view: 0, content: 0 });
  const [reach, setReach] = useState({ left: false, right: false });

  const sync = useCallback(() => {
    const { x, view, content } = geo.current;
    // 8 px Toleranz: gegen Rundungsfehler und das Gummiband am Rand.
    const left = x > 8;
    const right = content - view - x > 8;
    // Nur bei echter Änderung ein neues Objekt: Sonst löst jedes Layout-Ereignis
    // einen Render aus, der das nächste Layout-Ereignis nach sich zieht.
    setReach((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  /** Sichtbare Breite des Regals. */
  const onViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      geo.current.view = event.nativeEvent.layout.width;
      sync();
    },
    [sync],
  );

  /** Gesamtbreite aller Karten. */
  const onContentSizeChange = useCallback(
    (contentWidth: number) => {
      geo.current.content = contentWidth;
      sync();
    },
    [sync],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      geo.current = { x: contentOffset.x, view: layoutMeasurement.width, content: contentSize.width };
      sync();
    },
    [sync],
  );

  /** Eine Spalte weiter blättern – der Pfeil ist Hinweis UND Knopf. */
  const page = useCallback(
    (direction: -1 | 1) => {
      const target = Math.max(0, geo.current.x + direction * step);
      scrollRef.current?.scrollTo({ x: target, animated: true });
    },
    [step],
  );

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <View style={styles.headRow}>
          {/* Ohne `label`: Das Symbol wiederholt nur die Überschrift daneben,
              vorgelesen wäre es Lärm. */}
          {interest ? (
            <CategoryIcon interest={interest} size={19} color={surface.accent} />
          ) : icon ? (
            <Icon name={icon} size={19} color={surface.accent} />
          ) : null}
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

      {loading ? (
        /* Platzhalter in Kartenform statt Spinner: Das Layout steht dadurch
           schon, wenn die Daten eintreffen – es ruckelt nichts nach, und die
           Seite wirkt schneller, obwohl sie genauso lange lädt. */
        <ScrollView
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.track}>
          {[0, 1].map((index) => (
            <CardSkeleton key={index} width={columnWidth} />
          ))}
        </ScrollView>
      ) : columns.length === 0 ? (
        <GlassSurface
          tone="accent"
          radius={Radius.card}
          style={[styles.state, styles.empty, { width: columnWidth, marginHorizontal: Spacing.four }]}>
          <ThemedText type="small" style={[styles.emptyText, { color: surface.textMuted }]}>
            {emptyText}
          </ThemedText>
        </GlassSurface>
      ) : (
        <View>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={step}
            snapToAlignment="start"
            scrollEventThrottle={32}
            onScroll={onScroll}
            onLayout={onViewLayout}
            onContentSizeChange={onContentSizeChange}
            contentContainerStyle={styles.track}>
            {/* Gestaffelt nach Spalte, nicht nach Karte: Die zwei Karten einer
                Spalte stehen übereinander und sollen gemeinsam eintreten – die
                Welle läuft von links nach rechts, also in Wischrichtung. */}
            {columns.map((column, index) => (
              <Entrance key={index} index={index} style={[styles.column, { width: columnWidth }]}>
                {column.map((entry) =>
                  entry.kind === 'host' ? (
                    <HostGroupCard
                      key={entry.key}
                      host={entry.host}
                      activities={entry.activities}
                      onPress={() => onOpenHost?.(entry.host, entry.activities)}
                    />
                  ) : (
                    <ActivityCard
                      key={entry.key}
                      activity={entry.activity}
                      onPress={() => onPress(entry.activity)}
                      onDelete={onDelete ? () => onDelete(entry.activity) : undefined}
                      distanceKm={distanceById?.get(entry.activity.id) ?? null}
                      now={now}
                    />
                  ),
                )}
              </Entrance>
            ))}
          </ScrollView>

          {/* Die Pfeile sagen „hier geht es weiter" und blättern auf Tippen eine
              Spalte. Sie liegen über dem Regal, fangen aber nur ihre eigene
              Fläche ab – gewischt wird weiter überall. */}
          <ScrollHint
            side="left"
            visible={reach.left}
            onPress={() => page(-1)}
            label="Eine Karte zurück"
          />
          <ScrollHint
            side="right"
            visible={reach.right}
            onPress={() => page(1)}
            label="Weitere Karten anzeigen"
          />
        </View>
      )}
    </View>
  );
}

/**
 * Eine Karte, die noch nicht da ist.
 *
 * Die Maße folgen bewusst der echten Karte (Banner 130 px, dann Titel, Zeile,
 * Pille): Nur dann ist es ein Platzhalter und kein grauer Klotz. Weicht die Form
 * ab, springt der Inhalt beim Eintreffen – und genau das wollte man vermeiden.
 */
function CardSkeleton({ width }: { width: number }) {
  const glass = useGlass();
  const isDark = useResolvedScheme() === 'dark';

  const base = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(23,23,23,0.06)';
  const sheen = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.75)';

  return (
    <View
      style={[
        styles.skeletonCard,
        { width, backgroundColor: isDark ? '#1d1f30' : '#e8e8f9', borderColor: glass.border },
      ]}>
      <Skeleton color={base} sheenColor={sheen} height={130} radius={0} />
      <View style={styles.skeletonBody}>
        <Skeleton color={base} sheenColor={sheen} width="70%" height={13} />
        <Skeleton color={base} sheenColor={sheen} width="45%" height={11} />
        <Skeleton color={base} sheenColor={sheen} width={120} height={20} radius={999} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  head: {
    marginHorizontal: Spacing.four,
    gap: 2,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flexShrink: 1,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  count: {
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 16,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  note: {
    lineHeight: 18,
  },
  track: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  column: {
    gap: Spacing.three,
  },
  state: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonCard: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
  },
  skeletonBody: { padding: Spacing.three, gap: Spacing.two },
  empty: {
    padding: Spacing.four,
  },
  emptyText: {
    textAlign: 'center',
  },
});
