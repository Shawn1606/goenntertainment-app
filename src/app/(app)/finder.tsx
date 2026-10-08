import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MascotEmpty } from '@/components/mascot';
import { useDockScroll } from '@/components/mascot-dock';
import { OfferRow } from '@/components/offer-card';
import { useGarlandSpace } from '@/components/seasonal-decor';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { Entrance } from '@/components/ui/entrance';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Stepper } from '@/components/ui/stepper';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { discountFor, formatEuro, formatPercent, planFor } from '@/domain/club';
import { DEFAULT_CRITERIA, NO_ACCESS_NEEDS, formatAgeRange, normalizeAges, rankOffers, type AccessNeeds, type FinderCriteria, type Setting } from '@/domain/offer-match';
import { matchesQuery, sortMatches, type FinderSort } from '@/domain/offer-search';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Entdecken – „Was wollt ihr erleben?"
 *
 * Aufgebaut wie eine Frage in drei Schritten, damit man ohne Erklärung weiß,
 * was zu tun ist:
 *
 *   1. **Worauf habt ihr Lust?** – Suchfeld und Kategorien als große Kacheln.
 *   2. **Wer kommt mit?** – Gruppe wählen oder Personen zählen; darunter sofort,
 *      was ihr zusammen spart. Das Alter ist optional und eingeklappt.
 *   3. **Feinschliff** (eingeklappt) – Budget, drinnen/draußen, Entfernung.
 *
 * Darunter die Ideen, die passen – mit Preis pro Person für genau diese
 * Gruppe (src/domain/offer-match.ts), sortierbar nach „passt am besten",
 * Preis oder Nähe. Aktive Filter stehen als Chips darüber und lassen sich
 * einzeln wegtippen.
 *
 * `?group=<id>` (aus dem Gruppen-Tab) wählt die Gruppe gleich vor.
 */

const BUDGETS: { label: string; cents: number | null }[] = [
  { label: 'Egal', cents: null },
  { label: 'bis 15 €', cents: 1500 },
  { label: 'bis 25 €', cents: 2500 },
  { label: 'bis 40 €', cents: 4000 },
];

/** Barrierefreie Filter: nur Partner, die das ausdrücklich angegeben haben. */
const ACCESS: { key: keyof AccessNeeds; label: string; icon: UiIconName }[] = [
  { key: 'wheelchair', label: 'Rollstuhlgerecht', icon: 'user-check' },
  { key: 'quiet', label: 'Ruhige Zeiten', icon: 'moon' },
  { key: 'kids', label: 'Kinderfreundlich', icon: 'balloon' },
];

const SETTINGS: { key: Setting; label: string; icon?: UiIconName }[] = [
  { key: 'any', label: 'Egal' },
  { key: 'indoor', label: 'Drinnen', icon: 'home' },
  { key: 'outdoor', label: 'Draußen', icon: 'sun' },
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
  const params = useLocalSearchParams<{ group?: string }>();
  const garland = useGarlandSpace();
  const dockScroll = useDockScroll();

  const [criteria, setCriteria] = useState<FinderCriteria>(DEFAULT_CRITERIA);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FinderSort>('best');
  const [showAges, setShowAges] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const set = <K extends keyof FinderCriteria>(key: K, value: FinderCriteria[K]) => {
    setCriteria((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'youngest' || key === 'oldest') Object.assign(next, normalizeAges(next.youngest, next.oldest));
      return next;
    });
  };

  const chooseGroup = (id: number | null) => {
    feedback.selected();
    setGroupId(id);
    const group = market.groups.find((g) => g.id === id);
    if (group) set('people', Math.max(1, group.members_count));
  };

  // Aus dem Gruppen-Tab: Gruppe vorwählen – einmal je neuem Parameter, sobald die Gruppen geladen sind.
  // (Zustand beim Rendern anpassen statt im Effekt: so gibt es keinen zweiten Durchlauf.)
  const [appliedGroup, setAppliedGroup] = useState<string | undefined>(undefined);
  if (params.group && params.group !== appliedGroup) {
    const preset = market.groups.find((g) => g.id === Number(params.group));
    if (preset) {
      setAppliedGroup(params.group);
      setGroupId(preset.id);
      setCriteria((prev) => ({ ...prev, people: Math.max(1, preset.members_count) }));
    }
  }

  const plan = planFor(CLUB_RULES, user?.club_plan);
  const discount = discountFor(CLUB_RULES, plan.key, criteria.people);
  const interestById = new Map(market.interests.map((i) => [i.id, i]));

  // Kein useMemo: Der React Compiler merkt sich die Rangliste selbst.
  const searchable = market.offers.filter((o) =>
    matchesQuery([o.title, o.subtitle, o.partner?.name, interestById.get(o.interest_id ?? -1)?.name], query),
  );
  const ranked = rankOffers(CLUB_RULES, searchable, criteria, { plan: plan.key, distanceById: market.distanceById });
  const results = sortMatches(ranked, sort, market.distanceById);

  const activityCategories = new Set(market.offers.filter((o) => o.kind === 'activity').map((o) => o.interest_id));
  const categories = market.interests.filter((i) => activityCategories.has(i.id));
  const group = market.groups.find((g) => g.id === groupId) ?? null;

  const access = criteria.access ?? NO_ACCESS_NEEDS;
  const toggleAccess = (key: keyof AccessNeeds) => set('access', { ...access, [key]: !access[key] });
  const ages = formatAgeRange(criteria.youngest, criteria.oldest);
  const clearAges = () => setCriteria((p) => ({ ...p, youngest: null, oldest: null }));
  const moreCount =
    (criteria.budgetPerPersonCents !== null ? 1 : 0) +
    (criteria.setting !== 'any' ? 1 : 0) +
    (criteria.maxDistanceKm !== null ? 1 : 0) +
    ACCESS.filter((a) => access[a.key]).length;

  /** Aktive Filter als wegtippbare Chips. */
  const active: { key: string; label: string; clear: () => void }[] = [
    ...(query.trim() ? [{ key: 'q', label: `„${query.trim()}"`, clear: () => setQuery('') }] : []),
    ...criteria.interestIds.map((id) => ({
      key: `c${id}`,
      label: interestById.get(id)?.name ?? 'Kategorie',
      clear: () => set('interestIds', criteria.interestIds.filter((x) => x !== id)),
    })),
    ...(ages ? [{ key: 'age', label: `Alter ${ages}`, clear: clearAges }] : []),
    ...(criteria.budgetPerPersonCents !== null
      ? [{ key: 'b', label: `bis ${formatEuro(criteria.budgetPerPersonCents)} p. P.`, clear: () => set('budgetPerPersonCents', null) }]
      : []),
    ...(criteria.setting !== 'any' ? [{ key: 's', label: criteria.setting === 'indoor' ? 'Drinnen' : 'Draußen', clear: () => set('setting', 'any') }] : []),
    ...(criteria.maxDistanceKm !== null ? [{ key: 'd', label: `bis ${criteria.maxDistanceKm} km`, clear: () => set('maxDistanceKm', null) }] : []),
    ...ACCESS.filter((a) => access[a.key]).map((a) => ({ key: `a-${a.key}`, label: a.label, clear: () => toggleAccess(a.key) })),
  ];

  const resetAll = () => {
    feedback.selected();
    setCriteria(DEFAULT_CRITERIA);
    setGroupId(null);
    setQuery('');
    setSort('best');
  };

  const open = (offerId: number) =>
    router.push({
      pathname: '/offer/[id]',
      params: { id: String(offerId), people: String(criteria.people), ...(groupId ? { group: String(groupId) } : {}) },
    });

  const people = criteria.people;
  const who = group ? `„${group.name}"` : `${people} ${people === 1 ? 'Person' : 'Personen'}`;

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <TopBar />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: Spacing.three + garland }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={dockScroll}
        scrollEventThrottle={32}>
        <View style={styles.column}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              Was wollt ihr erleben?
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Sag, worauf ihr Lust habt und wer mitkommt – wir zeigen, was passt und was es pro Person kostet.
            </Text>
          </View>

          {/* Suche */}
          <View style={[styles.search, { backgroundColor: colors.background, borderColor: query ? colors.tint : colors.borderStrong }]}>
            <Icon name="search" size={20} color={query ? colors.tint : colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Bowling, Escape Room, Klettern …"
              placeholderTextColor={colors.textSecondary}
              style={[styles.searchInput, { color: colors.text }]}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Angebote durchsuchen"
            />
            {query ? (
              <PressableScale onPress={() => setQuery('')} haptic="select" hitSlop={10} accessibilityRole="button" accessibilityLabel="Suche löschen">
                <View style={[styles.clear, { backgroundColor: colors.backgroundSelected }]}>
                  <Icon name="close" size={14} color={colors.text} />
                </View>
              </PressableScale>
            ) : null}
          </View>
        </View>

        {/* 1 · Worauf habt ihr Lust? */}
        {categories.length > 0 ? (
          <View style={styles.block}>
            <View style={styles.column}>
              <StepTitle n={1} title="Worauf habt ihr Lust?" hint="Mehrere möglich" />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
              {categories.map((c) => {
                const on = criteria.interestIds.includes(c.id);
                return (
                  <PressableScale
                    key={c.id}
                    onPress={() => {
                      feedback.selected();
                      set('interestIds', on ? criteria.interestIds.filter((x) => x !== c.id) : [...criteria.interestIds, c.id]);
                    }}
                    haptic="none"
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={c.name}
                    style={[styles.tile, { backgroundColor: on ? colors.tint : colors.background, borderColor: on ? colors.tint : colors.border }]}>
                    <View style={[styles.tileIcon, { backgroundColor: on ? 'rgba(255,255,255,0.2)' : colors.backgroundSelected }]}>
                      <CategoryIcon interest={c} size={22} color={on ? '#ffffff' : colors.tint} />
                    </View>
                    <Text style={[styles.tileText, { color: on ? '#ffffff' : colors.text }]} numberOfLines={2}>
                      {c.name}
                    </Text>
                    {on ? (
                      <View style={styles.tileCheck}>
                        <Icon name="check" size={11} color={colors.tint} />
                      </View>
                    ) : null}
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.column}>
          {/* 2 · Wer kommt mit? */}
          <StepTitle n={2} title="Wer kommt mit?" />
          <Card style={styles.panel}>
            {market.groups.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
                <ChoiceChip label="Ohne Gruppe" active={groupId === null} onPress={() => chooseGroup(null)} />
                {market.groups.map((g) => (
                  <ChoiceChip key={g.id} label={`${g.name} · ${g.members_count}`} icon="users" active={groupId === g.id} onPress={() => chooseGroup(g.id)} />
                ))}
              </ScrollView>
            ) : null}

            <Stepper label="Wie viele seid ihr?" value={criteria.people} onChange={(v) => set('people', Math.max(1, v ?? 1))} min={1} max={50} suffix="Pers." />

            {/* Was die Gruppengröße bringt – sofort sichtbar, während man zählt. */}
            <View style={[styles.saving, { backgroundColor: discount.percent > 0 ? 'rgba(16,185,129,0.12)' : colors.backgroundSelected }]}>
              <Icon name="percent" size={18} color={discount.percent > 0 ? '#059669' : colors.textSecondary} />
              <Text style={[styles.savingText, { color: colors.text }]}>
                {discount.percent > 0
                  ? `Mit ${people} Personen spart ihr bis zu ${formatPercent(discount.percent)}${discount.capped ? ' (Höchstrabatt)' : ''} – im ${plan.name}.`
                  : 'Ab 2 Personen gibt’s Gruppenrabatt – mit Gold & Platinum noch mehr.'}
              </Text>
            </View>

            <Toggle
              open={showAges}
              onPress={() => setShowAges((v) => !v)}
              icon="age"
              label="Alter angeben"
              hint={ages ? `Eingestellt: ${ages}` : 'Damit nur kommt, was für alle passt'}
            />
            {showAges ? (
              <Entrance style={styles.ages}>
                <View style={styles.pair}>
                  <Stepper label="Jüngste:r" value={criteria.youngest} onChange={(v) => set('youngest', v)} min={0} max={99} start={18} suffix="J." unset="egal" compact />
                  <Stepper label="Älteste:r" value={criteria.oldest} onChange={(v) => set('oldest', v)} min={0} max={99} start={criteria.youngest ?? 18} suffix="J." unset="egal" compact />
                </View>
                {/* Beide auf einmal aus – das × im Kasten nimmt nur eins raus. */}
                {ages ? (
                  <PressableScale
                    onPress={() => {
                      feedback.selected();
                      clearAges();
                    }}
                    haptic="none"
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Alter auf egal stellen"
                    style={styles.agesClear}>
                    <Icon name="close" size={13} color={colors.tint} />
                    <Text style={[styles.reset, styles.agesClearText, { color: colors.tint }]}>Alter egal</Text>
                  </PressableScale>
                ) : null}
              </Entrance>
            ) : null}
          </Card>

          {/* 3 · Feinschliff */}
          <Card style={styles.panel}>
            <Toggle
              open={showMore}
              onPress={() => setShowMore((v) => !v)}
              icon="sliders"
              label="Mehr Filter"
              hint={moreCount > 0 ? `${moreCount} aktiv` : 'Budget, drinnen/draußen, Entfernung'}
            />
            {showMore ? (
              <Entrance style={styles.more}>
                <FilterRow label="Budget pro Person">
                  {BUDGETS.map((b) => (
                    <ChoiceChip key={b.label} label={b.label} active={criteria.budgetPerPersonCents === b.cents} onPress={() => set('budgetPerPersonCents', b.cents)} />
                  ))}
                </FilterRow>
                <FilterRow label="Drinnen oder draußen?">
                  {SETTINGS.map((s) => (
                    <ChoiceChip key={s.key} label={s.label} icon={s.icon} active={criteria.setting === s.key} onPress={() => set('setting', s.key)} />
                  ))}
                </FilterRow>
                <FilterRow label="Barrierefrei">
                  {ACCESS.map((a) => (
                    <ChoiceChip key={a.key} label={a.label} icon={a.icon} active={access[a.key]} onPress={() => toggleAccess(a.key)} multi />
                  ))}
                </FilterRow>
                {market.coords ? (
                  <FilterRow label="Wie weit?">
                    {DISTANCES.map((d) => (
                      <ChoiceChip key={d.label} label={d.label} active={criteria.maxDistanceKm === d.km} onPress={() => set('maxDistanceKm', d.km)} />
                    ))}
                  </FilterRow>
                ) : null}
              </Entrance>
            ) : null}
          </Card>

          {/* Ergebnisse */}
          <View style={styles.resultsHead}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.resultsTitle, { color: colors.text }]} accessibilityRole="header">
                {results.length === 0 ? 'Keine Treffer' : `${results.length} ${results.length === 1 ? 'Idee' : 'Ideen'} für ${who}`}
              </Text>
              {results.length > 0 ? (
                <Text style={[styles.resultsHint, { color: colors.textSecondary }]}>Preise schon mit eurem Rabatt gerechnet</Text>
              ) : null}
            </View>
            {active.length > 0 || groupId !== null ? (
              <PressableScale onPress={resetAll} haptic="none" accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.reset, { color: colors.tint }]}>Alles zurücksetzen</Text>
              </PressableScale>
            ) : null}
          </View>

          {active.length > 0 ? (
            <View style={styles.activeRow}>
              {active.map((a) => (
                <PressableScale
                  key={a.key}
                  onPress={() => {
                    feedback.selected();
                    a.clear();
                  }}
                  haptic="none"
                  accessibilityRole="button"
                  accessibilityLabel={`Filter ${a.label} entfernen`}
                  style={[styles.activeChip, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
                  <Text style={[styles.activeText, { color: colors.text }]} numberOfLines={1}>
                    {a.label}
                  </Text>
                  <Icon name="close" size={12} color={colors.textSecondary} />
                </PressableScale>
              ))}
            </View>
          ) : null}

          {results.length > 1 ? (
            <View style={styles.sortRow}>
              <ChoiceChip label="Passt am besten" active={sort === 'best'} onPress={() => setSort('best')} size="small" />
              <ChoiceChip label="Günstigste" active={sort === 'price'} onPress={() => setSort('price')} size="small" />
              {market.coords ? <ChoiceChip label="In der Nähe" active={sort === 'distance'} onPress={() => setSort('distance')} size="small" /> : null}
            </View>
          ) : null}

          {results.length === 0 && !market.loading ? (
            <Card>
              <MascotEmpty mood="thinking" gesture="look">
                <Text style={[styles.emptyTitle, { color: colors.text }]}>Dafür hab ich gerade nichts</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {active.length > 0 ? 'Nimm einen Filter raus – oft passt dann doch was.' : 'Bald kommen neue Partner dazu. Schau gern später nochmal vorbei!'}
                </Text>
                {active.length > 0 ? <Button title="Filter zurücksetzen" icon="refresh" variant="secondary" size="small" onPress={resetAll} /> : null}
              </MascotEmpty>
            </Card>
          ) : null}

          {results.map((m, i) => (
            <Entrance key={m.offer.id} index={i}>
              <OfferRow
                offer={m.offer}
                interest={interestById.get(m.offer.interest_id ?? -1)}
                distanceKm={market.distanceById.get(m.offer.id)}
                reasons={[...m.reasons, ...m.caveats.map((c) => `Hinweis: ${c}`)]}
                discountPercent={m.percent}
                priceLine={
                  m.perPersonCents !== null && m.totalCents !== null
                    ? people > 1
                      ? `${formatEuro(m.perPersonCents)} p. P. · ${formatEuro(m.totalCents)} zusammen`
                      : formatEuro(m.totalCents)
                    : m.offer.price_credits !== null
                      ? `${m.offer.price_credits} Credits p. P.`
                      : null
                }
                onPress={() => open(m.offer.id)}
              />
            </Entrance>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Nummerierte Überschrift – führt durch die drei Fragen. */
function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  const colors = useTheme();
  return (
    <View style={styles.stepTitle}>
      <View style={[styles.stepNo, { backgroundColor: colors.tint }]}>
        <Text style={styles.stepNoText}>{n}</Text>
      </View>
      <Text style={[styles.stepText, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={[styles.stepHint, { color: colors.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

/** Auf- und zuklappbare Zeile mit Pfeil – man sieht, dass da noch mehr ist. */
function Toggle({ open, onPress, icon, label, hint }: { open: boolean; onPress: () => void; icon: UiIconName; label: string; hint: string }) {
  const colors = useTheme();
  return (
    <PressableScale onPress={onPress} haptic="select" accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.toggle}>
      <View style={[styles.toggleIcon, { backgroundColor: colors.backgroundSelected }]}>
        <Icon name={icon} size={17} color={colors.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.toggleHint, { color: colors.textSecondary }]} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
        <Icon name="chevron-right" size={18} color={colors.textSecondary} />
      </View>
    </PressableScale>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useTheme();
  return (
    <View style={styles.filterRow}>
      <Text style={[styles.filterLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.wrapRow}>{children}</View>
    </View>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: Spacing.three, paddingBottom: Spacing.six + 48, gap: Spacing.three },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three, gap: Spacing.three },
  head: { gap: 4 },
  title: { fontFamily: FontFamily.bold, fontSize: 26, letterSpacing: -0.4 },
  subtitle: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: Spacing.three, minHeight: 50 },
  searchInput: { flex: 1, minWidth: 0, fontFamily: FontFamily.medium, fontSize: 15.5, paddingVertical: 12 },
  clear: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  block: { gap: Spacing.two },
  stepTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepNo: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepNoText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12.5 },
  stepText: { fontFamily: FontFamily.bold, fontSize: 17 },
  stepHint: { fontFamily: FontFamily.medium, fontSize: 12.5, marginLeft: 'auto' },
  tiles: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  tile: { width: 92, borderWidth: Stroke, borderRadius: Radius.card, alignItems: 'center', paddingVertical: Spacing.three, paddingHorizontal: 6, gap: 6 },
  tileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: FontFamily.semibold, fontSize: 12, textAlign: 'center', lineHeight: 15 },
  tileCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  panel: { gap: Spacing.three },
  chips: { gap: Spacing.two },
  /** Waagerechte Liste nicht in die Höhe wachsen lassen. */
  chipScroll: { flexGrow: 0 },
  pair: { flexDirection: 'row', gap: Spacing.two },
  ages: { gap: Spacing.two },
  agesClear: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  agesClearText: { marginTop: 0 },
  saving: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.field, padding: Spacing.three },
  savingText: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13.5, lineHeight: 19 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  toggleIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  toggleLabel: { fontFamily: FontFamily.bold, fontSize: 15 },
  toggleHint: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  more: { gap: Spacing.three },
  filterRow: { gap: Spacing.two },
  filterLabel: { fontFamily: FontFamily.semibold, fontSize: 13 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  resultsHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, marginTop: Spacing.two },
  resultsTitle: { fontFamily: FontFamily.bold, fontSize: 19 },
  resultsHint: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  reset: { fontFamily: FontFamily.bold, fontSize: 13.5, marginTop: 3 },
  activeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -Spacing.one },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingLeft: 10, paddingRight: 8, paddingVertical: 4, maxWidth: '100%' },
  activeText: { fontFamily: FontFamily.semibold, fontSize: 12.5, flexShrink: 1 },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -Spacing.one },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 18, textAlign: 'center' },
  emptyText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.one },
});
