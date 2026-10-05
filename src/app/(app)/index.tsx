import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MascotEmpty, MascotError } from '@/components/mascot';
import { MascotBuddy } from '@/components/mascot-buddy';
import { OfferCard } from '@/components/offer-card';
import { PartnerLogo } from '@/components/partner-logo';
import { PlanBadge } from '@/components/plan-badge';
import { StampCard } from '@/components/stamp-card';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Rail } from '@/components/ui/rail';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatPercent, planFor, stampProgress } from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { homeSections } from '@/domain/home-sections';
import { homeTips } from '@/domain/mascot-tips';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Home – alles Wichtige auf einen Blick.
 *
 *   Kopf:       Logo · Credits · du
 *   Club:       Goenni mit dem passenden Tipp, deine Stufe, dein Rabatt
 *   Schnell:    Einchecken · Pass · Gruppen · Buchungen
 *   Offen:      die nächste Buchung als Ticket
 *   Stempel:    die Karte in klein
 *   Angebote:   nach Kategorie, Top, in der Nähe, mit Credits
 *   Partner:    wer mitmacht
 *
 * Die Reihenfolge ist die Frage, die man beim Öffnen hat: Was habe ich (Club,
 * Credits, Stempel)? Was steht an (Buchung)? Was kann ich machen (Angebote)?
 */
export default function HomeScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { user } = useAuth();
  const market = useMarket();
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<number | null>(null);

  const plan = planFor(CLUB_RULES, user?.club_plan);
  const stamps = market.club?.stamps ?? null;
  const progress = stampProgress(CLUB_RULES, stamps?.total ?? 0);
  const openBookings = market.bookings.filter((b) => b.status === 'confirmed');
  const nextBooking = openBookings[0] ?? null;
  const unread = market.groups.reduce((sum, g) => sum + g.unread, 0);

  // Kein useMemo: Der React Compiler (app.json → reactCompiler) merkt sich das selbst.
  const tips = homeTips({
    firstName: user?.name?.split(' ')[0] ?? null,
    hour: new Date().getHours(),
    stampsFilled: progress.filled,
    stampsRemaining: progress.remaining,
    rewardCredits: CLUB_RULES.stampCard.rewardCredits,
    credits: user?.credits_balance ?? 0,
    plan: plan.key,
    openBookings: openBookings.length,
    groups: market.groups.length,
  });

  const interestById = new Map(market.interests.map((i) => [i.id, i]));
  const { categoryIds, featured, nearby, withCredits, partners } = homeSections(market.offers, {
    category,
    distanceById: market.distanceById,
  });
  /** Nur Kategorien, in denen es wirklich Angebote gibt – leere Chips wären Sackgassen. */
  const categories = market.interests.filter((i) => categoryIds.has(i.id));

  const onRefresh = async () => {
    setRefreshing(true);
    await market.refresh();
    setRefreshing(false);
  };

  const quick: { key: string; label: string; icon: UiIconName; badge?: number; onPress: () => void }[] = [
    { key: 'checkin', label: 'Einchecken', icon: 'nfc', onPress: () => router.push('/checkin') },
    { key: 'pass', label: 'Mein Pass', icon: 'qr', onPress: () => router.push({ pathname: '/checkin', params: { mode: 'pass' } }) },
    { key: 'groups', label: 'Gruppen', icon: 'users', badge: unread, onPress: () => router.push('/groups') },
    { key: 'bookings', label: 'Buchungen', icon: 'ticket', badge: openBookings.length, onPress: () => router.push('/bookings') },
  ];

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <TopBar />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />}
        showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          {/* Club-Kopf: Goenni, Stufe, Rabatt. */}
          <Card tone="night" style={styles.hero}>
            <MascotBuddy tips={tips} tone="night" size={70} />
            <View style={styles.heroFoot}>
              <View style={{ flex: 1, gap: 4 }}>
                <PlanBadge plan={plan.key} tone="night" />
                <Text style={styles.heroLine} numberOfLines={2}>
                  {plan.discountPercent > 0
                    ? `Du sparst ${formatPercent(plan.discountPercent)} bei jedem Partner – in der Gruppe noch mehr.`
                    : 'Mit Gold sparst du bei jedem Partner.'}
                </Text>
              </View>
              <Button
                title={plan.key === 'free' ? 'Upgrade' : 'Vorteile'}
                icon="crown"
                variant="light"
                size="small"
                onPress={() => router.push('/club')}
              />
            </View>
          </Card>

          {/* Schnellzugriffe */}
          <View style={styles.quick}>
            {quick.map((q) => (
              <View key={q.key} style={styles.quickWrap}>
                <PressableScale
                  onPress={q.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={q.badge ? `${q.label}, ${q.badge}` : q.label}
                  style={[styles.quickTile, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <View style={[styles.quickIcon, { backgroundColor: colors.backgroundSelected }]}>
                    <Icon name={q.icon} size={22} color={colors.tint} />
                  </View>
                  <Text style={[styles.quickLabel, { color: colors.text }]} numberOfLines={1}>
                    {q.label}
                  </Text>
                  {q.badge ? (
                    <View style={[styles.badge, { backgroundColor: colors.tint, borderColor: colors.background }]}>
                      <Text style={styles.badgeText}>{q.badge > 9 ? '9+' : q.badge}</Text>
                    </View>
                  ) : null}
                </PressableScale>
              </View>
            ))}
          </View>

          {/* Die nächste Buchung als Ticket. */}
          {nextBooking ? (
            <Card onPress={() => router.push({ pathname: '/booking/[id]', params: { id: String(nextBooking.id) } })} accessibilityLabel={`Deine Buchung: ${nextBooking.offer_title}`}>
              <View style={styles.ticket}>
                <View style={[styles.ticketIcon, { backgroundColor: colors.tint }]}>
                  <Icon name="ticket" size={22} color="#ffffff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.kicker, { color: colors.tint }]}>Deine nächste Buchung</Text>
                  <Text style={[styles.ticketTitle, { color: colors.text }]} numberOfLines={1}>
                    {nextBooking.offer_title}
                  </Text>
                  <Text style={[styles.ticketMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {nextBooking.partner_name} · {nextBooking.people} {nextBooking.people === 1 ? 'Person' : 'Personen'}
                    {nextBooking.preferred_date ? ` · ${formatDay(nextBooking.preferred_date)}` : ''}
                  </Text>
                </View>
                <View style={[styles.code, { borderColor: colors.borderStrong }]}>
                  <Text style={[styles.codeText, { color: colors.text }]}>{nextBooking.code}</Text>
                </View>
              </View>
            </Card>
          ) : null}

          {/* Stempelkarte in klein. */}
          {stamps ? (
            <PressableScale onPress={() => router.push('/stamps')} accessibilityRole="button" accessibilityLabel="Stempelkarte öffnen" scaleTo={0.98}>
              <StampCard card={stamps} compact />
            </PressableScale>
          ) : null}
        </View>

        {market.error && market.offers.length === 0 ? (
          <View style={styles.column}>
            <MascotError detail={market.error} onRetry={market.refresh} />
          </View>
        ) : null}

        {!market.loading && !market.error && market.offers.length === 0 ? (
          <View style={styles.column}>
            <Card>
              <MascotEmpty mood="thinking" gesture="wave">
                <Text style={[styles.emptyTitle, { color: colors.text }]}>Bald geht&apos;s los!</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  Wir holen gerade die ersten Partner in Göttingen an Bord. Deine Stempel und Credits kannst du schon sammeln.
                </Text>
              </MascotEmpty>
            </Card>
          </View>
        ) : null}

        {/* Kategorien */}
        {categories.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Alle" active={category === null} onPress={() => setCategory(null)} />
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                active={category === c.id}
                icon={<CategoryIcon interest={c} size={15} color={category === c.id ? '#ffffff' : colors.text} />}
                onPress={() => setCategory((prev) => (prev === c.id ? null : c.id))}
              />
            ))}
          </ScrollView>
        ) : null}

        {featured.length > 0 ? (
          <Section title="Top-Angebote" action="Alle" onAction={() => router.push('/finder')}>
            <Rail itemWidth={260}>
              {featured.map((o) => (
                <OfferCard key={o.id} offer={o} interest={interestById.get(o.interest_id ?? -1)} distanceKm={market.distanceById.get(o.id)} />
              ))}
            </Rail>
          </Section>
        ) : null}

        <View style={styles.column}>
          <Card tone="soft" onPress={() => router.push('/finder')} accessibilityLabel="Gruppen-Finder öffnen">
            <View style={styles.cta}>
              <View style={[styles.ctaIcon, { backgroundColor: colors.tint }]}>
                <Icon name="users" size={22} color="#ffffff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ctaTitle, { color: colors.text }]}>Was machen wir heute?</Text>
                <Text style={[styles.ctaText, { color: colors.textSecondary }]}>
                  Sag, wie viele ihr seid und wie alt – wir finden, was passt. Je mehr, desto günstiger.
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={colors.textSecondary} />
            </View>
          </Card>
        </View>

        {nearby.length > 0 ? (
          <Section title="In deiner Nähe">
            <Rail itemWidth={220}>
              {nearby.map((o) => (
                <OfferCard key={o.id} offer={o} width={220} interest={interestById.get(o.interest_id ?? -1)} distanceKm={market.distanceById.get(o.id)} />
              ))}
            </Rail>
          </Section>
        ) : null}

        {withCredits.length > 0 ? (
          <Section title="Mit Credits einlösen" action="Credits" onAction={() => router.push('/wallet')}>
            <Rail itemWidth={220}>
              {withCredits.map((o) => (
                <OfferCard key={o.id} offer={o} width={220} interest={interestById.get(o.interest_id ?? -1)} distanceKm={market.distanceById.get(o.id)} />
              ))}
            </Rail>
          </Section>
        ) : null}

        <View style={styles.column}>
          <Card onPress={() => router.push('/wallet')} accessibilityLabel="Gutschein einlösen">
            <View style={styles.cta}>
              <View style={[styles.ctaIcon, { backgroundColor: '#f5b50a' }]}>
                <Icon name="gift" size={22} color="#ffffff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ctaTitle, { color: colors.text }]}>Gutschein gekauft?</Text>
                <Text style={[styles.ctaText, { color: colors.textSecondary }]}>
                  GÖ4Fun-Karten gibt&apos;s bei unseren Handelspartnern. Code eingeben, Credits bekommen.
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={colors.textSecondary} />
            </View>
          </Card>
        </View>

        {partners.length > 0 ? (
          <Section title="Unsere Partner">
            <Rail itemWidth={120} gap={Spacing.two}>
              {partners.map((p) => (
                <View key={p.id} style={{ width: 120 }}>
                  <PressableScale
                    onPress={() => router.push({ pathname: '/partner/[id]', params: { id: String(p.id) } })}
                    accessibilityRole="button"
                    accessibilityLabel={p.name}
                    style={[styles.partner, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <PartnerLogo name={p.name} uri={p.logo_url} />
                    <Text style={[styles.partnerName, { color: colors.text }]} numberOfLines={2}>
                      {p.name}
                    </Text>
                  </PressableScale>
                </View>
              ))}
            </Rail>
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  const colors = useTheme();
  return (
    <View style={styles.section}>
      <View style={[styles.column, styles.sectionHead]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
          {title}
        </Text>
        {action && onAction ? (
          <PressableScale onPress={onAction} haptic="select" accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.sectionAction, { color: colors.tint }]}>{action}</Text>
          </PressableScale>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, active, icon, onPress }: { label: string; active: boolean; icon?: React.ReactNode; onPress: () => void }) {
  const colors = useTheme();
  return (
    <PressableScale
      onPress={() => {
        feedback.selected();
        onPress();
      }}
      haptic="none"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        { borderColor: active ? colors.tint : colors.border, backgroundColor: active ? colors.tint : colors.background },
      ]}>
      {icon}
      <Text style={[styles.chipText, { color: active ? '#ffffff' : colors.text }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three, gap: Spacing.three },
  hero: { gap: Spacing.three },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroLine: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  quick: { flexDirection: 'row', gap: Spacing.two },
  quickWrap: { flex: 1 },
  quickTile: { borderWidth: Stroke, borderRadius: Radius.card, alignItems: 'center', paddingVertical: Spacing.three, gap: 6 },
  quickIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontFamily: FontFamily.semibold, fontSize: 12 },
  badge: { position: 'absolute', top: 6, right: 6, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10.5 },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  ticketIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: FontFamily.bold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  ticketTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  ticketMeta: { fontFamily: FontFamily.medium, fontSize: 13 },
  code: { borderWidth: Stroke, borderStyle: 'dashed', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  codeText: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.5 },
  chips: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 14 },
  section: { gap: Spacing.two },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 19, letterSpacing: -0.3 },
  sectionAction: { fontFamily: FontFamily.bold, fontSize: 14 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  ctaIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  ctaText: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  partner: { borderWidth: Stroke, borderRadius: Radius.card, alignItems: 'center', padding: Spacing.three, gap: Spacing.two, minHeight: 124 },
  partnerName: { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: 'center' },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 20 },
  emptyText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
