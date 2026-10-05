import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { MascotBuddy } from '@/components/mascot-buddy';
import { PartnerLogo } from '@/components/partner-logo';
import { StampCard } from '@/components/stamp-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatDay } from '@/domain/date-format';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useMarket } from '@/lib/market-context';

/**
 * Die Stempelkarte in groß – mit den Partnern, bei denen man schon war, und der
 * Erklärung, wie man stempelt.
 *
 * `?fresh=<index>` lässt das gerade verdiente Feld mit einem Aufdrücken landen
 * (kommt vom Check-in).
 */
export default function StampsScreen() {
  const { fresh } = useLocalSearchParams<{ fresh?: string }>();
  const router = useRouter();
  const colors = useTheme();
  const market = useMarket();
  const card = market.club?.stamps ?? null;

  useEffect(() => {
    void market.refreshClub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps: { icon: UiIconName; text: string }[] = [
    { icon: 'map-pin', text: 'Geh zu einem GÖ4Fun-Partner.' },
    { icon: 'nfc', text: 'Halte dein Handy an den Aufkleber an der Kasse – oder scanne den QR-Code darauf.' },
    { icon: 'qr', text: 'Klappt das nicht? Zeig deinen Pass, der Partner scannt ihn.' },
    { icon: 'gift', text: `Pro Partner und Tag gibt es einen Stempel. Zehn Stempel = ${card?.reward_credits ?? 100} Credits.` },
  ];

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Stempelkarte' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {card ? (
          <>
            <MascotBuddy
              tips={[
                card.remaining === 1
                  ? { line: 'Nur noch EIN Stempel – dann regnet es Credits!', mood: 'cheer' }
                  : { line: `Noch ${card.remaining} Stempel bis ${card.reward_credits} Credits.`, mood: 'happy' },
                { line: 'Schau, wie die glitzern! Jeder Stempel ist ein Besuch bei einem Partner.', mood: 'happy' },
                ...(card.completed_cards > 0 ? [{ line: `Du hast schon ${card.completed_cards}× eine volle Karte geschafft!`, mood: 'cheer' as const }] : []),
              ]}
            />
            <StampCard card={card} freshIndex={fresh !== undefined ? Number(fresh) : null} />
          </>
        ) : null}

        <View style={styles.buttons}>
          <Button title="Jetzt einchecken" icon="nfc" onPress={() => router.push('/checkin')} style={styles.button} />
          <Button title="Pass zeigen" icon="qr" variant="secondary" onPress={() => router.push({ pathname: '/checkin', params: { mode: 'pass' } })} style={styles.button} />
        </View>

        {card && card.stamps.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.text }]}>Auf dieser Karte</Text>
            <Card padded={false}>
              {card.stamps
                .slice()
                .reverse()
                .map((s, i) => (
                  <View key={s.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <PartnerLogo name={s.partner?.name ?? '?'} uri={s.partner?.logo_url} size={36} />
                    <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                      {s.partner?.name ?? 'Partner'}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{formatDay(s.day)}</Text>
                  </View>
                ))}
            </Card>
          </>
        ) : null}

        <Text style={[styles.section, { color: colors.text }]}>So geht&apos;s</Text>
        <Card style={styles.steps}>
          {steps.map((s, i) => (
            <View key={s.text} style={styles.step}>
              <View style={[styles.stepNo, { backgroundColor: colors.tint }]}>
                <Text style={styles.stepNoText}>{i + 1}</Text>
              </View>
              <Icon name={s.icon} size={20} color={colors.tint} />
              <Text style={[styles.stepText, { color: colors.text }]}>{s.text}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  button: { flex: 1 },
  section: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  rowTitle: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14.5 },
  rowMeta: { fontFamily: FontFamily.medium, fontSize: 13 },
  steps: { gap: Spacing.three },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepNo: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepNoText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12 },
  stepText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
});
