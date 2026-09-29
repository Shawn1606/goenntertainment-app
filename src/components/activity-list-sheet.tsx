import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { ListSectionHeader } from '@/components/ui/list-section-header';
import { useSheetDrag } from '@/components/ui/use-sheet-drag';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { listSections } from '@/domain/list-sections';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';

/**
 * Über den Activity-Typ generisch, damit die Auswahl DENSELBEN Typ zurückgibt,
 * der hineingegeben wurde.
 *
 * Die Karte gibt `MapActivity` herein – Activity plus Koordinaten – und braucht
 * sie in der Auswahl wieder, um „Route anzeigen" anbieten zu können. Mit einem
 * festen `Activity` müsste dort gecastet werden, und ein Cast wäre eine
 * Behauptung, die niemand prüft.
 */
type Props<T extends Activity> = {
  /** Überschrift – der Ort oder der Veranstalter. `null` schließt das Blatt. */
  title: string | null;
  /** Zeile darunter, z. B. „14 Termine · Gronerstraße 23". */
  subtitle?: string;
  /** Zeichen vor der Überschrift. */
  icon?: UiIconName;
  activities: readonly T[];
  /** Ein Eintrag wurde gewählt – der Aufrufer öffnet damit das Detail-Blatt. */
  onSelect: (activity: T) => void;
  onClose: () => void;
  /** Bekannte Entfernungen je Activity-ID. */
  distanceById?: Map<number, number>;
  /** Referenz-„jetzt" für die Dringlichkeits-Abzeichen. */
  now?: Date;
};

/** Wie in den anderen Blättern: Animationen laufen im Web-Build nicht. */
const NATIVE = Platform.OS !== 'web';

/** Aus dieser Höhe steigt das Blatt auf – derselbe Weg wie im Detail-Blatt. */
const SHEET_RISE = 32;

/**
 * Eine Liste von Aktivitäten als Blatt von unten.
 *
 * ## Warum EIN Baustein für zwei Stellen
 *
 * Auf der Karte fasst ein Pin alle Termine eines Ortes zusammen, auf Home fasst
 * eine Karte alle Termine eines Veranstalters zusammen. Beides endet bei
 * derselben Frage: „welcher von diesen?" – also derselben Liste. Zwei getrennte
 * Blätter wären zwei Orte, an denen jemand später einen Abstand nachjustiert,
 * und dann fühlen sie sich unterschiedlich an (dieselbe Begründung wie bei
 * `use-sheet-drag.ts`).
 *
 * Was hier NICHT passiert: beitreten, teilen, melden. Das Blatt wählt nur aus
 * und gibt die Wahl nach oben; entschieden wird im Detail-Blatt. Sonst gäbe es
 * zwei Stellen, an denen man beitreten kann, mit zwei Fassungen der Logik.
 *
 * ## Warum das hier KEIN `Modal` ist
 *
 * Es war eines, und das war ein Fehler: Aus diesem Blatt heraus öffnet sich das
 * Detail – und das IST ein `Modal`. Zwei Modals gleichzeitig kann React Native
 * nicht zeigen. Am Gerät erschien das Detail deshalb gar nicht, und weil beide
 * Blätter ein Vollbild-Backdrop mitbringen, das Berührungen abfängt, reagierte
 * die App danach auf nichts mehr. Im Browser lagen zwei `position: fixed`-Ebenen
 * mit identischem `z-index: 9999` übereinander.
 *
 * Als Overlay IM Bildschirm gibt es das Problem nicht: Das Detail-Modal legt
 * sich darüber, weil ein Modal immer über allem liegt – und wer es schließt,
 * steht wieder in dieser Liste. Dieselbe Entscheidung, aus demselben Grund, wie
 * in `account-widget.tsx`.
 *
 * Was ohne `Modal` selbst erledigt werden muss: die Zurück-Taste auf Android
 * (siehe unten) und der Abstand zur nativen Tab-Leiste, die ein Overlay – anders
 * als ein Modal – nicht überdeckt.
 */
export function ActivityListSheet<T extends Activity>({
  title,
  subtitle,
  icon,
  activities,
  onSelect,
  onClose,
  distanceById,
  now,
}: Props<T>) {
  const surface = useBrandSurface();
  const insets = useSafeAreaInsets();

  // Eigener Sichtbar-Zustand, damit das Blatt beim Schließen noch ausfahren
  // kann: `title === null` allein würde es sofort aus dem Baum nehmen.
  const [visible, setVisible] = useState(Boolean(title));
  const appear = useRef(new Animated.Value(0)).current;
  const drag = useSheetDrag({ onDismiss: onClose, open: Boolean(title) });

  /**
   * Die Liste noch einmal unterteilt.
   *
   * Ohne das war es eine flache Reihe von bis zu 143 Zeilen – man scrollt und
   * scrollt, ohne zu wissen, wo man ist. Wonach unterteilt wird, entscheidet der
   * Inhalt: nach Kategorie, wenn mehrere darin vorkommen (der Fall vom
   * Karten-Pin), sonst nach Monat (der Fall aus einem Kategorie-Regal).
   * Ausführlich in `src/domain/list-sections.ts`.
   */
  const { axis, sections } = useMemo(() => listSections(activities), [activities]);

  useEffect(() => {
    if (title) {
      setVisible(true);
      drag.reset();
      Animated.timing(appear, { toValue: 1, duration: 220, useNativeDriver: NATIVE }).start();
      return;
    }
    Animated.timing(appear, { toValue: 0, duration: 160, useNativeDriver: NATIVE }).start(
      ({ finished }) => {
        if (finished) setVisible(false);
      },
    );
  }, [title, appear, drag]);

  /**
   * Die Zurück-Taste auf Android schließt das Blatt.
   *
   * Ein `Modal` erledigte das über `onRequestClose`. Ohne Modal würde Zurück den
   * ganzen Bildschirm verlassen, während vorne noch ein Blatt offen steht – und
   * das fühlt sich an, als hätte die Taste zu viel getan.
   */
  useEffect(() => {
    if (!title) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true; // erledigt – nicht auch noch navigieren
    });
    return () => subscription.remove();
  }, [title, onClose]);

  if (!visible) return null;

  const riseShift = appear.interpolate({ inputRange: [0, 1], outputRange: [SHEET_RISE, 0] });

  return (
    // `absoluteFill` + eigener zIndex statt eines Modals: liegt über dem
    // Bildschirm, aber unter dem Detail-Modal – siehe die Notiz oben.
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: appear }]} pointerEvents="none" />
        <Pressable style={styles.backdropTouch} onPress={onClose} accessibilityLabel="Schließen" />

        <Animated.View
          onLayout={drag.onSheetLayout}
          style={[
            styles.sheetWrap,
            { opacity: appear, transform: [{ translateY: Animated.add(riseShift, drag.dragY) }] },
          ]}>
          <GlassSurface
            tone="panel"
            radius={Radius.panel}
            // `BottomTabInset` zusätzlich: Ein Overlay liegt UNTER der nativen
            // Tab-Leiste, anders als ein Modal. Ohne diesen Abstand verschwindet
            // der letzte Eintrag der Liste hinter der Leiste.
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + BottomTabInset + Spacing.four },
            ]}>
            {/* Deckender Grund unter dem Glas: Auf Android bleibt von „Glas" eine
                Füllung mit ~85 % übrig, und darunter scheint ein Regal voller
                bunter Karten durch. Ausführlich steht das in
                `activity-detail-modal.tsx` bei SHEET_BLUR. */}
            <View
              style={[StyleSheet.absoluteFill, styles.opaque, { backgroundColor: surface.card }]}
              pointerEvents="none"
            />

            <View {...drag.headPan.panHandlers} style={styles.handleZone}>
              <View style={[styles.handle, { backgroundColor: surface.cardBorder }]} />
            </View>

            <View {...drag.headPan.panHandlers} style={styles.head}>
              <View style={styles.headRow}>
                {icon ? <Icon name={icon} size={19} color={surface.accent} /> : null}
                <ThemedText style={[styles.title, { color: surface.text }]} numberOfLines={2}>
                  {title}
                </ThemedText>
              </View>
              {subtitle ? (
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  {subtitle}
                </ThemedText>
              ) : null}
            </View>

            {/* Über der Liste nimmt die Capture-Fassung die Geste nur ab, wenn die
                Liste schon ganz oben steht – sonst ließe sich nicht mehr scrollen,
                ohne das Blatt zuzuziehen. */}
            <View {...drag.listPan.panHandlers} style={styles.listWrap}>
              <ScrollView
                contentContainerStyle={styles.scrollContent}
                onScroll={drag.onScroll}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}>
                {sections.map((section, index) => (
                  <View key={section.key} style={styles.section}>
                    {/* Bei nur einem Abschnitt bleibt die Überschrift weg – sie
                        würde bloß wiederholen, was oben im Kopf schon steht. */}
                    {sections.length > 1 ? (
                      <ListSectionHeader
                        title={section.title}
                        count={section.activities.length}
                        // Das Zeichen nur bei der Kategorie-Achse: Ein
                        // Kalender-Zeichen über jedem Monat wäre zwölfmal
                        // dieselbe Information. Die Kategorie kommt vom ersten
                        // Termin des Abschnitts – er IST die Kategorie.
                        interest={axis === 'interest' ? section.activities[0]?.interests?.[0] : null}
                        divider={index > 0}
                      />
                    ) : null}
                    {section.activities.map((activity) => (
                      <ActivityCard
                        key={activity.id}
                        activity={activity}
                        onPress={() => onSelect(activity)}
                        distanceKm={distanceById?.get(activity.id) ?? null}
                        // `row` und nicht `card`: Hier vergleicht man Termine
                        // desselben Hauses, und dabei zählen Datum und Uhrzeit.
                        // Zwanzig Banner mit demselben Bild wären genau die
                        // Wiederholung, die dieses Blatt auflösen soll.
                        layout="row"
                        now={now}
                      />
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          </GlassSurface>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Über dem Bildschirm, aber unter dem Detail-Modal.
   *
   * Der Wert muss über dem des ＋-Knopfes auf Home liegen, sonst schwebt der über
   * dem Blatt. Nach oben ist er ungefährlich: Ein `Modal` liegt in einer eigenen
   * Ebene und wird von keinem zIndex hier erreicht.
   */
  overlay: { zIndex: 100 },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  backdropTouch: { ...StyleSheet.absoluteFill },
  sheetWrap: { width: '100%' },
  sheet: {
    borderTopLeftRadius: Radius.panel,
    borderTopRightRadius: Radius.panel,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    maxHeight: '85%',
  },
  /** Liegt unter allem: Geschwister ohne eigenen `zIndex` stehen darüber. */
  opaque: { zIndex: 0 },
  handleZone: { paddingBottom: Spacing.three, alignItems: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2 },
  head: { gap: 2, paddingBottom: Spacing.three },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: {
    flexShrink: 1,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  listWrap: { flexShrink: 1 },
  scrollContent: { gap: Spacing.three, paddingBottom: Spacing.two },
  /**
   * Der Abstand innerhalb eines Abschnitts ist KLEINER als der zwischen ihnen
   * (`scrollContent` hat Spacing.three): Karten, die zusammengehören, stehen
   * dichter. Ohne diesen Unterschied trennt die Überschrift optisch nichts, weil
   * überall derselbe Abstand ist.
   *
   * Die Überschrift klebt beim Scrollen bewusst nicht oben fest. Sie könnte es
   * (`position: sticky` im Web), aber in einem Blatt, das sich wegwischen lässt,
   * wäre das eine zweite Ebene, die sich bewegt – zusammen mit dem Zug am Blatt
   * wirkt das kaputt.
   */
  section: { gap: Spacing.two },
});
