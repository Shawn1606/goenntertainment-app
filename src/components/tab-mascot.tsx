/**
 * Goenni in der Kopfzeile eines Tabs.
 *
 * Ein Baustein und nicht fünf Mal derselbe Code in den Screens: Die Figur soll auf
 * jedem Tab **gleich groß, gleich platziert und unterschiedlich gestimmt** sein.
 * Größe und Platz gehören deshalb hierher, Stimmung und Geste kommen aus
 * `src/domain/mascot-mood.ts` – dort sind sie an einer Stelle nachlesbar und
 * getestet.
 *
 * ## Der Gesichtswechsel
 *
 * Jeder Tab hat mehr als ein Gesicht (`moods`), und dieser Baustein schaltet alle
 * {@link FACE_MS} zwischen ihnen um. Der Zähler läuft hier und nicht in `Mascot`:
 * Die Figur soll ein reiner Darsteller bleiben – sie zeichnet, was man ihr sagt.
 * Wer *wann* welches Gesicht bekommt, ist eine Frage des Auftritts, und der gehört
 * zum Tab.
 *
 * Der Wechsel ist langsam (alle 6 Sekunden) und bleibt innerhalb des Charakters des
 * Tabs. Schneller wäre er eine Animation, die vom Text daneben ablenkt – und genau
 * das soll die Figur nicht.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Mascot } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { moodAt, reactionFor, type TabKey } from '@/domain/mascot-mood';
import { useBrandSurface } from '@/hooks/use-theme';

/** Wie lange ein Gesicht steht, bevor das nächste kommt. */
const FACE_MS = 6000;

export type TabMascotProps = {
  tab: TabKey;
  /**
   * Überschreibt den Satz aus der Tabelle – für Fälle, in denen der Screen mehr
   * weiß als der Tab (z. B. „Noch keine Freunde" statt „Zusammen ist es
   * schöner!"). Stimmung und Geste bleiben die des Tabs, damit die Figur pro Tab
   * wiedererkennbar bleibt.
   */
  line?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function TabMascot({ tab, line, size = 44, style }: TabMascotProps) {
  const surface = useBrandSurface();
  const reduced = useReducedMotion();
  const reaction = reactionFor(tab);

  const [step, setStep] = useState(0);

  /**
   * Bei „Bewegung reduzieren" wird gar nicht gewechselt: Ein Gesicht, das ohne
   * Zutun umspringt, IST Bewegung – auch wenn nichts dabei animiert ist.
   *
   * Der Zähler beginnt beim Tabwechsel wieder bei 0, weil `tab` in der
   * Abhängigkeitsliste steht. Genau richtig: Jeder Tab soll mit seinem
   * Hauptgesicht anfangen und nicht mit dem, bei dem der letzte stehen geblieben
   * ist.
   */
  useEffect(() => {
    setStep(0);
    if (reduced || reaction.moods.length < 2) return;
    const timer = setInterval(() => setStep((prev) => prev + 1), FACE_MS);
    return () => clearInterval(timer);
  }, [tab, reduced, reaction.moods.length]);

  return (
    <View style={[styles.row, style]}>
      <Mascot
        mood={moodAt(tab, step)}
        gesture={reaction.gesture}
        size={size}
        color={surface.accent}
      />
      <ThemedText type="small" style={[styles.line, { color: surface.textMuted }]} numberOfLines={2}>
        {line ?? reaction.line}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  line: { flex: 1 },
});
