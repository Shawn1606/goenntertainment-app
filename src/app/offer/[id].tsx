import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCreditsSheet } from '@/components/credits-sheet';
import { MascotError } from '@/components/mascot';
import { PartnerLogo } from '@/components/partner-logo';
import { ReportSheet } from '@/components/report-sheet';
import { ShareOfferSheet } from '@/components/share-offer-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Stepper } from '@/components/ui/stepper';
import { BrandGradient, FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, formatEuro, formatPercent, planFor, quoteCredits, quoteMoney } from '@/domain/club';
import { formatDistance } from '@/domain/distance';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Offer, type PayMethod } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/** Wunschtermin als Schnellwahl – kein Kalender: Die Buchung gilt ohnehin `valid_days` lang. */
function dateChoices(now: Date): { key: string; label: string; value: string | null }[] {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const add = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const saturday = add((6 - now.getDay() + 7) % 7 || 7);
  return [
    { key: 'open', label: 'Flexibel', value: null },
    { key: 'today', label: 'Heute', value: iso(now) },
    { key: 'tomorrow', label: 'Morgen', value: iso(add(1)) },
    { key: 'weekend', label: 'Samstag', value: iso(saturday) },
  ];
}

export default function OfferScreen() {
  const params = useLocalSearchParams<{
    id: string;
    people?: string;
    group?: string;
  }>();
  const router = useRouter();
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const market = useMarket();
  const credits = useCreditsSheet();

  const id = Number(params.id);
  const cached = market.offers.find((o) => o.id === id) ?? null;
  const [offer, setOffer] = useState<Offer | null>(cached);
  const [error, setError] = useState<string | null>(null);

  const [payMethod, setPayMethod] = useState<PayMethod>(cached?.price_cents === null ? 'credits' : 'money');
  const [peopleInput, setPeople] = useState(() => Math.max(1, Number(params.people) || 1));
  const [groupId, setGroupId] = useState<number | null>(params.group ? Number(params.group) : null);
  const [date, setDate] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .offer(token, id)
      .then(({ data }) => {
        setOffer(data);
        if (data.price_cents === null) setPayMethod('credits');
      })
      .catch((e) => setError(errorMessage(e, 'Dieses Angebot konnten wir nicht laden.')));
  }, [token, id]);

  const plan = planFor(CLUB_RULES, user?.club_plan);
  // Personenzahl in den Grenzen des Angebots – gerechnet, nicht gespeichert: So
  // stimmt sie sofort, auch wenn das Angebot erst nach dem ersten Bild ankommt.
  const people = offer ? Math.min(offer.max_people ?? 50, Math.max(offer.min_people, peopleInput)) : peopleInput;
  const choices = dateChoices(new Date());
  const interest = market.interests.find((i) => i.id === (offer?.interest_id ?? offer?.partner?.interest_id));

  if (!offer) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: 'Angebot' }} />
        {error ? <MascotError detail={error} onRetry={() => router.back()} /> : <ActivityIndicator color={colors.tint} />}
      </View>
    );
  }

  const money =
    offer.price_cents !== null
      ? quoteMoney(CLUB_RULES, {
          plan: plan.key,
          people,
          unitPriceCents: offer.price_cents,
          maxDiscountPercent: offer.max_discount_percent,
        })
      : null;
  const creditQuote =
    offer.price_credits !== null
      ? quoteCredits(CLUB_RULES, {
          plan: plan.key,
          people,
          unitCredits: offer.price_credits,
          maxDiscountPercent: offer.max_discount_percent,
        })
      : null;
  const quote = payMethod === 'money' ? money : creditQuote;
  const balance = user?.credits_balance ?? 0;
  const missingCredits = payMethod === 'credits' && creditQuote ? Math.max(0, creditQuote.totalCredits - balance) : 0;
  const distance = formatDistance(market.distanceById.get(offer.id));

  const facts: { icon: UiIconName; text: string }[] = [];
  facts.push({
    icon: 'users',
    text: offer.max_people ? `${offer.min_people}–${offer.max_people} Personen` : offer.min_people > 1 ? `ab ${offer.min_people} Personen` : 'ab 1 Person',
  });
  if (offer.min_age !== null || offer.max_age !== null) {
    facts.push({
      icon: 'age',
      text:
        offer.min_age !== null && offer.max_age !== null
          ? `${offer.min_age}–${offer.max_age} Jahre`
          : offer.min_age !== null
            ? `ab ${offer.min_age} Jahren`
            : `bis ${offer.max_age} Jahre`,
    });
  }
  if (offer.duration_minutes)
    facts.push({
      icon: 'clock',
      text: offer.duration_minutes >= 60 ? `${String(Math.round(offer.duration_minutes / 6) / 10).replace('.', ',')} Std.` : `${offer.duration_minutes} Min.`,
    });
  if (offer.indoor !== null)
    facts.push({
      icon: offer.indoor ? 'building' : 'sun',
      text: offer.indoor ? 'Drinnen' : 'Draußen',
    });
  facts.push({ icon: 'calendar', text: `${offer.valid_days} Tage einlösbar` });

  const book = async () => {
    if (!token || !quote) return;
    if (missingCredits > 0) {
      credits.open();
      return;
    }
    const total = payMethod === 'money' ? formatEuro(money!.totalCents) : `${formatCredits(creditQuote!.totalCredits)} Credits`;
    const testNote = payMethod === 'money' && market.club?.payments_mode === 'test' ? '\n\nTestmodus: Es wird kein echtes Geld abgebucht.' : '';
    const ok = await confirmAction(
      'Jetzt buchen?',
      `${offer.title} bei ${offer.partner?.name ?? 'Partner'} für ${people} ${people === 1 ? 'Person' : 'Personen'} – ${total}.${testNote}`,
      'Zahlungspflichtig buchen',
    );
    if (!ok) return;
    setBooking(true);
    try {
      const result = await api.book(token, {
        offerId: offer.id,
        people,
        payMethod,
        groupId,
        preferredDate: date,
      });
      market.setCredits(result.credits_balance);
      void market.refreshBookings();
      feedback.joined();
      router.replace({
        pathname: '/booking/[id]',
        params: { id: String(result.data.id), fresh: '1' },
      });
    } catch (e) {
      feedback.failed();
      await notifyUser('Buchung hat nicht geklappt', errorMessage(e));
    } finally {
      setBooking(false);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          title: offer.title,
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        <View style={styles.hero}>
          {offer.image_url ? (
            <Image source={{ uri: offer.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.heroFallback]}>
              <CategoryIcon interest={interest ?? null} size={72} color="rgba(255,255,255,0.9)" />
            </LinearGradient>
          )}
          <LinearGradient colors={['transparent', 'rgba(12,4,24,0.75)']} style={styles.heroShade} />
          <View style={styles.heroText}>
            {offer.kind === 'perk' ? (
              <View style={styles.perk}>
                <Icon name="gift" size={13} color="#1c0833" />
                <Text style={styles.perkText}>Vorteil vor Ort</Text>
              </View>
            ) : null}
            <Text style={styles.heroTitle}>{offer.title}</Text>
            {offer.subtitle ? <Text style={styles.heroSub}>{offer.subtitle}</Text> : null}
          </View>
        </View>

        <View style={styles.column}>
          {offer.partner ? (
            <Card
              onPress={() =>
                router.push({
                  pathname: '/partner/[id]',
                  params: { id: String(offer.partner!.id) },
                })
              }
              accessibilityLabel={`Partner ${offer.partner.name}`}>
              <View style={styles.partnerRow}>
                <PartnerLogo name={offer.partner.name} uri={offer.partner.logo_url} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.partnerName, { color: colors.text }]}>{offer.partner.name}</Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[distance, offer.partner.address ?? offer.partner.city].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.textSecondary} />
              </View>
            </Card>
          ) : null}

          <View style={styles.facts}>
            {facts.map((f) => (
              <View
                key={f.text}
                style={[
                  styles.fact,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}>
                <Icon name={f.icon} size={15} color={colors.tint} />
                <Text style={[styles.factText, { color: colors.text }]}>{f.text}</Text>
              </View>
            ))}
          </View>

          {offer.description ? <Text style={[styles.description, { color: colors.text }]}>{offer.description}</Text> : null}

          {/* Buchen */}
          <Card style={styles.panel}>
            <Text style={[styles.panelTitle, { color: colors.text }]} accessibilityRole="header">
              Buchen
            </Text>

            {offer.price_cents !== null && offer.price_credits !== null ? (
              <View
                style={[
                  styles.segment,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.backgroundElement,
                  },
                ]}>
                {(['money', 'credits'] as const).map((m) => {
                  const active = payMethod === m;
                  return (
                    <View key={m} style={styles.segmentSlot}>
                      <PressableScale
                        onPress={() => setPayMethod(m)}
                        haptic="select"
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.segmentItem,
                          active && {
                            backgroundColor: colors.background,
                            borderColor: colors.borderStrong,
                          },
                        ]}>
                        <Icon name={m === 'money' ? 'wallet' : 'coin'} size={16} color={active ? colors.text : colors.textSecondary} />
                        <Text
                          style={[
                            styles.segmentText,
                            {
                              color: active ? colors.text : colors.textSecondary,
                            },
                          ]}>
                          {m === 'money' ? 'Euro' : 'Credits'}
                        </Text>
                      </PressableScale>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <Stepper
              label="Wie viele Personen?"
              value={people}
              onChange={(v) => setPeople(v ?? offer.min_people)}
              min={offer.min_people}
              max={offer.max_people ?? 50}
              suffix="Pers."
            />

            {market.groups.length > 0 ? (
              <View style={styles.block}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Für eine Gruppe?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  <Pick label="Nur ich" active={groupId === null} onPress={() => setGroupId(null)} />
                  {market.groups.map((g) => (
                    <Pick
                      key={g.id}
                      label={g.name}
                      active={groupId === g.id}
                      onPress={() => {
                        setGroupId(g.id);
                        setPeople(Math.min(offer.max_people ?? 50, Math.max(offer.min_people, g.members_count)));
                      }}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.block}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Wann ungefähr?</Text>
              <View style={styles.chipsWrap}>
                {choices.map((c) => (
                  <Pick key={c.key} label={c.label} active={date === c.value} onPress={() => setDate(c.value)} />
                ))}
              </View>
            </View>

            {/* Preisaufstellung */}
            {quote ? (
              <View style={[styles.breakdown, { borderColor: colors.border }]}>
                <Line
                  label={`${people} × ${payMethod === 'money' ? formatEuro(offer.price_cents ?? 0) : `${formatCredits(offer.price_credits ?? 0)} Credits`}`}
                  value={payMethod === 'money' ? formatEuro(money!.subtotalCents) : `${formatCredits(creditQuote!.subtotalCredits)}`}
                />
                {quote.clubPercent > 0 ? <Line label={`${plan.name}`} value={`−${formatPercent(quote.clubPercent)}`} good /> : null}
                {quote.groupPercent > 0 ? <Line label={`Gruppenrabatt (${people} Pers.)`} value={`−${formatPercent(quote.groupPercent)}`} good /> : null}
                {quote.capped ? <Line label="Höchstrabatt dieses Angebots" value={formatPercent(quote.percent)} muted /> : null}
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: colors.text }]}>Zusammen</Text>
                  <Text style={[styles.total, { color: colors.text }]}>
                    {payMethod === 'money' ? formatEuro(money!.totalCents) : `${formatCredits(creditQuote!.totalCredits)} Credits`}
                  </Text>
                </View>
                {payMethod === 'money' && money!.discountCents > 0 ? <Text style={styles.saved}>Du sparst {formatEuro(money!.discountCents)}</Text> : null}
                {payMethod === 'credits' ? (
                  <Text
                    style={[
                      styles.meta,
                      {
                        color: missingCredits > 0 ? '#d97706' : colors.textSecondary,
                      },
                    ]}>
                    {missingCredits > 0
                      ? `Dir fehlen ${formatCredits(missingCredits)} Credits (du hast ${formatCredits(balance)}).`
                      : `Danach hast du noch ${formatCredits(balance - creditQuote!.totalCredits)} Credits.`}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {plan.key === 'free' ? (
              <PressableScale onPress={() => router.push('/club')} accessibilityRole="button" haptic="tap">
                <View style={[styles.upsell, { borderColor: '#f0c44c' }]}>
                  <Icon name="crown" size={16} color="#b27b00" />
                  <Text style={[styles.upsellText, { color: colors.text }]}>
                    Mit Gold sparst du hier{' '}
                    {offer.price_cents !== null
                      ? formatEuro(
                          quoteMoney(CLUB_RULES, {
                            plan: 'gold',
                            people,
                            unitPriceCents: offer.price_cents,
                            maxDiscountPercent: offer.max_discount_percent,
                          }).discountCents - (money?.discountCents ?? 0),
                        )
                      : '10 %'}{' '}
                    mehr.
                  </Text>
                  <Icon name="chevron-right" size={16} color={colors.textSecondary} />
                </View>
              </PressableScale>
            ) : null}
          </Card>

          <Button title="In Gruppe teilen" variant="secondary" icon="share" onPress={() => setSharing(true)} />
          <Button title="Angebot melden" variant="ghost" size="small" icon="flag" onPress={() => setReporting(true)} />
        </View>
      </ScrollView>

      {/* Fester Buchen-Knopf unten */}
      <View
        style={[
          styles.bar,
          {
            paddingBottom: insets.bottom + Spacing.two,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}>
        <View style={styles.barInner}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.barLabel, { color: colors.textSecondary }]}>
              {people} {people === 1 ? 'Person' : 'Personen'}
              {quote && quote.percent > 0 ? ` · −${formatPercent(quote.percent)}` : ''}
            </Text>
            <Text style={[styles.barTotal, { color: colors.text }]}>
              {payMethod === 'money' && money ? formatEuro(money.totalCents) : creditQuote ? `${formatCredits(creditQuote.totalCredits)} Credits` : ''}
            </Text>
          </View>
          <Button
            title={missingCredits > 0 ? 'Credits aufladen' : 'Jetzt buchen'}
            icon={missingCredits > 0 ? 'coin' : 'ticket'}
            onPress={book}
            loading={booking}
            style={styles.barButton}
          />
        </View>
      </View>

      <ShareOfferSheet offer={offer} visible={sharing} onClose={() => setSharing(false)} />
      <ReportSheet target={reporting ? { type: 'offer', id: offer.id, label: offer.title } : null} onClose={() => setReporting(false)} />
    </View>
  );
}

function Pick({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.pick,
        {
          borderColor: active ? colors.tint : colors.border,
          backgroundColor: active ? colors.tint : colors.background,
        },
      ]}>
      <Text style={[styles.pickText, { color: active ? '#ffffff' : colors.text }]}>{label}</Text>
    </PressableScale>
  );
}

function Line({ label, value, good, muted }: { label: string; value: string; good?: boolean; muted?: boolean }) {
  const colors = useTheme();
  const tone = good ? '#059669' : muted ? colors.textSecondary : colors.text;
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, { color: muted ? colors.textSecondary : colors.text }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: tone }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  hero: {
    width: '100%',
    aspectRatio: 4 / 3,
    maxHeight: 420,
    backgroundColor: '#3d1263',
    justifyContent: 'flex-end',
  },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  heroShade: { ...StyleSheet.absoluteFill, top: '40%' },
  heroText: {
    padding: Spacing.three,
    gap: 4,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  perk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff1a8',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  perkText: { color: '#1c0833', fontFamily: FontFamily.bold, fontSize: 12 },
  heroTitle: {
    color: '#ffffff',
    fontFamily: FontFamily.bold,
    fontSize: 28,
    letterSpacing: -0.5,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: FontFamily.medium,
    fontSize: 15,
  },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.three,
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  partnerName: { fontFamily: FontFamily.bold, fontSize: 16 },
  meta: { fontFamily: FontFamily.medium, fontSize: 13 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: Stroke,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  factText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  description: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  panel: { gap: Spacing.three },
  panelTitle: { fontFamily: FontFamily.bold, fontSize: 19 },
  segment: {
    flexDirection: 'row',
    borderWidth: Stroke,
    borderRadius: Radius.field,
    padding: 3,
  },
  // Hülle trägt flex: PressableScale legt `style` auf die innere Fläche.
  segmentSlot: { flex: 1 },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: Radius.field - 3,
    borderWidth: Stroke,
    borderColor: 'transparent',
  },
  segmentText: { fontFamily: FontFamily.bold, fontSize: 14 },
  block: { gap: Spacing.two },
  label: { fontFamily: FontFamily.semibold, fontSize: 13 },
  chips: { gap: Spacing.two },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pick: {
    borderWidth: Stroke,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  pickText: { fontFamily: FontFamily.semibold, fontSize: 13.5 },
  breakdown: {
    borderWidth: Stroke,
    borderStyle: 'dashed',
    borderRadius: Radius.field,
    padding: Spacing.three,
    gap: 6,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  lineLabel: { fontFamily: FontFamily.medium, fontSize: 14, flexShrink: 1 },
  lineValue: { fontFamily: FontFamily.bold, fontSize: 14 },
  divider: { height: Stroke, marginVertical: 4 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  totalLabel: { fontFamily: FontFamily.bold, fontSize: 16 },
  total: { fontFamily: FontFamily.bold, fontSize: 22 },
  saved: {
    color: '#059669',
    fontFamily: FontFamily.bold,
    fontSize: 13,
    textAlign: 'right',
  },
  upsell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: Stroke,
    borderRadius: Radius.field,
    padding: Spacing.three,
    backgroundColor: 'rgba(245,181,10,0.08)',
  },
  upsellText: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13.5 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: Stroke,
    paddingTop: Spacing.two,
  },
  barInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  barLabel: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  barTotal: { fontFamily: FontFamily.bold, fontSize: 20 },
  barButton: { minWidth: 170 },
});
