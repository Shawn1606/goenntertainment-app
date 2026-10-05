import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { posterGradient } from '@/components/feed/activity-poster';
import { HomeBackground } from '@/components/home-background';
import { Mascot } from '@/components/mascot';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Entrance } from '@/components/ui/entrance';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import { firstName } from '@/domain/greeting';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { type Activity, type Interest, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';

/**
 * Der ＋-Tab: der Einstieg ins Erstellen.
 *
 * ## Warum ein eigener Bildschirm und nicht gleich das Formular
 *
 * Das Formular ist eine Stack-Route (`/create-activity`) mit Zurück-Knopf – dort
 * bleibt es. Läge es direkt im Tab, gäbe es kein „Abbrechen": Ein Tab schließt
 * man nicht, man wechselt ihn, und ein halb ausgefülltes Formular stünde beim
 * nächsten Besuch noch da.
 *
 * ## Warum er jetzt so bunt ist
 *
 * Vorher stand hier ein Verlaufs-Knopf über einem grauen Kachelraster – eine
 * Seite, die nur zum Formular weiterleitet, und genau so sah sie aus. Dabei ist
 * das der Moment, in dem jemand überlegt, ob er selbst etwas startet. Den muss
 * man nicht verwalten, sondern ermutigen:
 *
 *  - **Goenni begrüßt und winkt** – die Figur ist sonst nur in Leerzuständen und
 *    Fehlern zu sehen; hier lädt sie ein.
 *  - **Schnell-Ideen** nehmen die schwerste Frage ab: „Was mache ich überhaupt?".
 *    Ein Tipp füllt Titel und Kategorie vor; alles ist danach änderbar.
 *  - **Kategorien in ihren eigenen Farben** – dieselben Verläufe wie auf den
 *    Plakaten im Feed, damit „Sport" hier und dort gleich aussieht.
 *  - **Deine nächsten Aktivitäten** unten – wer schon etwas gestartet hat, sieht,
 *    dass es läuft, und findet den Weg dorthin.
 */

type Idea = { slug: string; title: string; hint: string; icon: UiIconName };

/**
 * Ideen für den Anfang. Über den `slug` der Kategorie verknüpft (stabil, anders
 * als die ID); fehlt die Kategorie auf dem Server, bleibt nur der Titel stehen.
 */
const IDEAS: Idea[] = [
  { slug: 'essen-trinken', title: 'Feierabend-Drinks', hint: 'Nach der Arbeit auf ein Getränk', icon: 'sunset' },
  { slug: 'spieleabend', title: 'Spieleabend', hint: 'Brettspiele, Karten, Snacks', icon: 'party' },
  { slug: 'natur-wandern', title: 'Runde durch den Park', hint: 'Spazieren, quatschen, frische Luft', icon: 'sprout' },
  { slug: 'fitness', title: 'Zusammen trainieren', hint: 'Laufen, Gym oder Workout draußen', icon: 'bolt' },
  { slug: 'film-kino', title: 'Kinoabend', hint: 'Film aussuchen und gemeinsam hin', icon: 'star' },
  { slug: 'kochen', title: 'Zusammen kochen', hint: 'Jede:r bringt eine Zutat mit', icon: 'flame' },
];

const TIPS: { icon: UiIconName; title: string; body: string }[] = [
  { icon: 'camera', title: 'Ein echtes Foto', body: 'Mit Bild fällt deine Aktivität im Feed viel stärker auf.' },
  { icon: 'clock', title: 'Klare Uhrzeit', body: '„Samstag, 15 Uhr" sagt man leichter zu als „irgendwann".' },
  { icon: 'map-pin', title: 'Genauer Treffpunkt', body: 'Straße und Hausnummer – dann findet dich jede:r.' },
];

export default function CreateTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const { user, token } = useAuth();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [mine, setMine] = useState<Activity[]>([]);

  useEffect(() => {
    api
      .interests()
      .then((res) => setInterests(res.data))
      .catch(() => setInterests([]));
  }, []);

  // Die eigenen kommenden Aktivitäten – bei jedem Besuch neu, damit eine eben
  // erstellte sofort hier steht.
  useFocusEffect(
    useCallback(() => {
      if (!token || !user) return;
      let alive = true;
      api
        .activities(token, { mine: true })
        .then((res) => {
          if (!alive) return;
          const now = Date.now();
          setMine(
            res.data
              .filter((a) => a.host?.id === user.id && (a.is_permanent || Date.parse(a.starts_at ?? '') >= now))
              .sort((a, b) => Date.parse(a.starts_at ?? '') - Date.parse(b.starts_at ?? ''))
              .slice(0, 3),
          );
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [token, user]),
  );

  const bySlug = useMemo(() => new Map(interests.map((i) => [i.slug ?? '', i])), [interests]);

  const start = (preset?: { interest?: number; title?: string }) => {
    feedback.opened();
    const params: Record<string, string> = {};
    if (preset?.interest) params.interest = String(preset.interest);
    if (preset?.title) params.title = preset.title;
    router.push(Object.keys(params).length ? { pathname: '/create-activity', params } : '/create-activity');
  };

  const name = firstName(user?.name);

  return (
    <HomeBackground>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.three }]}
        showsVerticalScrollIndicator={false}>
        {/* Begrüßung mit Goenni */}
        <Entrance index={0}>
          <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.heroDecorA} pointerEvents="none" />
            <View style={styles.heroDecorB} pointerEvents="none" />
            <View style={styles.heroTop}>
              <Mascot mood="happy" size={92} color="#ffffff" faceColor={colors.tint} gesture="wave" label="Goenni winkt" />
              <View style={styles.bubble}>
                <Text style={[styles.bubbleText, { color: colors.tint }]}>
                  {name ? `Hey ${name}!` : 'Hey!'} Was steht an?
                </Text>
                <View style={styles.bubbleTail} />
              </View>
            </View>
            <Text style={styles.heroTitle}>Starte etwas – Leute aus deiner Gegend machen mit.</Text>
            <PressableScale
              onPress={() => start()}
              haptic="press"
              scaleTo={0.97}
              accessibilityRole="button"
              accessibilityLabel="Neue Aktivität erstellen"
              style={styles.heroButton}>
              <Icon name="plus" size={20} color={colors.tint} />
              <Text style={[styles.heroButtonText, { color: colors.tint }]}>Neue Aktivität</Text>
            </PressableScale>
            <Text style={styles.heroHint}>Foto, Ort, Uhrzeit – fertig in einer Minute</Text>
          </LinearGradient>
        </Entrance>

        {/* Schnell-Ideen */}
        <View style={styles.sectionHead}>
          <Text style={[styles.section, { color: colors.text }]}>Schnell-Ideen</Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>Antippen – der Rest ist schon halb ausgefüllt</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ideas} style={styles.bleed}>
          {IDEAS.map((idea, index) => {
            const interest = bySlug.get(idea.slug);
            const gradient = interest ? posterGradient({ id: interest.id, interests: [interest] }) : BrandGradient;
            return (
              <Entrance key={idea.slug} index={index + 1}>
                <PressableScale
                  onPress={() => start({ interest: interest?.id, title: idea.title })}
                  haptic="tap"
                  scaleTo={0.96}
                  accessibilityRole="button"
                  accessibilityLabel={`${idea.title} erstellen`}
                  style={styles.ideaWrap}>
                  <LinearGradient colors={[...gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.idea}>
                    <View style={styles.ideaIcon}>
                      {interest ? (
                        <CategoryIcon interest={interest} size={22} color="#ffffff" />
                      ) : (
                        <Icon name={idea.icon} size={22} color="#ffffff" />
                      )}
                    </View>
                    <Text style={styles.ideaTitle} numberOfLines={2}>
                      {idea.title}
                    </Text>
                    <Text style={styles.ideaHint} numberOfLines={2}>
                      {idea.hint}
                    </Text>
                  </LinearGradient>
                </PressableScale>
              </Entrance>
            );
          })}
        </ScrollView>

        {/* Kategorien */}
        {interests.length > 0 ? (
          <>
            <View style={styles.sectionHead}>
              <Text style={[styles.section, { color: colors.text }]}>Oder nach Kategorie</Text>
            </View>
            <View style={styles.grid}>
              {interests.slice(0, 12).map((interest) => {
                const gradient = posterGradient({ id: interest.id, interests: [interest] });
                // Die Hülle trägt die Breite im Raster: PressableScale legt `style`
                // auf die innere Fläche, der äußere Druckbereich wüchse sonst nicht mit.
                return (
                  <View key={interest.id} style={styles.tileSlot}>
                    <PressableScale
                      onPress={() => start({ interest: interest.id })}
                      haptic="tap"
                      scaleTo={0.95}
                      accessibilityRole="button"
                      accessibilityLabel={`${interest.name} erstellen`}
                      style={[styles.tile, { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected }]}>
                      <LinearGradient colors={[...gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tileIcon}>
                        <CategoryIcon interest={interest} size={22} color="#ffffff" />
                      </LinearGradient>
                      <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={2}>
                        {interest.name}
                      </Text>
                    </PressableScale>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Eigene kommende Aktivitäten */}
        {mine.length > 0 ? (
          <>
            <View style={styles.sectionHead}>
              <Text style={[styles.section, { color: colors.text }]}>Von dir geplant</Text>
            </View>
            <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
              {mine.map((activity, index) => (
                <PressableScale
                  key={activity.id}
                  onPress={() => router.navigate('/me')}
                  haptic="tap"
                  scaleTo={0.98}
                  accessibilityRole="button"
                  accessibilityLabel={`${activity.title}, im Profil ansehen`}
                  style={[styles.mineRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.backgroundSelected }]}>
                  <View style={[styles.mineDot, { backgroundColor: colors.tint }]} />
                  <View style={styles.flex}>
                    <Text style={[styles.mineTitle, { color: colors.text }]} numberOfLines={1}>
                      {activity.title}
                    </Text>
                    <Text style={[styles.mineSub, { color: colors.textSecondary }]} numberOfLines={1}>
                      {activity.participants_count === 1 ? '1 Person dabei' : `${activity.participants_count} Personen dabei`}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.textSecondary} />
                </PressableScale>
              ))}
            </View>
          </>
        ) : null}

        {/* Tipps */}
        <View style={styles.sectionHead}>
          <Text style={[styles.section, { color: colors.text }]}>So kommen Leute</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
          {TIPS.map((tip, index) => (
            <View
              key={tip.title}
              style={[styles.tip, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.backgroundSelected }]}>
              <View style={[styles.tipIcon, { backgroundColor: colors.background }]}>
                <Icon name={tip.icon} size={19} color={colors.tint} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.tipTitle, { color: colors.text }]}>{tip.title}</Text>
                <Text style={[styles.tipBody, { color: colors.textSecondary }]}>{tip.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    gap: Spacing.two,
  },
  hero: {
    borderRadius: 24,
    padding: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
    overflow: 'hidden',
  },
  /** Zwei weiche Kreise als Tiefe – ohne sie wirkt der Verlauf wie eine Fläche. */
  heroDecorA: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.10)',
    top: -80,
    right: -60,
  },
  heroDecorB: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.08)',
    bottom: -50,
    left: -30,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bubble: {
    flexShrink: 1,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  bubbleTail: {
    position: 'absolute',
    left: -6,
    top: '50%',
    marginTop: -6,
    width: 12,
    height: 12,
    backgroundColor: '#ffffff',
    transform: [{ rotate: '45deg' }],
  },
  bubbleText: { fontFamily: FontFamily.bold, fontSize: 16 },
  heroTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 22, lineHeight: 28 },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: '#ffffff',
    borderRadius: Radius.card + 2,
    minHeight: 50,
  },
  heroButtonText: { fontFamily: FontFamily.bold, fontSize: 16 },
  heroHint: { color: 'rgba(255,255,255,0.88)', fontFamily: FontFamily.medium, fontSize: 12, textAlign: 'center', marginTop: -Spacing.one },
  sectionHead: { marginTop: Spacing.four, marginBottom: Spacing.one, gap: 2 },
  section: { fontFamily: FontFamily.bold, fontSize: 18 },
  sectionSub: { fontFamily: FontFamily.regular, fontSize: 13 },
  /** Die Ideen-Leiste läuft bis an den Rand, wie jede Querleiste in der App. */
  bleed: { marginHorizontal: -Spacing.three },
  ideas: { paddingHorizontal: Spacing.three, gap: Spacing.two + 2 },
  ideaWrap: { borderRadius: Radius.panel + 2, overflow: 'hidden' },
  idea: { width: 158, height: 168, padding: Spacing.three, justifyContent: 'flex-end', gap: 4 },
  ideaIcon: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ideaTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 20 },
  ideaHint: { color: 'rgba(255,255,255,0.9)', fontFamily: FontFamily.medium, fontSize: 12, lineHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tileSlot: { width: '31.5%', flexGrow: 1 },
  tile: {
    minHeight: 116,
    borderRadius: Radius.card + 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  tileIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: FontFamily.semibold, fontSize: 12, textAlign: 'center' },
  card: { borderRadius: Radius.panel, paddingHorizontal: Spacing.three },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  mineDot: { width: 8, height: 8, borderRadius: 4 },
  mineTitle: { fontFamily: FontFamily.bold, fontSize: 15 },
  mineSub: { fontFamily: FontFamily.regular, fontSize: 13 },
  tip: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center', paddingVertical: Spacing.three },
  tipIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  tipTitle: { fontFamily: FontFamily.bold, fontSize: 15 },
  tipBody: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
});
