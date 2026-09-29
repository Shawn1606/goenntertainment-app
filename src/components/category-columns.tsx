import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ActivityCard } from '@/components/activity-card';
import { ThemedText } from '@/components/themed-text';
import { BannerImage } from '@/components/ui/banner-image';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Entrance } from '@/components/ui/entrance';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { ChevronRightIcon } from '@/components/ui/icons';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Rail } from '@/components/ui/rail';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';

/**
 * Höhe des Titelbild-Deckels.
 *
 * 208 statt der früheren 148: Bei 148 war das Bild ein Streifen, auf dem man das
 * Motiv erraten musste. Ein Plakat im Hochformat ist bei dieser Höhe und einer
 * Spaltenbreite von 360 immerhin zur Hälfte zu sehen – und quer liegende Banner
 * (16:9) füllen den Deckel fast genau aus.
 *
 * Steht hier und nicht nur im Stil, weil drei Dinge sie brauchen: der Deckel
 * selbst, das Feld mit den Wisch-Pfeilen – und die Startseite, deren Banner in den
 * Sektionen darüber sich an diesem Maß orientieren (etwas kleiner, siehe dort).
 */
export const COVER_HEIGHT = 208;

/** Eine Spalte: eine Kategorie und ihre Termine. */
export type ColumnSpec = {
  /** Stabiler Schlüssel für `key`-Props. */
  key: string;
  title: string;
  /** Zeichen der Kategorie – für den Restposten „Weitere" gibt es keins. */
  interest?: { name?: string | null; icon?: string | null } | null;
  /** Ersatzzeichen, wenn die Kategorie keines hat (Restposten). */
  icon?: UiIconName;
  activities: Activity[];
};

type Props = {
  columns: ColumnSpec[];
  onPress: (activity: Activity) => void;
  onDelete?: (activity: Activity) => void;
  distanceById?: Map<number, number>;
  /** Referenz-„jetzt", damit alle Karten von derselben Uhrzeit ausgehen. */
  now?: Date;
  /**
   * Höchstens so viele Termine je Spalte; der Rest hängt an `onShowAll`.
   *
   * Nötig, weil eine `ScrollView` alle ihre Kinder sofort baut – bei 74 Konzerten
   * und 49 Tanzabenden wären das über hundert Karten beim Aufbau der Startseite.
   */
  limit: number;
  /** „Alle ansehen" am Fuß einer gekappten Spalte. */
  onShowAll: (column: ColumnSpec) => void;
};

/**
 * Die Kategorien NEBENEINANDER, jede als eigene Liste – der waagerecht wischbare
 * Teil der Startseite.
 *
 * ## Warum die Kategorien nebeneinander liegen
 *
 * Als gestapelte Blöcke („Konzerte", darunter „Tanzen", darunter „Comedy", …)
 * wächst die Startseite mit jeder Kategorie um eine Bildschirmhöhe: Wer Comedy
 * sucht, scrollt an allem anderen vorbei, und was unten liegt, sieht praktisch
 * niemand. Nebeneinander ist der WECHSEL der Kategorie eine Wischbewegung,
 * unabhängig davon, wie viele es gibt – und die Liste darin bleibt eine Liste, in
 * der man senkrecht liest.
 *
 * Dieser Baustein ist deshalb bewusst nur für die Sektion „Kategorien" da. Die
 * übrigen Sektionen der Startseite („Für dich empfohlen", „In deiner Nähe", „In
 * den nächsten Monaten") sind senkrechte Blöcke in voller Breite – siehe
 * `activity-list-section.tsx`. Sie beantworten je EINE Frage; da gibt es nichts zu
 * wechseln, und waagerechtes Wischen wäre dort nur eine zweite Bedienrichtung
 * ohne Zweck.
 *
 * ## Waagerecht wischen, senkrecht lesen
 *
 * Jede Spalte ist so breit wie fast der ganze Bildschirm, mit einem Streifen der
 * nächsten am Rand. Ohne diesen Streifen sieht die Seite aus, als gäbe es nur die
 * eine Liste – der Rand ist der Hinweis, dass daneben noch etwas liegt (dazu
 * kommt der Pfeil, siehe `scroll-hint.tsx`).
 *
 * Die Liste in der Spalte scrollt NICHT selbst. Zwei Scroll-Flächen ineinander,
 * beide senkrecht, wären genau die Sorte Bedienung, bei der man nie weiß, welche
 * gerade greift. Stattdessen zeigt die Spalte die nächsten `limit` Termine und
 * am Fuß „Alle ansehen" – dort steht die vollständige Liste in einem Blatt.
 *
 * ## Eingefahren, mit Titelbild
 *
 * Die Listen liegen zu: Jede Spalte zeigt zunächst nur ihr Titelbild mit Name und
 * Anzahl, Tippen klappt sie auf. Damit ist die ganze Auswahl auf EINEM Bild zu
 * sehen, statt dass die erste geöffnete Liste alle anderen nach unten schiebt.
 *
 * Es ist höchstens EINE Spalte offen. Zwei geöffnete Listen machen den Streifen so
 * hoch wie die längere, und daneben stehen dann kurze Spalten mit viel Luft –
 * genau das Bild, das das Einfahren vermeiden soll.
 */
export function CategoryColumns({
  columns,
  onPress,
  onDelete,
  distanceById,
  now,
  limit,
  onShowAll,
}: Props) {
  const { width } = useWindowDimensions();

  // Fast die ganze Breite, ein Streifen der nächsten Spalte bleibt sichtbar.
  const contentWidth = Math.min(width, MaxContentWidth);
  const columnWidth = Math.min(360, contentWidth - Spacing.four - Spacing.five);

  /** Welche Spalte offen ist – `null` heißt: alle eingefahren. */
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Eine leere Kategorie wäre eine Wischbewegung ins Nichts.
  const visible = columns.filter((column) => column.activities.length > 0);
  if (visible.length === 0) return null;

  return (
    // Die Pfeile liegen auf Höhe der Titelbilder (`hintHeight`), nicht in der
    // Mitte der Reihe: Ist eine Spalte offen, ist die Reihe mehrere
    // Bildschirmhöhen hoch – mittig wären die Pfeile dann irgendwo in der Liste,
    // weit weg von dem, was sie bewegen.
    <Rail
      itemWidth={columnWidth}
      hintHeight={COVER_HEIGHT}
      labels={{ left: 'Vorherige Liste', right: 'Nächste Liste' }}
      // Jede Spalte behält ihre eigene Höhe. Ohne das streckt die Reihe alle auf
      // die Höhe der geöffneten – die eingefahrenen wären dann meterhohe leere
      // Flächen mit einem Titelbild obendrauf.
      contentStyle={styles.track}>
      {visible.map((column, index) => (
        <Entrance key={column.key} index={index} style={{ width: columnWidth }}>
          <Column
            column={column}
            expanded={openKey === column.key}
            onToggle={() => setOpenKey((prev) => (prev === column.key ? null : column.key))}
            onPress={onPress}
            onDelete={onDelete}
            distanceById={distanceById}
            now={now}
            limit={limit}
            onShowAll={() => onShowAll(column)}
          />
        </Entrance>
      ))}
    </Rail>
  );
}

/** Eine Spalte: Titelbild als Deckel, darunter – aufgeklappt – ihre Termine. */
function Column({
  column,
  expanded,
  onToggle,
  onPress,
  onDelete,
  distanceById,
  now,
  limit,
  onShowAll,
}: {
  column: ColumnSpec;
  expanded: boolean;
  onToggle: () => void;
  onPress: (activity: Activity) => void;
  onDelete?: (activity: Activity) => void;
  distanceById?: Map<number, number>;
  now?: Date;
  limit: number;
  onShowAll: () => void;
}) {
  const surface = useBrandSurface();

  const shown = column.activities.slice(0, limit);
  const rest = column.activities.length - shown.length;

  return (
    <GlassSurface tone="frost" radius={Radius.panel}>
      <Cover column={column} expanded={expanded} onToggle={onToggle} />

      {expanded ? (
        // Der Eintritt läuft beim Aufklappen und macht sichtbar, dass der Inhalt
        // ZU DIESEM Deckel gehört – ohne ihn erscheint die Liste einfach, und der
        // Streifen springt bloß in die Höhe.
        <Entrance index={0} style={styles.body}>
          {/* Kompakte Zeilen statt Kacheln mit Banner: In einer Spalte zählt, wie
              viele Termine gleichzeitig lesbar sind – mit Bannern wären es zwei.
              Das eine Bild der Spalte trägt der Deckel. */}
          <View style={styles.list}>
            {shown.map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                onPress={() => onPress(activity)}
                onDelete={onDelete ? () => onDelete(activity) : undefined}
                distanceKm={distanceById?.get(activity.id) ?? null}
                layout="row"
                now={now}
              />
            ))}
          </View>

          {rest > 0 ? (
            <PressableScale
              onPress={onShowAll}
              accessibilityRole="button"
              accessibilityLabel={`${column.title}: alle ansehen, ${rest} weitere`}
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
        </Entrance>
      ) : null}
    </GlassSurface>
  );
}

/**
 * Der Deckel einer Spalte: Titelbild, Name, Anzahl – und der Knopf zum Auf- und
 * Zuklappen.
 *
 * ## Woher das Bild kommt
 *
 * Aus einem Termin der Spalte, nicht aus der Kategorie: Kategorien haben in dieser
 * App ein Zeichen, aber kein Bild. Genommen wird der ERSTE Termin mit Bild – die
 * Liste ist nach Startzeit sortiert, das ist also das Bild, das am ehesten noch
 * aktuell ist und der Grund, warum jemand hinschaut. Hat keiner ein Bild, steht
 * das Zeichen der Kategorie groß auf getönter Fläche; ein leerer grauer Streifen
 * wäre kein Titelbild, sondern eine Lücke.
 *
 * Das Bild füllt den Deckel und wird dafür zugeschnitten – warum das so gewollt
 * ist, steht in `banner-image.tsx`.
 *
 * ## Warum ein Schleier über dem Bild
 *
 * Name und Anzahl stehen AUF dem Bild – der Deckel soll ein Titel sein, keine
 * Bildunterschrift. Fremde Bilder sind aber beliebig hell; ohne den Verlauf nach
 * unten wäre die weiße Schrift auf einem Sommerhimmel unlesbar. Deshalb liegt er
 * auch über der Ersatzfläche: EINE Regel für alle Fälle statt zwei Textfarben.
 */
function Cover({
  column,
  expanded,
  onToggle,
}: {
  column: ColumnSpec;
  expanded: boolean;
  onToggle: () => void;
}) {
  const banner = column.activities.find((activity) => activity.banner_url)?.banner_url ?? null;
  const count = column.activities.length;

  return (
    <PressableScale
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      // Im Web übersetzt React Native Web `expanded` nicht nach `aria-expanded`
      // – siehe die Notiz in `setting-row.tsx`.
      aria-expanded={expanded}
      accessibilityLabel={`${column.title}, ${count} Termine, ${expanded ? 'zuklappen' : 'aufklappen'}`}
      haptic="select"
      scaleTo={0.985}>
      <View style={styles.cover}>
        {banner ? (
          // Formatfüllend, auch wenn dabei etwas wegfällt – siehe `banner-image.tsx`.
          <BannerImage uri={banner} height={COVER_HEIGHT} />
        ) : (
          <CoverFallback column={column} />
        )}

        <LinearGradient
          colors={['transparent', 'rgba(12,12,24,0.35)', 'rgba(12,12,24,0.86)']}
          style={styles.scrim}
          pointerEvents="none"
        />

        <View style={styles.coverText}>
          <ThemedText style={styles.coverTitle} numberOfLines={2}>
            {column.title}
          </ThemedText>
          <View style={styles.coverMeta}>
            <ThemedText type="small" style={styles.coverCount}>
              {count === 1 ? '1 Termin' : `${count} Termine`}
            </ThemedText>
            <ThemedText type="small" style={styles.coverHint}>
              {expanded ? 'zuklappen' : 'aufklappen'}
            </ThemedText>
            {/* Kein eigenes Auf-/Ab-Zeichen im Satz: derselbe Winkel gedreht ist
                dieselbe Form, und zwei Zeichnungen liefen auseinander. */}
            <ChevronRightIcon
              size={18}
              color="#ffffff"
              style={expanded ? styles.chevronUp : styles.chevronDown}
            />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

/** Titelbild-Ersatz: das Zeichen der Spalte groß auf getönter Fläche. */
function CoverFallback({ column }: { column: ColumnSpec }) {
  const surface = useBrandSurface();

  return (
    <View style={[styles.coverFallback, { backgroundColor: surface.chipBg }]}>
      {column.interest ? (
        <CategoryIcon interest={column.interest} size={44} color={surface.accent} />
      ) : column.icon ? (
        <Icon name={column.icon} size={44} color={surface.accent} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { alignItems: 'flex-start' },
  /** Der Deckel: bewusst hoch genug, dass ein Bild eines ist und kein Streifen. */
  cover: { height: COVER_HEIGHT, justifyContent: 'flex-end' },
  coverFallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Nur das untere Drittel – oben soll das Bild ungetrübt bleiben.
   *
   * Beim kleinen Deckel waren es 72 %: Bei 148 px lag der Text sonst auf hellem
   * Bild. Der große Deckel hat genug Höhe, dass der Verlauf tief unten anfangen
   * kann und das Motiv frei bleibt.
   */
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  coverText: { padding: Spacing.three, gap: 2 },
  coverTitle: {
    color: '#ffffff',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  coverMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  coverCount: { color: 'rgba(255,255,255,0.92)', fontWeight: '700' },
  /** Schiebt den Pfeil an den rechten Rand – das Wort davor bleibt am Text. */
  coverHint: { color: 'rgba(255,255,255,0.72)', flex: 1, textAlign: 'right' },
  chevronDown: { transform: [{ rotate: '90deg' }] },
  chevronUp: { transform: [{ rotate: '-90deg' }] },
  /** Der aufgeklappte Teil padded selbst – der Deckel läuft randlos. */
  body: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  list: { gap: Spacing.two },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
});
