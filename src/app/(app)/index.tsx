import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { BingoTeaser } from '@/components/bingo-card';
import { BookingTicket } from '@/components/booking-ticket';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { MascotBuddy } from '@/components/mascot-buddy';
import { useDockScroll, useDockSuppression } from '@/components/mascot-dock';
import { OfferCard } from '@/components/offer-card';
import { PartnerTile } from '@/components/partner-tile';
import { PlanBadge } from '@/components/plan-badge';
import { DecorCorner, useGarlandSpace, useSeason } from '@/components/seasonal-decor';
import { StampCard } from '@/components/stamp-card';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { Icon } from '@/components/ui/icon';
import { MotionPause } from '@/components/ui/motion-pause';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Rail } from '@/components/ui/rail';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { expiryInfo, nextExpiring } from '@/domain/booking-status';
import { formatPercent, planFor, stampProgress } from '@/domain/club';
import { homeSections } from '@/domain/home-sections';
import { homeTips } from '@/domain/mascot-tips';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useNow } from '@/hooks/use-now';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction } from '@/lib/confirm';
import { useFeatures } from '@/lib/features-context';
import { useMarket } from '@/lib/market-context';
import { takeWeakPasswordFlag } from '@/lib/security-nudge';

/**
 * Home – alles Wichtige auf einen Blick.
 *
 *   Kopf:       Begrüßung, Goenni mit dem passenden Tipp, deine Stufe
 *   Schnell:    Einchecken · Pass · Stempel · Gutschein (Gruppen und Tickets sind Tabs)
 *   Dein Stand: das Ticket, das als nächstes verfällt, die Stempelkarte in klein
 *   Angebote:   für dich (mit Kategorien), Ausflug planen, in der Nähe, mit Credits
 *   Partner:    wer mitmacht
 *
 * Die Reihenfolge ist die Frage, die man beim Öffnen hat: Was habe ich (Club,
 * Credits, Stempel)? Was steht an (Ticket)? Was kann ich machen (Angebote)?
 *
 * Jeder Abschnitt hat dieselbe Überschrift: Titel links, rechts ein Knopf mit
 * Pfeil, wenn es dahinter mehr gibt. Antippbares erkennt man so überall gleich.
 *
 * Goenni steht groß im Kopf. Scrollt man ihn aus dem Bild, springt er unten in
 * sein Dock über der Tab-Leiste (src/components/mascot-dock.tsx) – so ist er
 * nie doppelt zu sehen und nie weg. Damit er beim Scrollen um die Grenze herum
 * nicht ständig auf- und abtaucht, gibt es zwei Grenzen (Hysterese).
 */

/** Ab hier ist der Kopf mit Goenni aus dem Bild – Goenni darf ins Dock … */
const HERO_GONE_AT = 260;
/** … und erst unterhalb dieser Höhe verschwindet er wieder daraus. */
const HERO_BACK_AT = 120;

function greeting(hour: number, name: string | null): string {
  const who = name ? `, ${name}` : '';
  if (hour < 5) return `Noch wach${who}?`;
  if (hour < 11) return `Guten Morgen${who}`;
  if (hour < 17) return `Hallo${who}`;
  if (hour < 22) return `Guten Abend${who}`;
  return `Gute Nacht${who}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { user } = useAuth();
  const market = useMarket();
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<number | null>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  const focused = useIsFocused();
  const season = useSeason();
  const garland = useGarlandSpace();
  // Stadt-Bingo nur, wenn ein Admin es freigeschaltet hat (src/lib/features-context.tsx).
  const { bingo } = useFeatures();

  // Einmal nach der Anmeldung: War das eingegebene Passwort schwach, sagen wir es – genau
  // dann, wenn es noch frisch im Kopf ist (src/lib/security-nudge.ts).
  useFocusEffect(
    useCallback(() => {
      if (!takeWeakPasswordFlag()) return;
      void confirmAction(
        'Dein Passwort ist schwach',
        'Es ist leicht zu erraten. Weil an deinem Konto Credits und Buchungen hängen, lohnt sich ein stärkeres – dauert eine Minute.',
        'Jetzt ändern',
      ).then((change) => {
        if (change) router.push('/security/password');
      });
    }, [router]),
  );
  useDockSuppression('home-hero', focused && heroVisible);
  // Ganz schnell nach unten gescrollt? Dann fliegt Goenni hoch (mascot-dock.tsx).
  const dockScroll = useDockScroll();

  const firstName = user?.name?.split(' ')[0] ?? null;
  const plan = planFor(CLUB_RULES, user?.club_plan);
  const stamps = market.club?.stamps ?? null;
  const progress = stampProgress(CLUB_RULES, stamps?.total ?? 0);
  const openBookings = market.bookings.filter((b) => b.status === 'confirmed');
  const now = useNow();
  const nextBooking = nextExpiring(market.bookings, now)?.booking ?? null;
  // Kalendertage wie in der Wallet: „morgen" heißt morgen, auch um 23 Uhr.
  const creditExpiry = expiryInfo(market.club?.next_expiry?.expires_at, now);

  // Kein useMemo: Der React Compiler (app.json → reactCompiler) merkt sich das selbst.
  const tips = homeTips({
    firstName,
    hour: now.getHours(),
    stampsFilled: progress.filled,
    stampsRemaining: progress.remaining,
    rewardCredits: stamps?.reward_credits ?? 100,
    credits: user?.credits_balance ?? 0,
    plan: plan.key,
    openBookings: openBookings.length,
    groups: market.groups.length,
    season: season.key,
    weekday: now.getDay(),
    // Verfall-Erinnerung: der Posten, der als Nächstes verfällt (vom Server).
    expiringCredits: market.club?.next_expiry?.credits,
    expiringDays: creditExpiry && creditExpiry.days >= 0 ? creditExpiry.days : undefined,
  });

  const interestById = new Map(market.interests.map((i) => [i.id, i]));
  const { categoryIds, featured, nearby, withCredits, partners } = homeSections(market.offers, {
    category,
    distanceById: market.distanceById,
  });
  /** Nur Kategorien, in denen es wirklich Angebote gibt – leere Chips wären Sackgassen. */
  const categories = market.interests.filter((i) => categoryIds.has(i.id));
  /** Je Partner: Anzahl Angebote, günstigster Preis und Entfernung – für die Partner-Kacheln. */
  const partnerStats = new Map<number, { offers: number; fromCents: number | null; km: number | null }>();
  for (const o of market.offers) {
    if (!o.partner) continue;
    const stat = partnerStats.get(o.partner.id) ?? { offers: 0, fromCents: null, km: null };
    stat.offers += 1;
    if (o.price_cents !== null) stat.fromCents = stat.fromCents === null ? o.price_cents : Math.min(stat.fromCents, o.price_cents);
    const km = market.distanceById.get(o.id);
    if (km !== undefined) stat.km = stat.km === null ? km : Math.min(stat.km, km);
    partnerStats.set(o.partner.id, stat);
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await market.refresh();
    setRefreshing(false);
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    if (heroVisible && y > HERO_GONE_AT) setHeroVisible(false);
    else if (!heroVisible && y < HERO_BACK_AT) setHeroVisible(true);
    dockScroll(event);
  };

  const quick: { key: string; label: string; icon: UiIconName; badge?: number; onPress: () => void }[] = [
    { key: 'checkin', label: 'Einchecken', icon: 'nfc', onPress: () => router.push('/checkin') },
    { key: 'pass', label: 'Mein Pass', icon: 'qr', onPress: () => router.push({ pathname: '/checkin', params: { mode: 'pass' } }) },
    { key: 'stamps', label: 'Stempel', icon: 'stamp', badge: stamps?.remaining === 1 ? 1 : undefined, onPress: () => router.push('/stamps') },
    { key: 'voucher', label: 'Gutschein', icon: 'gift', onPress: () => router.push('/wallet') },
  ];

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <TopBar />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: Spacing.two + garland }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />}
        onScroll={onScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          {/* Kopf: Begrüßung, Goenni, Stufe. Aus dem Bild gescrollt, ruht er (motion-pause.tsx). */}
          <Card tone="night" style={styles.hero}>
            <MotionPause paused={!heroVisible}>
              <View style={styles.heroHead}>
                <Text style={styles.heroKicker} numberOfLines={1}>
                  {greeting(now.getHours(), firstName).toUpperCase()}
                </Text>
                <DecorCorner corner="inline" size={22} count={3} />
              </View>
              <MascotBuddy tips={tips} tone="night" size={92} />
            </MotionPause>
            <View style={[styles.heroFoot, { borderTopColor: Night.line }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <PlanBadge plan={plan.key} tone="night" />
                <Text style={styles.heroLine} numberOfLines={2}>
                  {plan.discountPercent > 0
                    ? `Du sparst ${formatPercent(plan.discountPercent)} bei jedem Partner – in der Gruppe noch mehr.`
                    : 'Stempel und Gruppenrabatt gibt es gratis.'}
                </Text>
              </View>
              <Button title={plan.key === 'free' ? 'Upgrade' : 'Vorteile'} icon="crown" variant="light" size="small" onPress={() => router.push('/club')} />
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
        </View>

        {nextBooking || stamps || bingo ? (
          <Section
            title="Dein Stand"
            action={openBookings.length > 0 ? (openBookings.length === 1 ? '1 Ticket' : `${openBookings.length} Tickets`) : undefined}
            onAction={() => router.navigate('/bookings')}>
            <View style={styles.column}>
              {/* Das Ticket, das als nächstes verfällt – mit Code und Ablaufdatum. */}
              {nextBooking ? <BookingTicket booking={nextBooking} compact /> : null}
              {stamps ? (
                <PressableScale onPress={() => router.push('/stamps')} accessibilityRole="button" accessibilityLabel="Stempelkarte öffnen" scaleTo={0.98}>
                  <StampCard card={stamps} compact />
                </PressableScale>
              ) : null}
              {bingo ? <BingoTeaser bingo={bingo} onPress={() => router.push('/bingo')} /> : null}
            </View>
          </Section>
        ) : null}

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

        {/* Angebote für dich: Kategorien direkt unter der Überschrift, die sie filtern.
            Der Knopf heißt „Entdecken" statt „Alle" – direkt darunter steht schon der Chip „Alle". */}
        {featured.length > 0 || categories.length > 0 ? (
          <Section title="Angebote für dich" action="Entdecken" onAction={() => router.navigate('/finder')}>
            {categories.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
                <ChoiceChip size="large" label="Alle" active={category === null} onPress={() => setCategory(null)} />
                {categories.map((c) => (
                  <ChoiceChip
                    size="large"
                    key={c.id}
                    label={c.name}
                    active={category === c.id}
                    leading={<CategoryIcon interest={c} size={15} color={category === c.id ? '#ffffff' : colors.text} />}
                    onPress={() => setCategory((prev) => (prev === c.id ? null : c.id))}
                  />
                ))}
              </ScrollView>
            ) : null}
            {featured.length > 0 ? (
              <Rail itemWidth={260}>
                {featured.map((o) => (
                  <OfferCard key={o.id} offer={o} interest={interestById.get(o.interest_id ?? -1)} distanceKm={market.distanceById.get(o.id)} />
                ))}
              </Rail>
            ) : (
              <View style={styles.column}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>In dieser Kategorie gibt es gerade nichts Hervorgehobenes.</Text>
              </View>
            )}
          </Section>
        ) : null}

        {/* Ausflug planen: der Weg zu „Entdecken" mit der eigenen Gruppe. */}
        <View style={styles.column}>
          <Card tone="night" onPress={() => router.navigate('/finder')} accessibilityLabel="Ausflug planen – Entdecken öffnen">
            <View style={styles.cta}>
              <View style={styles.ctaIcon}>
                <Icon name="compass" size={24} color="#ffffff" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.ctaTitle}>Ausflug planen</Text>
                <Text style={styles.ctaText}>Sag, wie viele ihr seid – wir zeigen, was passt und was es pro Person kostet.</Text>
              </View>
              <View style={styles.ctaArrow}>
                <Icon name="chevron-right" size={18} color={Night.deep} />
              </View>
            </View>
          </Card>
        </View>

        {nearby.length > 0 ? (
          <Section title="In deiner Nähe" action="Karte" onAction={() => router.navigate('/map')}>
            <Rail itemWidth={220}>
              {nearby.map((o) => (
                <OfferCard key={o.id} offer={o} width={220} variant="nearby" interest={interestById.get(o.interest_id ?? -1)} distanceKm={market.distanceById.get(o.id)} />
              ))}
            </Rail>
          </Section>
        ) : null}

        {withCredits.length > 0 ? (
          <Section title="Mit Credits einlösen" action="Credits" onAction={() => router.push('/wallet')}>
            <Rail itemWidth={220}>
              {withCredits.map((o) => (
                <OfferCard key={o.id} offer={o} width={220} variant="credits" interest={interestById.get(o.interest_id ?? -1)} distanceKm={market.distanceById.get(o.id)} />
              ))}
            </Rail>
          </Section>
        ) : null}

        {partners.length > 0 ? (
          <Section title="Unsere Partner">
            <Rail itemWidth={156} gap={Spacing.two}>
              {partners.map((p) => {
                const stat = partnerStats.get(p.id);
                return (
                  <PartnerTile
                    key={p.id}
                    partner={p}
                    category={interestById.get(p.interest_id ?? -1)?.name ?? null}
                    offers={stat?.offers ?? 0}
                    fromCents={stat?.fromCents ?? null}
                    distanceKm={stat?.km ?? null}
                  />
                );
              })}
            </Rail>
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Abschnitt mit einheitlicher Überschrift: Titel links, rechts ein Knopf mit Pfeil. */
function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  const colors = useTheme();
  return (
    <View style={styles.section}>
      <View style={[styles.column, styles.sectionHead]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
          {title}
        </Text>
        {action && onAction ? (
          <PressableScale
            onPress={onAction}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={`${title}: ${action}`}
            hitSlop={8}
            style={[styles.sectionActionPill, { backgroundColor: colors.backgroundSelected }]}>
            <Text style={[styles.sectionAction, { color: colors.tint }]}>{action}</Text>
            <Icon name="chevron-right" size={14} color={colors.tint} />
          </PressableScale>
        ) : null}
      </View>
      {children}
    </View>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Unten Platz für Goenni im Dock, damit er nichts Letztes verdeckt.
  content: { paddingTop: Spacing.two, paddingBottom: Spacing.six + 48, gap: Spacing.four },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three, gap: Spacing.three },
  hero: { gap: Spacing.three },
  heroHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, marginBottom: -Spacing.two },
  heroKicker: { flex: 1, color: Night.sparkle, fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 1 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth * 2, paddingTop: Spacing.three },
  heroLine: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  quick: { flexDirection: 'row', gap: Spacing.two },
  quickWrap: { flex: 1 },
  quickTile: { borderWidth: Stroke, borderRadius: Radius.card, alignItems: 'center', paddingVertical: Spacing.three, gap: 6 },
  quickIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontFamily: FontFamily.semibold, fontSize: 12 },
  badge: { position: 'absolute', top: 6, right: 6, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10.5 },
  chipScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  section: { gap: Spacing.three },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 20, letterSpacing: -0.3 },
  sectionAction: { fontFamily: FontFamily.bold, fontSize: 13.5 },
  sectionActionPill: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 999, paddingLeft: 11, paddingRight: 7, paddingVertical: 5 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  ctaIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  ctaArrow: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  ctaTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 17 },
  ctaText: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 20 },
  emptyText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
