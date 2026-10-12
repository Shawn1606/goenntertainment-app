import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BookingTicket } from '@/components/booking-ticket';
import { MascotEmpty } from '@/components/mascot';
import { useDockScroll } from '@/components/mascot-dock';
import { useGarlandSpace } from '@/components/seasonal-decor';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Entrance } from '@/components/ui/entrance';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { expiryInfo } from '@/domain/booking-status';
import { expiryWords } from '@/domain/mascot-lines';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useNow } from '@/hooks/use-now';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Tickets – alle eigenen Buchungen, ein eigener Tab.
 *
 * Oben in einem Satz, was das hier ist und wie man einlöst; dann umschalten
 * zwischen „Offen" und „Vergangen". Offene Tickets sind nach Ablaufdatum
 * sortiert – was zuerst verfällt, steht oben, und ein Hinweis warnt, wenn
 * etwas in den nächsten Tagen abläuft.
 */
export default function BookingsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const market = useMarket();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'open' | 'past'>('open');
  const garland = useGarlandSpace();
  const dockScroll = useDockScroll();

  // Bei jedem Zurückkommen neu laden: Tab-Seiten bleiben geladen, und ein eingelöstes
  // oder storniertes Ticket soll hier sofort so aussehen.
  const { refreshBookings } = market;
  useFocusEffect(
    useCallback(() => {
      void refreshBookings();
    }, [refreshBookings]),
  );

  const now = useNow();
  const open = market.bookings
    .filter((b) => b.status === 'confirmed')
    .slice()
    .sort((a, b) => new Date(a.valid_until).getTime() - new Date(b.valid_until).getTime());
  const past = market.bookings.filter((b) => b.status !== 'confirmed');
  const urgent = open.filter((b) => expiryInfo(b.valid_until, now)?.tone === 'urgent');
  const shown = tab === 'open' ? open : past;

  const refresh = async () => {
    setRefreshing(true);
    await market.refreshBookings();
    setRefreshing(false);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <TopBar />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Spacing.three + garland }]}
        onScroll={dockScroll}
        scrollEventThrottle={32}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.tint} />}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            Deine Tickets
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Zeig beim Partner den Code – oder halt dein Handy an den GÖ4Fun-Aufkleber.
          </Text>
        </View>

        {/* Kurze Wörter: Alle drei Schritte passen auch auf schmalen Handys in eine Zeile. */}
        <View style={styles.how}>
          <HowChip icon="ticket" text="Buchen" />
          <Icon name="chevron-right" size={14} color={colors.textSecondary} />
          <HowChip icon="nfc" text="Vorzeigen" />
          <Icon name="chevron-right" size={14} color={colors.textSecondary} />
          <HowChip icon="stamp" text="Stempel holen" />
        </View>

        {urgent.length > 0 ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Icon name="hourglass" size={18} color="#e11d48" />
            <Text style={styles.alertText}>
              {urgent.length === 1
                ? `„${urgent[0].offer_title}" verfällt ${expiryWords(expiryInfo(urgent[0].valid_until, now)?.days ?? 0)} – jetzt einlösen!`
                : `${urgent.length} Tickets verfallen in den nächsten Tagen.`}
            </Text>
          </View>
        ) : null}

        <View style={[styles.segment, { backgroundColor: colors.backgroundSelected }]} accessibilityRole="tablist">
          <Segment label={`Offen${open.length ? ` (${open.length})` : ''}`} active={tab === 'open'} onPress={() => setTab('open')} />
          <Segment label={`Vergangen${past.length ? ` (${past.length})` : ''}`} active={tab === 'past'} onPress={() => setTab('past')} />
        </View>

        {shown.length === 0 ? (
          <Card>
            <MascotEmpty mood="thinking" gesture="wave">
              <Text style={[styles.emptyTitle, { color: colors.text }]}>{tab === 'open' ? 'Keine offenen Tickets' : 'Noch nichts Vergangenes'}</Text>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {tab === 'open' ? 'Unter „Entdecken“ findest du, was zu dir oder deiner Gruppe passt.' : 'Eingelöste und abgelaufene Tickets landen hier.'}
              </Text>
              {tab === 'open' ? <Button title="Jetzt entdecken" icon="compass" onPress={() => router.navigate('/finder')} /> : null}
            </MascotEmpty>
          </Card>
        ) : null}

        {shown.map((b, i) => (
          <Entrance key={`${tab}-${b.id}`} index={i}>
            <BookingTicket booking={b} />
          </Entrance>
        ))}
      </ScrollView>
    </View>
  );
}

function HowChip({ icon, text }: { icon: UiIconName; text: string }) {
  const colors = useTheme();
  return (
    <View style={[styles.howChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Icon name={icon} size={14} color={colors.tint} />
      <Text style={[styles.howText, { color: colors.text }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useTheme();
  return (
    <PressableScale
      onPress={() => {
        if (!active) feedback.selected();
        onPress();
      }}
      haptic="none"
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.segmentItem, active && { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.segmentText, { color: active ? colors.text : colors.textSecondary }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six + 40 },
  head: { gap: 4 },
  title: { fontFamily: FontFamily.bold, fontSize: 26, letterSpacing: -0.4 },
  subtitle: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  how: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  howChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  howText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.field,
    borderWidth: 1,
    borderColor: 'rgba(225,29,72,0.35)',
    backgroundColor: 'rgba(225,29,72,0.08)',
    padding: Spacing.three,
  },
  alertText: { flex: 1, color: '#e11d48', fontFamily: FontFamily.bold, fontSize: 13.5, lineHeight: 18 },
  segment: { flexDirection: 'row', borderRadius: 999, padding: 4, gap: 4 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: 'transparent' },
  segmentText: { fontFamily: FontFamily.bold, fontSize: 14 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 19 },
  emptyText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', marginBottom: Spacing.two },
});
