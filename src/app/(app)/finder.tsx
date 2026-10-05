import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { OfferRow } from '@/components/offer-card';
import { TopBar } from '@/components/top-bar';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Stepper } from '@/components/ui/stepper';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { discountFor, formatEuro, formatPercent, planFor } from '@/domain/club';
import { DEFAULT_CRITERIA, normalizeAges, rankOffers, type FinderCriteria, type Setting } from '@/domain/offer-match';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Der Gruppen-Finder – „Was passt zu UNS?"
 *
 * Man stellt ein, wie viele man ist, wie alt die Jüngste und der Älteste sind,
 * und optional Budget, drinnen/draußen, Kategorie und Entfernung. Die Liste
 * darunter rechnet bei jedem Tipp neu (src/domain/offer-match.ts) – mit dem
 * Preis pro Person für genau diese Gruppe, inklusive Club- und Gruppenrabatt.
 *
 * Wer eine Gruppe wählt, bekommt deren Größe voreingestellt – und die Buchung
 * danach läuft gleich auf die Gruppe.
 */

const BUDGETS: { label: string; cents: number | null }[] = [
  { label: 'Egal', cents: null },
  { label: 'bis 15 €', cents: 1500 },
  { label: 'bis 25 €', cents: 2500 },
  { label: 'bis 40 €', cents: 4000 },
];

const SETTINGS: { key: Setting; label: string }[] = [
  { key: 'any', label: 'Egal' },
  { key: 'indoor', label: 'Drinnen' },
  { key: 'outdoor', label: 'Draußen' },
];

const DISTANCES: { label: string; km: number | null }[] = [
  { label: 'Egal', km: null },
  { label: '5 km', km: 5 },
  { label: '15 km', km: 15 },
  { label: '30 km', km: 30 },
];

export default function FinderScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { user } = useAuth();
  const market = useMarket();

  const [criteria, setCriteria] = useState<FinderCriteria>(DEFAULT_CRITERIA);
  const [groupId, setGroupId] = useState<number | null>(null);

  const set = <K extends keyof FinderCriteria>(key: K, value: FinderCriteria[K]) => {
    setCriteria((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'youngest' || key === 'oldest') Object.assign(next, normalizeAges(next.youngest, next.oldest));
      return next;
    });
  };

  const plan = planFor(CLUB_RULES, user?.club_plan);
  const discount = discountFor(CLUB_RULES, plan.key, criteria.people);

  // Kein useMemo: Der React Compiler merkt sich die Rangliste selbst.
  const results = rankOffers(CLUB_RULES, market.offers, criteria, { plan: plan.key, distanceById: market.distanceById });

  const interestById = new Map(market.interests.map((i) => [i.id, i]));
  const activityCategories = new Set(market.offers.filter((o) => o.kind === 'activity').map((o) => o.interest_id));
  const categories = market.interests.filter((i) => activityCategories.has(i.id));

  const chooseGroup = (id: number | null) => {
    feedback.selected();
    setGroupId(id);
    const group = market.groups.find((g) => g.id === id);
    if (group) set('people', Math.max(1, group.members_count));
  };

  const open = (offerId: number) =>
    router.push({
      pathname: '/offer/[id]',
      params: { id: String(offerId), people: String(criteria.people), ...(groupId ? { group: String(groupId) } : {}) },
    });

  const reaction =
    results.length === 0 ? 'Hm, dafür habe ich gerade nichts. Lockert mal einen Filter?' : results.length === 1 ? 'Ich hab genau eins für euch!' : `Ich hab ${results.length} Ideen für euch!`;

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <TopBar />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <View style={styles.head}>
            <Mascot mood={results.length === 0 ? 'thinking' : 'happy'} gesture="look" size={64} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                Was passt zu euch?
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{reaction}</Text>
            </View>
          </View>

          <Card style={styles.panel}>
            {market.groups.length > 0 ? (
              <View style={styles.block}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Mit welcher Gruppe?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  <Choice label="Ohne Gruppe" active={groupId === null} onPress={() => chooseGroup(null)} />
                  {market.groups.map((g) => (
                    <Choice
                      key={g.id}
                      label={`${g.name} · ${g.members_count}`}
                      icon="users"
                      active={groupId === g.id}
                      onPress={() => chooseGroup(g.id)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Stepper label="Wie viele seid ihr?" value={criteria.people} onChange={(v) => set('people', Math.max(1, v ?? 1))} min={1} max={50} suffix="Pers." />
            <View style={styles.pair}>
              <Stepper label="Jüngste:r" value={criteria.youngest} onChange={(v) => set('youngest', v)} min={0} max={99} start={18} suffix="J." unset="egal" compact />
              <Stepper label="Älteste:r" value={criteria.oldest} onChange={(v) => set('oldest', v)} min={0} max={99} start={criteria.youngest ?? 18} suffix="J." unset="egal" compact />
            </View>

            {/* Was die Gruppengröße bringt – sofort sichtbar, während man zählt. */}
            <View style={[styles.saving, { backgroundColor: discount.percent > 0 ? 'rgba(16,185,129,0.12)' : colors.backgroundSelected }]}>
              <Icon name="percent" size={18} color={discount.percent > 0 ? '#059669' : colors.textSecondary} />
              <Text style={[styles.savingText, { color: colors.text }]}>
                {discount.percent > 0
                  ? `${criteria.people} ${criteria.people === 1 ? 'Person' : 'Personen'} mit ${plan.name}: bis zu ${formatPercent(discount.percent)} Rabatt${discount.capped ? ' (Höchstrabatt)' : ''}`
                  : 'Ab 2 Personen gibt’s Gruppenrabatt – mit Gold & Platinum noch mehr.'}
              </Text>
            </View>

            <View style={styles.block}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Budget pro Person</Text>
              <View style={styles.wrapRow}>
                {BUDGETS.map((b) => (
                  <Choice key={b.label} label={b.label} active={criteria.budgetPerPersonCents === b.cents} onPress={() => set('budgetPerPersonCents', b.cents)} />
                ))}
              </View>
            </View>

            <View style={styles.block}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Drinnen oder draußen?</Text>
              <View style={styles.wrapRow}>
                {SETTINGS.map((s) => (
                  <Choice key={s.key} label={s.label} active={criteria.setting === s.key} onPress={() => set('setting', s.key)} />
                ))}
              </View>
            </View>

            {market.coords ? (
              <View style={styles.block}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Wie weit?</Text>
                <View style={styles.wrapRow}>
                  {DISTANCES.map((d) => (
                    <Choice key={d.label} label={d.label} active={criteria.maxDistanceKm === d.km} onPress={() => set('maxDistanceKm', d.km)} />
                  ))}
                </View>
              </View>
            ) : null}

            {categories.length > 0 ? (
              <View style={styles.block}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Worauf habt ihr Lust?</Text>
                <View style={styles.wrapRow}>
                  {categories.map((c) => {
                    const active = criteria.interestIds.includes(c.id);
                    return (
                      <Choice
                        key={c.id}
                        label={c.name}
                        active={active}
                        category={c}
                        onPress={() =>
                          set('interestIds', active ? criteria.interestIds.filter((x) => x !== c.id) : [...criteria.interestIds, c.id])
                        }
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}
          </Card>

          <View style={styles.resultsHead}>
            <Text style={[styles.resultsTitle, { color: colors.text }]} accessibilityRole="header">
              {results.length === 0 ? 'Keine Treffer' : `${results.length} ${results.length === 1 ? 'Treffer' : 'Treffer'}`}
            </Text>
            {JSON.stringify(criteria) !== JSON.stringify(DEFAULT_CRITERIA) ? (
              <PressableScale
                onPress={() => {
                  setCriteria(DEFAULT_CRITERIA);
                  setGroupId(null);
                }}
                haptic="select"
                accessibilityRole="button">
                <Text style={[styles.reset, { color: colors.tint }]}>Zurücksetzen</Text>
              </PressableScale>
            ) : null}
          </View>

          {results.map((m) => (
            <OfferRow
              key={m.offer.id}
              offer={m.offer}
              interest={interestById.get(m.offer.interest_id ?? -1)}
              distanceKm={market.distanceById.get(m.offer.id)}
              reasons={[...m.reasons, ...m.caveats.map((c) => `Hinweis: ${c}`)]}
              priceLine={
                m.perPersonCents !== null && m.totalCents !== null
                  ? criteria.people > 1
                    ? `${formatEuro(m.perPersonCents)} p. P. · ${formatEuro(m.totalCents)} zusammen`
                    : formatEuro(m.totalCents)
                  : m.offer.price_credits !== null
                    ? `${m.offer.price_credits} Credits p. P.`
                    : null
              }
              onPress={() => open(m.offer.id)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Choice({
  label,
  active,
  onPress,
  icon,
  category,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: 'users';
  category?: { name: string; icon?: string | null };
}) {
  const colors = useTheme();
  const ink = active ? '#ffffff' : colors.text;
  return (
    <PressableScale
      onPress={() => {
        feedback.selected();
        onPress();
      }}
      haptic="none"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.choice, { borderColor: active ? colors.tint : colors.border, backgroundColor: active ? colors.tint : colors.background }]}>
      {icon ? <Icon name={icon} size={14} color={ink} /> : null}
      {category ? <CategoryIcon interest={category} size={14} color={ink} /> : null}
      <Text style={[styles.choiceText, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: Spacing.three, paddingBottom: Spacing.six },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three, gap: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { fontFamily: FontFamily.bold, fontSize: 24, letterSpacing: -0.4 },
  subtitle: { fontFamily: FontFamily.medium, fontSize: 14 },
  panel: { gap: Spacing.three },
  block: { gap: Spacing.two },
  label: { fontFamily: FontFamily.semibold, fontSize: 13 },
  chips: { gap: Spacing.two },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pair: { flexDirection: 'row', gap: Spacing.two },
  saving: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.field, padding: Spacing.three },
  savingText: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13.5, lineHeight: 19 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  choiceText: { fontFamily: FontFamily.semibold, fontSize: 13.5 },
  resultsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
  resultsTitle: { fontFamily: FontFamily.bold, fontSize: 19 },
  reset: { fontFamily: FontFamily.bold, fontSize: 14 },
});
