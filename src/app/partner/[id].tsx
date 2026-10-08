import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MascotError } from '@/components/mascot';
import { OfferRow } from '@/components/offer-card';
import { PartnerLogo } from '@/components/partner-logo';
import { ReportSheet } from '@/components/report-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PullToCloseScroll } from '@/components/ui/pull-to-close';
import { FontFamily, MaxContentWidth, Night, Spacing } from '@/constants/theme';
import { formatDistance } from '@/domain/distance';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Offer, type Partner } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useMarket } from '@/lib/market-context';
import { openRoute } from '@/lib/open-maps';

/** Die Seite eines Partners: wer, wo, wann geöffnet – und alle Angebote. */
export default function PartnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const market = useMarket();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    api
      .partner(token, Number(id))
      .then(({ data }) => {
        setPartner(data);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'Diesen Partner konnten wir nicht laden.')));
  }, [token, id]);

  useFocusEffect(load);

  if (!partner) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Partner' }} />
        {error ? <MascotError detail={error} onRetry={load} /> : <ActivityIndicator color={colors.tint} />}
      </View>
    );
  }

  const offers: Offer[] = partner.offers ?? [];
  const firstOffer = offers[0];
  const distance = firstOffer ? formatDistance(market.distanceById.get(firstOffer.id)) : null;
  const activities = offers.filter((o) => o.kind === 'activity');
  const perks = offers.filter((o) => o.kind === 'perk');

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, headerTransparent: true, title: partner.name }} />
      <PullToCloseScroll knobTop={insets.top + 60} contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.five }}>
        <View style={styles.cover}>
          {partner.cover_url ? (
            <Image source={{ uri: partner.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <LinearGradient colors={[...Night.gradient]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={['transparent', 'rgba(12,4,24,0.7)']} style={[StyleSheet.absoluteFill, { top: '35%' }]} />
          <View style={styles.coverText}>
            <PartnerLogo name={partner.name} uri={partner.logo_url} size={64} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{partner.name}</Text>
              {partner.tagline ? <Text style={styles.tagline}>{partner.tagline}</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.column}>
          <Card style={styles.info}>
            {partner.address || partner.city ? (
              <Row icon="map-pin" text={[partner.address, partner.city].filter(Boolean).join(', ') + (distance ? ` · ${distance}` : '')} />
            ) : null}
            {partner.opening_hours ? <Row icon="clock" text={partner.opening_hours} /> : null}
            {partner.wheelchair_accessible === true ? <Row icon="user-check" text="Rollstuhlgerecht" /> : null}
            {partner.wheelchair_accessible === false ? <Row icon="user-check" text="Nicht rollstuhlgerecht" /> : null}
            {partner.kid_friendly ? <Row icon="balloon" text="Kinderfreundlich" /> : null}
            {partner.quiet_times ? <Row icon="moon" text={`Ruhige Zeiten: ${partner.quiet_times}`} /> : null}
            {partner.phone ? <Row icon="phone" text={partner.phone} onPress={() => Linking.openURL(`tel:${partner.phone}`)} /> : null}
            {partner.website ? <Row icon="link" text={partner.website.replace(/^https?:\/\//, '')} onPress={() => Linking.openURL(partner.website!)} /> : null}
            {partner.instagram ? (
              <Row icon="camera" text={`@${partner.instagram}`} onPress={() => Linking.openURL(`https://instagram.com/${partner.instagram}`)} />
            ) : null}
            {partner.lat !== null && partner.lng !== null ? (
              <Button title="Route planen" icon="map" variant="secondary" size="small" onPress={() => openRoute({ lat: partner.lat!, lng: partner.lng! }, partner.name)} />
            ) : null}
          </Card>

          {partner.description ? <Text style={[styles.description, { color: colors.text }]}>{partner.description}</Text> : null}

          <Card tone="soft">
            <View style={styles.stampHint}>
              <Icon name="stamp" size={22} color={colors.tint} />
              <Text style={[styles.stampText, { color: colors.text }]}>
                Jeder Besuch hier bringt einen Stempel auf deine GÖ4Fun-Stempelkarte – dieselbe Karte bei allen Partnern. Handy an den Aufkleber an der Kasse halten.
              </Text>
            </View>
          </Card>

          {activities.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.section, { color: colors.text }]} accessibilityRole="header">
                Angebote
              </Text>
              {activities.map((o) => (
                <OfferRow key={o.id} offer={o} distanceKm={market.distanceById.get(o.id)} />
              ))}
            </View>
          ) : null}

          {perks.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.section, { color: colors.text }]} accessibilityRole="header">
                Vorteile mit Credits
              </Text>
              {perks.map((o) => (
                <OfferRow key={o.id} offer={o} distanceKm={market.distanceById.get(o.id)} />
              ))}
            </View>
          ) : null}

          <Button title="Partner melden" variant="ghost" size="small" icon="flag" onPress={() => setReporting(true)} />
        </View>
      </PullToCloseScroll>
      <ReportSheet target={reporting ? { type: 'partner', id: partner.id, label: partner.name } : null} onClose={() => setReporting(false)} />
    </View>
  );
}

function Row({
  icon,
  text,
  onPress,
}: {
  icon: 'map-pin' | 'clock' | 'phone' | 'link' | 'camera' | 'user-check' | 'balloon' | 'moon';
  text: string;
  onPress?: () => void;
}) {
  const colors = useTheme();
  return (
    <View style={styles.row}>
      <Icon name={icon} size={18} color={colors.tint} />
      <Text
        style={[styles.rowText, { color: onPress ? colors.tint : colors.text }]}
        onPress={onPress}
        accessibilityRole={onPress ? 'link' : undefined}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  cover: { width: '100%', height: 260, justifyContent: 'flex-end', backgroundColor: Night.mid },
  coverText: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  name: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 26, letterSpacing: -0.4 },
  tagline: { color: 'rgba(255,255,255,0.85)', fontFamily: FontFamily.medium, fontSize: 14 },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.three, gap: Spacing.three },
  info: { gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  rowText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  description: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  stampHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stampText: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13.5, lineHeight: 19 },
  group: { gap: Spacing.two },
  section: { fontFamily: FontFamily.bold, fontSize: 19 },
});
