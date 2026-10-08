/**
 * Leistungsanzeige: wie viele Bilder pro Sekunde die App auf DIESEM Gerät
 * gerade schafft (Einstellungen › „Leistungsanzeige", nur für Admins).
 *
 *  - **UI** – der Takt der Oberfläche, gemessen auf dem UI-Thread
 *    (Reanimated `useFrameCallback`). Fällt er, ruckeln Animationen und Scrollen.
 *  - **JS** – der Takt des JavaScript-Threads (`requestAnimationFrame`). Fällt er,
 *    reagiert die App verzögert auf Tippen, Tab-Wechsel und Eingaben.
 *  - **Ruckler** – wie viele Bilder in der letzten Sekunde zu spät kamen
 *    (länger als 1,5 Bildzeiten).
 *
 * Grün ab 55, gelb ab 40, darunter rot. Ein Handy mit 90/120 Hz zeigt mehr als 60.
 *
 * Wichtig beim Lesen: In Expo Go läuft der Entwicklungs-Build (langsameres
 * JavaScript, Prüfungen). Für echte Zahlen Metro mit `--no-dev --minify` starten
 * oder einen Release-Build messen.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { FontFamily } from '@/constants/theme';
import { useAppSettings } from '@/lib/app-settings';

type Reading = { fps: number; slow: number };

/** Liegt über der ganzen App; misst nur, solange der Schalter an ist. */
export function PerfMeterOverlay() {
  const { settings } = useAppSettings();
  return settings.perfMeter ? <PerfMeter /> : null;
}

function tone(fps: number | null): string {
  if (fps === null) return '#9ca3af';
  if (fps >= 55) return '#22c55e';
  if (fps >= 40) return '#f59e0b';
  return '#ef4444';
}

export function PerfMeter() {
  const insets = useSafeAreaInsets();
  const [ui, setUi] = useState<Reading | null>(null);
  const [js, setJs] = useState<Reading | null>(null);

  // UI-Thread: jedes Bild zählen, einmal je Sekunde melden.
  const frames = useSharedValue(0);
  const slow = useSharedValue(0);
  const since = useSharedValue(0);
  useFrameCallback((info) => {
    if (since.value === 0) since.value = info.timestamp;
    frames.value += 1;
    if (info.timeSincePreviousFrame !== null && info.timeSincePreviousFrame > 25) slow.value += 1;
    const elapsed = info.timestamp - since.value;
    if (elapsed >= 1000) {
      const reading = { fps: Math.round((frames.value * 1000) / elapsed), slow: slow.value };
      frames.value = 0;
      slow.value = 0;
      since.value = info.timestamp;
      scheduleOnRN(setUi, reading);
    }
  });

  // JS-Thread: dasselbe mit requestAnimationFrame.
  useEffect(() => {
    let count = 0;
    let late = 0;
    let start = 0;
    let last = 0;
    let handle = 0;
    const tick = (t: number) => {
      if (start === 0) start = t;
      if (last !== 0 && t - last > 25) late += 1;
      last = t;
      count += 1;
      if (t - start >= 1000) {
        setJs({ fps: Math.round((count * 1000) / (t - start)), slow: late });
        count = 0;
        late = 0;
        start = t;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 4 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Row label="UI" reading={ui} />
      <Row label="JS" reading={js} />
    </View>
  );
}

function Row({ label, reading }: { label: string; reading: Reading | null }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: tone(reading?.fps ?? null) }]} />
      <Text style={styles.text}>
        {label} {reading ? reading.fps : '–'} fps
        {reading && reading.slow > 0 ? ` · ${reading.slow} Ruckler` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 8,
    zIndex: 1000,
    elevation: 20,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { color: '#ffffff', fontFamily: FontFamily.semibold, fontSize: 11, fontVariant: ['tabular-nums'] },
});
