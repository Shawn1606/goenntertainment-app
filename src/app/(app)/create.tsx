import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { type Interest, api } from '@/lib/api';
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
 * Hier also ein großer Knopf für „Neue Aktivität" und darunter Schnellstarts
 * nach Kategorie. Ein Schnellstart füllt die Kategorie im Formular schon aus –
 * die häufigste Frage beim leeren Formular ist „was trage ich wo ein?", und eine
 * gewählte Kategorie beantwortet schon die Hälfte.
 */
export default function CreateTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const [interests, setInterests] = useState<Interest[]>([]);

  useEffect(() => {
    api
      .interests()
      .then((res) => setInterests(res.data))
      .catch(() => setInterests([]));
  }, []);

  const start = (interestId?: number) => {
    feedback.opened();
    router.push(
      interestId
        ? { pathname: '/create-activity', params: { interest: String(interestId) } }
        : '/create-activity',
    );
  };

  return (
    <HomeBackground>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.three }]}
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.heading, { color: colors.text }]}>Erstellen</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          Was hast du vor? Leute aus deiner Gegend können direkt mitmachen.
        </Text>

        <Pressable
          onPress={() => start()}
          accessibilityRole="button"
          accessibilityLabel="Neue Aktivität erstellen"
          style={({ pressed }) => [styles.heroWrap, pressed && styles.pressed]}>
          <LinearGradient colors={BrandGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.heroIcon}>
              <Icon name="plus" size={30} color="#ffffff" />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>Neue Aktivität</Text>
              <Text style={styles.heroSub}>Foto, Ort, Uhrzeit – fertig in einer Minute</Text>
            </View>
            <Icon name="chevron-right" size={24} color="#ffffff" />
          </LinearGradient>
        </Pressable>

        {interests.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.text }]}>Schnellstart</Text>
            <View style={styles.grid}>
              {interests.slice(0, 12).map((interest) => (
                <Pressable
                  key={interest.id}
                  onPress={() => start(interest.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${interest.name} erstellen`}
                  style={({ pressed }) => [
                    styles.tile,
                    { backgroundColor: colors.backgroundElement },
                    pressed && styles.pressed,
                  ]}>
                  <CategoryIcon interest={interest} size={28} color={colors.tint} />
                  <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={2}>
                    {interest.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={[styles.section, { color: colors.text }]}>So kommen Leute</Text>
        {TIPS.map((tip) => (
          <View key={tip.title} style={styles.tip}>
            <View style={[styles.tipIcon, { backgroundColor: colors.backgroundElement }]}>
              <Icon name={tip.icon} size={20} color={colors.text} />
            </View>
            <View style={styles.tipText}>
              <Text style={[styles.tipTitle, { color: colors.text }]}>{tip.title}</Text>
              <Text style={[styles.tipBody, { color: colors.textSecondary }]}>{tip.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </HomeBackground>
  );
}

const TIPS: { icon: UiIconName; title: string; body: string }[] = [
  { icon: 'camera', title: 'Ein echtes Foto', body: 'Aktivitäten mit Bild fallen im Feed viel stärker auf.' },
  { icon: 'clock', title: 'Klare Uhrzeit', body: '„Samstag, 15 Uhr" ist leichter zuzusagen als „irgendwann am Wochenende".' },
  { icon: 'map-pin', title: 'Genauer Treffpunkt', body: 'Straße und Hausnummer – dann findet dich jede:r.' },
];

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    gap: Spacing.two,
  },
  heading: { fontFamily: FontFamily.bold, fontSize: 28 },
  sub: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, marginBottom: Spacing.two },
  heroWrap: { borderRadius: Radius.panel, overflow: 'hidden' },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: { flex: 1, gap: 2 },
  heroTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 20 },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontFamily: FontFamily.medium, fontSize: 13 },
  section: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: Spacing.four, marginBottom: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: {
    width: '31.5%',
    flexGrow: 1,
    aspectRatio: 1.15,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
  },
  tileLabel: { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: 'center' },
  tip: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start', paddingVertical: Spacing.two },
  tipIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, gap: 2 },
  tipTitle: { fontFamily: FontFamily.bold, fontSize: 15 },
  tipBody: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 19 },
  pressed: { opacity: 0.75 },
});
