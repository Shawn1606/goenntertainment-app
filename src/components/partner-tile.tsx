/**
 * Ein Partner als Kachel (Startseite › „Unsere Partner").
 *
 * Oben ein Titelbild (Foto des Partners oder das Farbcover seiner Kategorie,
 * src/domain/offer-look.ts), das Logo ragt darüber hinaus – so wirkt jeder
 * Partner wie eine eigene Marke statt wie ein Listeneintrag. Darunter Name,
 * wie viele Angebote es gibt und ab welchem Preis, und ein „Ansehen ›".
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PartnerLogo } from '@/components/partner-logo';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatEuro } from '@/domain/club';
import { formatDistance } from '@/domain/distance';
import { coverPalette } from '@/domain/offer-look';
import { useTheme } from '@/hooks/use-theme';
import type { OfferPartner } from '@/lib/api';

const LOGO = 46;

export function PartnerTile({
  partner,
  category,
  offers,
  fromCents,
  distanceKm,
  width = 156,
}: {
  partner: OfferPartner;
  /** Name der Kategorie – bestimmt die Farbe, wenn es kein Foto gibt. */
  category?: string | null;
  offers: number;
  fromCents: number | null;
  distanceKm?: number | null;
  width?: number;
}) {
  const colors = useTheme();
  const router = useRouter();
  const palette = coverPalette(category ?? partner.name);
  const name = partner.name.replace(/^Demo:\s*/, '');
  const distance = formatDistance(distanceKm);

  return (
    <View style={{ width }}>
      <PressableScale
        onPress={() => router.push({ pathname: '/partner/[id]', params: { id: String(partner.id) } })}
        scaleTo={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${partner.name}, ${offers} ${offers === 1 ? 'Angebot' : 'Angebote'}. Ansehen.`}
        style={[styles.tile, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.cover}>
          {partner.cover_url ? (
            <Image source={{ uri: partner.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <>
              <LinearGradient colors={[...palette]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <LinearGradient colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 0.8 }} style={StyleSheet.absoluteFill} />
            </>
          )}
          {distance ? (
            <View style={styles.distance}>
              <Icon name="map-pin" size={10} color="#e8174a" />
              <Text style={styles.distanceText}>{distance}</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.logo, { borderColor: colors.background, backgroundColor: colors.background }]}>
          <PartnerLogo name={partner.name} uri={partner.logo_url} size={LOGO} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
            {name}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {offers} {offers === 1 ? 'Angebot' : 'Angebote'}
          </Text>
          {fromCents !== null ? (
            <Text style={[styles.from, { color: colors.text }]} numberOfLines={1}>
              ab {formatEuro(fromCents)}
            </Text>
          ) : null}
          <View style={styles.more}>
            <Text style={[styles.moreText, { color: colors.tint }]}>Ansehen</Text>
            <Icon name="chevron-right" size={13} color={colors.tint} />
          </View>
        </View>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  // flex: 1 – alle Kacheln einer Reihe gleich hoch, „Ansehen" immer auf einer Linie.
  tile: { flex: 1, borderWidth: Stroke, borderRadius: Radius.card, overflow: 'hidden' },
  cover: { height: 64, overflow: 'hidden', backgroundColor: '#3d1263' },
  distance: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  distanceText: { color: '#1c0833', fontFamily: FontFamily.bold, fontSize: 10.5 },
  logo: { position: 'absolute', top: 64 - LOGO / 2 - 3, left: Spacing.three - 3, borderWidth: 3, borderRadius: 999 },
  body: { flex: 1, paddingHorizontal: Spacing.three, paddingTop: LOGO / 2 + 6, paddingBottom: Spacing.three, gap: 2 },
  name: { fontFamily: FontFamily.bold, fontSize: 14, lineHeight: 18, minHeight: 36 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12 },
  from: { fontFamily: FontFamily.bold, fontSize: 13.5 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 1, marginTop: 'auto', paddingTop: Spacing.one },
  moreText: { fontFamily: FontFamily.bold, fontSize: 12.5 },
});
