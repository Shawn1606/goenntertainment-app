import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MascotBuddy } from '@/components/mascot-buddy';
import { PartnerLogo } from '@/components/partner-logo';
import { StampCard } from '@/components/stamp-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PullToCloseScroll } from '@/components/ui/pull-to-close';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatDay } from '@/domain/date-format';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useMarket } from '@/lib/market-context';

/**
 * Die Stempelkarte in groß – EINE Karte für alle Partner –, darunter der
 * Verlauf (wo die Stempel herkommen) und wie man stempelt.
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

  // `refreshClub` bleibt stabil, solange man angemeldet ist: einmal beim Öffnen.
  const { refreshClub } = market;
  useEffect(() => {
    void refreshClub();
  }, [refreshClub]);

  const steps: { icon: UiIconName; text: string }[] = [
    { icon: 'map-pin', text: 'Geh zu irgendeinem GÖ4Fun-Partner – die Karte gilt bei allen.' },
    { icon: 'nfc', text: 'Halte dein Handy an den Aufkleber an der Kasse – oder scanne den QR-Code darauf.' },
    { icon: 'qr', text: 'Klappt das nicht? Zeig deinen Pass, der Partner scannt ihn.' },
    { icon: 'gift', text: `Bei jedem Partner gibt es einen Stempel am Tag – bei drei Partnern also drei. Zehn Stempel = ${card?.reward_credits ?? 100} Credits.` },
  ];

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Stempelkarte' }} />
      <PullToCloseScroll contentContainerStyle={styles.content}>
        {card ? (
          <>
            <MascotBuddy
              tips={[
                card.remaining === 1
                  ? { line: 'Nur noch EIN Stempel – dann regnet es Credits!', mood: 'cheer' }
                  : { line: `Noch ${card.remaining} Stempel bis ${card.reward_credits} Credits.`, mood: 'happy' },
                { line: 'Schau, wie die glitzern! Eine Karte für alle Partner – jeder Besuch zählt.', mood: 'happy' },
                { line: 'Siehst du die Sterne in der Mitte? Die drehen sich vor Freude.', mood: 'cheer' },
                { line: 'Pro Partner gibt’s einen Stempel am Tag – drei Partner, drei Stempel!', mood: 'idle' },
                { line: 'Halt mich gedrückt, dann tanz ich für deine Stempel.', mood: 'happy' },
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
            <Text style={[styles.section, { color: colors.text }]}>Verlauf dieser Karte</Text>
            <Card padded={false}>
              {card.stamps
                .slice()
                .reverse()
                .map((s, i) => (
                  <View key={s.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    {s.partner ? (
                      <PartnerLogo name={s.partner.name} uri={s.partner.logo_url} size={36} />
                    ) : (
                      <View style={[styles.giftIcon, { backgroundColor: colors.backgroundSelected }]}>
                        <Icon name="gift" size={18} color={colors.tint} />
                      </View>
                    )}
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
                        {s.partner?.name ?? 'Geschenk vom GÖ4Fun-Team'}
                      </Text>
                      {/* Neuester zuerst – die Nummer sagt, welches Feld der Karte es war. */}
                      <Text style={[styles.rowSub, { color: colors.textSecondary }]}>Stempel {card.stamps.length - i}</Text>
                    </View>
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
      </PullToCloseScroll>
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
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontFamily: FontFamily.semibold, fontSize: 14.5 },
  rowSub: { fontFamily: FontFamily.medium, fontSize: 12 },
  giftIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowMeta: { fontFamily: FontFamily.medium, fontSize: 13 },
  steps: { gap: Spacing.three },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepNo: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepNoText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12 },
  stepText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
});
