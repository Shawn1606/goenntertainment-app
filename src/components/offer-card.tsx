/**
 * Ein Angebot als Karte – groß (Leisten auf der Startseite) oder als Zeile
 * (Listen, Finder, Partnerseite).
 *
 * Der Preis zeigt immer, was DU zahlst: mit deinem Club-Rabatt, der alte Preis
 * durchgestrichen daneben. Ein Rabatt, den man erst an der Kasse sieht, ist für
 * die Entscheidung nichts wert.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { BrandGradient, FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, formatEuro, formatPercent, quoteMoney } from '@/domain/club';
import { formatDistance } from '@/domain/distance';
import { useTheme } from '@/hooks/use-theme';
import type { Interest, Offer } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';

/** Preis für eine Person mit der eigenen Stufe. */
export function soloPrice(offer: Offer, plan: string | null | undefined) {
  if (offer.price_cents === null) return null;
  return quoteMoney(CLUB_RULES, {
    plan,
    people: 1,
    unitPriceCents: offer.price_cents,
    maxDiscountPercent: offer.max_discount_percent,
  });
}

export function PriceTag({ offer, size = 'normal' }: { offer: Offer; size?: 'normal' | 'large' }) {
  const colors = useTheme();
  const { user } = useAuth();
  const quote = soloPrice(offer, user?.club_plan);
  const large = size === 'large';

  return (
    <View style={styles.priceRow}>
      {quote ? (
        <>
          <Text style={[styles.price, large && styles.priceLarge, { color: colors.text }]}>{formatEuro(quote.totalCents)}</Text>
          {quote.discountCents > 0 ? (
            <Text style={[styles.strike, { color: colors.textSecondary }]}>{formatEuro(quote.subtotalCents)}</Text>
          ) : null}
        </>
      ) : null}
      {offer.price_credits !== null ? (
        <View style={styles.creditChip}>
          <Icon name="coin" size={13} color="#9a6a00" />
          <Text style={styles.creditText}>{formatCredits(offer.price_credits)}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function OfferCard({
  offer,
  interest,
  distanceKm,
  width = 260,
  style,
}: {
  offer: Offer;
  interest?: Interest | null;
  distanceKm?: number | null;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const quote = soloPrice(offer, user?.club_plan);
  const distance = formatDistance(distanceKm);

  return (
    <View style={[{ width }, style]}>
      <PressableScale
        onPress={() => router.push({ pathname: '/offer/[id]', params: { id: String(offer.id) } })}
        scaleTo={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${offer.title} bei ${offer.partner?.name ?? 'Partner'}`}
        style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.imageWrap}>
          {offer.image_url ? (
            <Image source={{ uri: offer.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          ) : (
            <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <CategoryIcon interest={interest ?? null} size={44} color="rgba(255,255,255,0.9)" />
            </LinearGradient>
          )}
          {quote && quote.percent > 0 ? (
            <View style={styles.discount}>
              <Text style={styles.discountText}>−{formatPercent(quote.percent)}</Text>
            </View>
          ) : null}
          {offer.kind === 'perk' ? (
            <View style={[styles.kind, { backgroundColor: '#1c0833' }]}>
              <Icon name="gift" size={12} color="#fff1a8" />
              <Text style={styles.kindText}>Vorteil</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {offer.title}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {offer.partner?.name ?? 'Partner'}
            {distance ? ` · ${distance}` : offer.partner?.city ? ` · ${offer.partner.city}` : ''}
          </Text>
          <PriceTag offer={offer} />
        </View>
      </PressableScale>
    </View>
  );
}

/** Kompakte Zeile: Bild links, Text rechts. */
export function OfferRow({
  offer,
  interest,
  distanceKm,
  reasons,
  priceLine,
  onPress,
}: {
  offer: Offer;
  interest?: Interest | null;
  distanceKm?: number | null;
  /** Warum es passt (Gruppen-Finder) – die ersten zwei stehen unter dem Titel. */
  reasons?: string[];
  /** Eigene Preiszeile, z. B. „14,99 € p. P. · 59,96 € zusammen". */
  priceLine?: string | null;
  /** Statt der Detailseite ohne Vorgaben (der Finder gibt Personenzahl und Gruppe mit). */
  onPress?: () => void;
}) {
  const colors = useTheme();
  const router = useRouter();
  const distance = formatDistance(distanceKm);

  return (
    <PressableScale
      onPress={onPress ?? (() => router.push({ pathname: '/offer/[id]', params: { id: String(offer.id) } }))}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${offer.title} bei ${offer.partner?.name ?? 'Partner'}`}
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.thumb}>
        {offer.image_url ? (
          <Image source={{ uri: offer.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <CategoryIcon interest={interest ?? null} size={30} color="rgba(255,255,255,0.9)" />
          </LinearGradient>
        )}
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {offer.title}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {offer.partner?.name ?? 'Partner'}
          {distance ? ` · ${distance}` : ''}
        </Text>
        {reasons && reasons.length > 0 ? (
          <View style={styles.reasons}>
            {reasons.slice(0, 2).map((r) => (
              <View key={r} style={[styles.reason, { backgroundColor: colors.backgroundSelected }]}>
                <Icon name="check" size={11} color={colors.tint} />
                <Text style={[styles.reasonText, { color: colors.text }]} numberOfLines={1}>
                  {r}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {priceLine ? <Text style={[styles.priceLine, { color: colors.text }]}>{priceLine}</Text> : <PriceTag offer={offer} />}
      </View>
      <Icon name="chevron-right" size={18} color={colors.textSecondary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: Stroke, borderRadius: Radius.card, overflow: 'hidden' },
  imageWrap: { aspectRatio: 16 / 10, width: '100%', backgroundColor: '#3d1263' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  discount: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    backgroundColor: '#e8174a',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  discountText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12 },
  kind: { position: 'absolute', top: Spacing.two, right: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  kindText: { color: '#fff1a8', fontFamily: FontFamily.bold, fontSize: 11 },
  body: { padding: Spacing.three, gap: 2 },
  title: { fontFamily: FontFamily.bold, fontSize: 16 },
  meta: { fontFamily: FontFamily.medium, fontSize: 13 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one, flexWrap: 'wrap' },
  price: { fontFamily: FontFamily.bold, fontSize: 16 },
  priceLarge: { fontSize: 24 },
  strike: { fontFamily: FontFamily.medium, fontSize: 13, textDecorationLine: 'line-through' },
  creditChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fff3c4', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  creditText: { color: '#7a5300', fontFamily: FontFamily.bold, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: Stroke, borderRadius: Radius.card, padding: Spacing.two },
  thumb: { width: 76, height: 76, borderRadius: Radius.field, overflow: 'hidden', backgroundColor: '#3d1263' },
  rowBody: { flex: 1, gap: 2 },
  reasons: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, maxWidth: '100%' },
  reasonText: { fontFamily: FontFamily.semibold, fontSize: 11.5 },
  priceLine: { fontFamily: FontFamily.bold, fontSize: 14, marginTop: 2 },
});
