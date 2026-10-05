import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { PartnerLogo } from '@/components/partner-logo';
import { TopBar } from '@/components/top-bar';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatEuro } from '@/domain/club';
import { distanceKm, formatDistance } from '@/domain/distance';
import { partnerPlaces } from '@/domain/partner-places';
import { useTheme } from '@/hooks/use-theme';
import { useMarket } from '@/lib/market-context';
import { openRoute } from '@/lib/open-maps';

/**
 * Web-Variante: react-native-maps läuft nicht im Browser. Hier stehen die Partner
 * als Liste – nach Entfernung, mit Route. In der App ist es eine echte Karte.
 */
export default function PartnerMapWeb() {
  const colors = useTheme();
  const router = useRouter();
  const market = useMarket();

  const places = useMemo(() => {
    const list = partnerPlaces(market.offers);
    if (!market.coords) return list.map((p) => ({ ...p, km: null as number | null }));
    const here = { latitude: market.coords.lat, longitude: market.coords.lng };
    return list.map((p) => ({ ...p, km: distanceKm(here, { latitude: p.lat, longitude: p.lng }) as number | null })).sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
  }, [market.offers, market.coords]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <TopBar />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Mascot mood="thinking" gesture="look" size={56} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Partner in der Nähe</Text>
            <Text style={[styles.note, { color: colors.textSecondary }]}>Die Karte mit Pins gibt es in der App. Hier als Liste.</Text>
          </View>
        </View>
        {places.map((p) => (
          // Karte selbst nicht antippbar: Darin liegt der Routen-Knopf, und im Web
          // darf ein Knopf keinen Knopf enthalten.
          <Card key={p.partnerId}>
            <View style={styles.row}>
              <PressableScale
                onPress={() => router.push({ pathname: '/partner/[id]', params: { id: String(p.partnerId) } })}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                scaleTo={0.99}
                style={styles.open}>
                <PartnerLogo name={p.name} uri={p.logoUrl} size={48} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]}>{p.name}</Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>{[formatDistance(p.km), p.address ?? p.city].filter(Boolean).join(' · ')}</Text>
                  <Text style={[styles.meta, { color: colors.text }]}>
                    {p.offers.length} {p.offers.length === 1 ? 'Angebot' : 'Angebote'}
                    {p.fromCents !== null ? ` · ab ${formatEuro(p.fromCents)}` : ''}
                  </Text>
                </View>
              </PressableScale>
              <PressableScale onPress={() => openRoute({ lat: p.lat, lng: p.lng }, p.name)} accessibilityRole="button" accessibilityLabel={`Route zu ${p.name}`} hitSlop={8}>
                <Icon name="map" size={22} color={colors.tint} />
              </PressableScale>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { fontFamily: FontFamily.bold, fontSize: 22 },
  note: { fontFamily: FontFamily.medium, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  name: { fontFamily: FontFamily.bold, fontSize: 16 },
  meta: { fontFamily: FontFamily.medium, fontSize: 13 },
});
