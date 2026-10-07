/**
 * Ein Angebot als Karte – groß (Leisten auf der Startseite) oder als Zeile
 * (Listen, Entdecken, Partnerseite).
 *
 * ## Aufbau (nach NN/g, Baymard und Erlebnis-Marktplätzen wie Airbnb Experiences)
 *
 *  1. **Bild zuerst** – Foto oder, wenn es keins gibt, ein ruhiges Farbcover der
 *     Kategorie mit großem, dezentem Symbol (src/domain/offer-look.ts). Darauf
 *     oben links der Rabatt (kontrastreich), unten das Partner-Logo.
 *  2. **Titel** – höchstens zwei Zeilen, die Karte hat immer dieselbe Höhe.
 *  3. **Merkmale zum Entscheiden** – Dauer, Personen, Alter, drinnen/draußen,
 *     auf JEDER Karte gleich angeordnet (Baymard: fehlende Merkmale lassen
 *     passende Angebote durchfallen).
 *  4. **Preis** – „ab X € / Person": was DU zahlst (mit Club-Rabatt), der alte
 *     Preis durchgestrichen und „Du sparst …" daneben; Credits als Alternative.
 *     Free-Nutzer sehen klein, was es mit Gold kosten würde.
 *
 * Varianten: `credits` stellt den Credit-Preis nach vorn (Leiste „Mit Credits
 * einlösen"), `nearby` die Entfernung (Leiste „In deiner Nähe").
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { PartnerLogo } from '@/components/partner-logo';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, formatEuro, formatPercent, quoteMoney } from '@/domain/club';
import { formatDistance } from '@/domain/distance';
import { coverPalette, offerFacts } from '@/domain/offer-look';
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

/**
 * Das Bild eines Angebots: Foto (Angebot, sonst Titelbild des Partners) oder ein
 * Farbcover der Kategorie. `children` liegen obendrauf (Abzeichen).
 */
export function OfferCover({
  offer,
  interest,
  showPartner = true,
  iconSize = 120,
  children,
  style,
}: {
  offer: Offer;
  interest?: Interest | null;
  showPartner?: boolean;
  iconSize?: number;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const photo = offer.image_url ?? offer.partner?.cover_url ?? null;
  const palette = coverPalette(interest?.name ?? offer.partner?.name ?? offer.title);

  return (
    <View style={[styles.cover, style]}>
      {photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <>
          <LinearGradient colors={[...palette]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {/* Lichtkante oben links – gibt dem Farbfeld Tiefe. */}
          <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.7 }} style={StyleSheet.absoluteFill} />
          {/* Großes, dezentes Kategorie-Symbol, angeschnitten wie ein Wasserzeichen. */}
          <View pointerEvents="none" style={[styles.watermark, { width: iconSize, height: iconSize, right: -iconSize * 0.18, bottom: -iconSize * 0.22 }]}>
            <CategoryIcon interest={interest ?? null} size={iconSize} color="rgba(255,255,255,0.2)" />
          </View>
          <View pointerEvents="none" style={styles.coverIcon}>
            <CategoryIcon interest={interest ?? null} size={Math.max(22, iconSize * 0.28)} color="#ffffff" />
          </View>
        </>
      )}
      {/* Unten ein leichter Schleier, damit das Partner-Schild auf jedem Foto lesbar bleibt. */}
      {photo && showPartner ? (
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.38)']} start={{ x: 0, y: 0.45 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : null}
      {showPartner && offer.partner ? (
        <View style={styles.partnerChip}>
          <PartnerLogo name={offer.partner.name} uri={offer.partner.logo_url} size={22} />
          <Text style={styles.partnerChipText} numberOfLines={1}>
            {offer.partner.name.replace(/^Demo:\s*/, '')}
          </Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function PriceTag({ offer, size = 'normal', emphasis = 'money' }: { offer: Offer; size?: 'normal' | 'large'; emphasis?: 'money' | 'credits' }) {
  const colors = useTheme();
  const { user } = useAuth();
  const quote = soloPrice(offer, user?.club_plan);
  const large = size === 'large';
  // Für Free-Nutzer: was es mit Gold kosten würde – nur, wenn es wirklich günstiger ist.
  const gold = !user?.club_plan || user.club_plan === 'free' ? soloPrice(offer, 'gold') : null;
  const goldCheaper = quote && gold && gold.totalCents < quote.totalCents ? gold.totalCents : null;

  const credits =
    offer.price_credits !== null ? (
      <View style={[styles.creditChip, emphasis === 'credits' && styles.creditChipStrong]}>
        <Icon name="coin" size={emphasis === 'credits' ? 15 : 12} color="#9a6a00" />
        <Text style={[styles.creditText, emphasis === 'credits' && styles.creditTextStrong]}>
          {emphasis === 'credits' ? `${formatCredits(offer.price_credits)} Credits` : formatCredits(offer.price_credits)}
        </Text>
      </View>
    ) : null;

  // In der Credits-Leiste zählt nur der Credit-Preis – den Euro-Preis zeigt die Angebotsseite.
  if (emphasis === 'credits' && credits) return <View style={styles.priceBlock}>{credits}</View>;

  return (
    <View style={styles.priceBlock}>
      {quote ? (
        <View style={styles.priceRow}>
          <Text style={[styles.price, large && styles.priceLarge, { color: colors.text }]}>{formatEuro(quote.totalCents)}</Text>
          <Text style={[styles.per, { color: colors.textSecondary }]}>/ Person</Text>
          {quote.discountCents > 0 ? <Text style={[styles.strike, { color: colors.textSecondary }]}>{formatEuro(quote.subtotalCents)}</Text> : null}
          {emphasis === 'money' && credits ? <Text style={[styles.or, { color: colors.textSecondary }]}>oder</Text> : null}
          {emphasis === 'money' ? credits : null}
        </View>
      ) : emphasis === 'money' ? (
        credits
      ) : null}
      {quote && quote.discountCents > 0 ? (
        <Text style={styles.saving}>Du sparst {formatEuro(quote.discountCents)}</Text>
      ) : goldCheaper !== null ? (
        <Text style={[styles.goldHint, { color: colors.textSecondary }]}>
          Mit Gold nur <Text style={styles.goldStrong}>{formatEuro(goldCheaper)}</Text>
        </Text>
      ) : null}
    </View>
  );
}

/** Reicht das eigene Guthaben? Spart in der Credits-Leiste den Blick nach oben. */
function CreditReach({ need, have }: { need: number; have: number }) {
  const colors = useTheme();
  const enough = have >= need;
  const tone = enough ? '#059669' : colors.textSecondary;
  return (
    <View style={styles.fact}>
      <Icon name={enough ? 'check' : 'coin'} size={12} color={tone} />
      <Text style={[styles.factText, { color: tone }]} numberOfLines={1}>
        {enough ? 'Dein Guthaben reicht' : `Noch ${formatCredits(need - have)} Credits fehlen`}
      </Text>
    </View>
  );
}

/** Merkmale als eine ruhige Zeile mit kleinen Symbolen. */
function Facts({ offer, limit = 3 }: { offer: Offer; limit?: number }) {
  const colors = useTheme();
  const facts = offerFacts(offer).slice(0, limit);
  if (facts.length === 0) return null;
  return (
    <View style={styles.facts}>
      {facts.map((f) => (
        <View key={f.text} style={styles.fact}>
          <Icon name={f.icon} size={12} color={colors.textSecondary} />
          <Text style={[styles.factText, { color: colors.textSecondary }]} numberOfLines={1}>
            {f.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function OfferCard({
  offer,
  interest,
  distanceKm,
  width = 260,
  variant = 'default',
  style,
}: {
  offer: Offer;
  interest?: Interest | null;
  distanceKm?: number | null;
  width?: number | `${number}%`;
  /** `credits`: Credit-Preis vorn; `nearby`: Entfernung als Abzeichen auf dem Bild. */
  variant?: 'default' | 'credits' | 'nearby';
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const quote = soloPrice(offer, user?.club_plan);
  const distance = formatDistance(distanceKm);
  const place = distance ?? offer.partner?.city ?? null;
  // Vorteile haben meist keine Merkmale – dann erklärt der Untertitel, was man bekommt.
  const blurb = offer.subtitle && offerFacts(offer).length === 0 ? offer.subtitle : null;

  return (
    <View style={[{ width }, style]}>
      <PressableScale
        onPress={() => router.push({ pathname: '/offer/[id]', params: { id: String(offer.id) } })}
        scaleTo={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${offer.title} bei ${offer.partner?.name ?? 'Partner'}${quote ? `, ${formatEuro(quote.totalCents)} pro Person` : ''}`}
        style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <OfferCover offer={offer} interest={interest} style={styles.cardCover}>
          {quote && quote.percent > 0 ? (
            <View style={styles.discount}>
              <Text style={styles.discountText}>−{formatPercent(quote.percent)}</Text>
            </View>
          ) : null}
          {variant === 'nearby' && distance ? (
            <View style={[styles.badgeRight, { backgroundColor: 'rgba(255,255,255,0.94)' }]}>
              <Icon name="map-pin" size={11} color="#e8174a" />
              <Text style={styles.badgeRightText}>{distance}</Text>
            </View>
          ) : offer.kind === 'perk' ? (
            <View style={[styles.badgeRight, { backgroundColor: '#1c0833' }]}>
              <Icon name="gift" size={11} color="#fff1a8" />
              <Text style={[styles.badgeRightText, { color: '#fff1a8' }]}>Vorteil</Text>
            </View>
          ) : offer.is_featured ? (
            <View style={[styles.badgeRight, { backgroundColor: 'rgba(255,255,255,0.94)' }]}>
              <Icon name="star-filled" size={11} color="#e3a60b" />
              <Text style={styles.badgeRightText}>Top</Text>
            </View>
          ) : null}
        </OfferCover>
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {offer.title}
          </Text>
          <Facts offer={offer} />
          {blurb ? (
            <Text style={[styles.blurb, { color: colors.textSecondary }]} numberOfLines={2}>
              {blurb}
            </Text>
          ) : null}
          {place && variant !== 'nearby' ? (
            <View style={styles.fact}>
              <Icon name="map-pin" size={12} color={colors.textSecondary} />
              <Text style={[styles.factText, { color: colors.textSecondary }]} numberOfLines={1}>
                {place}
              </Text>
            </View>
          ) : null}
          <View style={styles.spacer} />
          <PriceTag offer={offer} emphasis={variant === 'credits' ? 'credits' : 'money'} />
          {variant === 'credits' && offer.price_credits !== null && user ? <CreditReach need={offer.price_credits} have={user.credits_balance} /> : null}
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
  /** Warum es passt (Entdecken) – die ersten zwei stehen unter dem Titel. */
  reasons?: string[];
  /** Eigene Preiszeile, z. B. „14,99 € p. P. · 59,96 € zusammen". */
  priceLine?: string | null;
  /** Statt der Detailseite ohne Vorgaben (Entdecken gibt Personenzahl und Gruppe mit). */
  onPress?: () => void;
}) {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const quote = soloPrice(offer, user?.club_plan);
  const distance = formatDistance(distanceKm);

  return (
    <PressableScale
      onPress={onPress ?? (() => router.push({ pathname: '/offer/[id]', params: { id: String(offer.id) } }))}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${offer.title} bei ${offer.partner?.name ?? 'Partner'}`}
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <OfferCover offer={offer} interest={interest} showPartner={false} iconSize={72} style={styles.thumb}>
        {quote && quote.percent > 0 ? (
          <View style={[styles.discount, styles.discountSmall]}>
            <Text style={[styles.discountText, styles.discountTextSmall]}>−{formatPercent(quote.percent)}</Text>
          </View>
        ) : null}
      </OfferCover>
      <View style={styles.rowBody}>
        <Text style={[styles.title, styles.rowTitle, { color: colors.text }]} numberOfLines={2}>
          {offer.title}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {(offer.partner?.name ?? 'Partner').replace(/^Demo:\s*/, '')}
          {distance ? ` · ${distance}` : ''}
        </Text>
        <Facts offer={offer} limit={2} />
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
  cover: { overflow: 'hidden', backgroundColor: '#3d1263' },
  watermark: { position: 'absolute', transform: [{ rotate: '-12deg' }] },
  coverIcon: { position: 'absolute', top: '32%', left: 0, right: 0, alignItems: 'center' },
  partnerChip: {
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 999,
    paddingLeft: 3,
    paddingRight: 10,
    paddingVertical: 3,
    maxWidth: '86%',
  },
  partnerChipText: { flexShrink: 1, color: '#1c0833', fontFamily: FontFamily.bold, fontSize: 12 },
  card: { borderWidth: Stroke, borderRadius: Radius.card, overflow: 'hidden', flex: 1 },
  cardCover: { aspectRatio: 16 / 10, width: '100%' },
  discount: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    backgroundColor: '#e8174a',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  discountSmall: { top: 5, left: 5, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6 },
  discountText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12.5 },
  discountTextSmall: { fontSize: 10.5 },
  badgeRight: { position: 'absolute', top: Spacing.two, right: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRightText: { color: '#1c0833', fontFamily: FontFamily.bold, fontSize: 11.5 },
  body: { flex: 1, padding: Spacing.three, gap: 5, minHeight: 150 },
  title: { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21, minHeight: 42 },
  rowTitle: { minHeight: 0, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  blurb: { fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 17 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  factText: { fontFamily: FontFamily.medium, fontSize: 12 },
  spacer: { flex: 1 },
  priceBlock: { gap: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' },
  price: { fontFamily: FontFamily.bold, fontSize: 18 },
  priceLarge: { fontSize: 26 },
  per: { fontFamily: FontFamily.medium, fontSize: 12 },
  strike: { fontFamily: FontFamily.medium, fontSize: 12.5, textDecorationLine: 'line-through' },
  or: { fontFamily: FontFamily.medium, fontSize: 12 },
  saving: { color: '#059669', fontFamily: FontFamily.bold, fontSize: 12 },
  goldHint: { fontFamily: FontFamily.medium, fontSize: 12 },
  goldStrong: { color: '#b27b00', fontFamily: FontFamily.bold },
  creditChip: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: '#fff3c4', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  creditChipStrong: { paddingHorizontal: 10, paddingVertical: 4 },
  creditText: { color: '#7a5300', fontFamily: FontFamily.bold, fontSize: 12 },
  creditTextStrong: { fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: Stroke, borderRadius: Radius.card, padding: Spacing.two },
  thumb: { width: 84, height: 84, borderRadius: Radius.field },
  rowBody: { flex: 1, gap: 3 },
  reasons: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, maxWidth: '100%' },
  reasonText: { fontFamily: FontFamily.semibold, fontSize: 11.5 },
  priceLine: { fontFamily: FontFamily.bold, fontSize: 14, marginTop: 2 },
});
