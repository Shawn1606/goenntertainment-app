/**
 * Bausteine der Club-Seite für den Überblick über die Stufen:
 *
 *  - `PlanComparison` – die Vergleichstabelle (Zeilen aus src/domain/plan-overview.ts),
 *  - `TripExample`    – was ein Ausflug in jeder Stufe kostet, zum Durchklicken,
 *  - `PlanFaq`        – häufige Fragen zum Aufklappen.
 *
 * Die eigene Stufe ist überall markiert, damit man sofort sieht, wo man steht.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PlanBadge } from '@/components/plan-badge';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { Entrance } from '@/components/ui/entrance';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, PlanLook, Radius, Spacing, Stroke } from '@/constants/theme';
import { PLAN_KEYS, formatEuro, formatPercent, planFor, type PlanKey } from '@/domain/club';
import { bookingExample, planComparison, planFaq } from '@/domain/plan-overview';
import { useSignals, useTheme } from '@/hooks/use-theme';
import { CLUB_RULES } from '@/lib/club-rules';

/** Kurzer Name für enge Spalten: „Gold" statt „Gold Plan". */
const shortName = (plan: PlanKey) => planFor(CLUB_RULES, plan).name.replace(/ Plan$/, '');

/** Überschrift eines Abschnitts der Club-Seite. */
export function PlanSectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const colors = useTheme();
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
    </View>
  );
}

/* ============================================================ Vergleich */

export function PlanComparison({ current }: { current: PlanKey }) {
  const colors = useTheme();
  const rows = planComparison(CLUB_RULES);

  return (
    <Card padded={false} style={styles.table}>
      {/* Kopf: je Stufe ein Metall-Streifen, die eigene trägt „Deine Stufe". */}
      <View style={[styles.row, styles.headRow, { borderBottomColor: colors.border }]}>
        <View style={styles.labelCell} />
        {PLAN_KEYS.map((plan) => {
          const look = PlanLook[plan];
          return (
            <View key={plan} style={[styles.valueCell, plan === current && { backgroundColor: look.badgeBg }]}>
              <LinearGradient colors={[...look.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.headPill}>
                <Text style={[styles.headName, { color: look.ink }]} numberOfLines={1}>
                  {shortName(plan)}
                </Text>
              </LinearGradient>
              {plan === current ? <Text style={[styles.mine, { color: look.badgeText }]}>Deine Stufe</Text> : null}
            </View>
          );
        })}
      </View>

      {rows.map((row, i) => (
        <View
          key={row.key}
          style={[styles.row, i % 2 === 1 && { backgroundColor: colors.backgroundElement }]}
          accessible
          accessibilityLabel={`${row.label}: ${PLAN_KEYS.map((p) => `${shortName(p)} ${row.cells[p].text}`).join(', ')}`}>
          <View style={styles.labelCell}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>{row.label}</Text>
            {row.hint ? <Text style={[styles.rowHint, { color: colors.textSecondary }]}>{row.hint}</Text> : null}
          </View>
          {PLAN_KEYS.map((plan) => {
            const cell = row.cells[plan];
            return (
              <View key={plan} style={[styles.valueCell, plan === current && { backgroundColor: PlanLook[plan].badgeBg }]}>
                <Text
                  style={[
                    styles.cellText,
                    { color: cell.text === '–' ? colors.textSecondary : colors.text },
                    cell.best && { color: colors.tint, fontFamily: FontFamily.bold },
                  ]}>
                  {cell.text}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

/* ============================================================ Beispiel-Ausflug */

const PEOPLE = [1, 2, 4, 6, 10] as const;
const PRICES = [1000, 2000, 3500] as const;

export function TripExample({ current }: { current: PlanKey }) {
  const colors = useTheme();
  const signals = useSignals();
  const [people, setPeople] = useState<number>(6);
  const [price, setPrice] = useState<number>(2000);
  const quotes = bookingExample(CLUB_RULES, people, price);
  const full = people * price;

  return (
    <Card style={styles.example}>
      <View style={styles.pickRow}>
        <Text style={[styles.pickLabel, { color: colors.textSecondary }]}>Personen</Text>
        <View style={styles.chips}>
          {PEOPLE.map((n) => (
            <ChoiceChip size="small" key={n} label={String(n)} active={people === n} onPress={() => setPeople(n)} accessibilityLabel={`${n} ${n === 1 ? 'Person' : 'Personen'}`} />
          ))}
        </View>
      </View>
      <View style={styles.pickRow}>
        <Text style={[styles.pickLabel, { color: colors.textSecondary }]}>Preis p. P.</Text>
        <View style={styles.chips}>
          {PRICES.map((cents) => (
            <ChoiceChip size="small" key={cents} label={formatEuro(cents).replace(',00', '')} active={price === cents} onPress={() => setPrice(cents)} />
          ))}
        </View>
      </View>

      <Text style={[styles.exampleFull, { color: colors.textSecondary }]}>Ohne Rabatt: {formatEuro(full)}</Text>

      <View style={styles.quotes}>
        {quotes.map((q) => {
          const mine = q.plan === current;
          return (
            <View
              key={q.plan}
              style={[styles.quote, { borderColor: mine ? PlanLook[q.plan].ring : colors.border, backgroundColor: mine ? PlanLook[q.plan].badgeBg : colors.background }]}
              accessible
              accessibilityLabel={`${q.name}: ${formatEuro(q.totalCents)}, du sparst ${formatEuro(q.savedCents)}${mine ? ', deine Stufe' : ''}`}>
              <View style={styles.quoteLeft}>
                <PlanBadge plan={q.plan} size="small" />
                <Text style={[styles.quoteSub, { color: colors.textSecondary }]}>
                  {q.percent > 0 ? `${formatPercent(q.percent)} Rabatt` : 'Ohne Rabatt'} · {formatEuro(q.perPersonCents)} p. P.
                </Text>
              </View>
              <View style={styles.quoteRight}>
                <Text style={[styles.quoteTotal, { color: colors.text }]}>{formatEuro(q.totalCents)}</Text>
                {q.savedCents > 0 ? <Text style={[styles.quoteSaved, { color: signals.good }]}>−{formatEuro(q.savedCents)}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
      <Text style={[styles.footnote, { color: colors.textSecondary }]}>
        Ein Beispiel. Manche Angebote erlauben weniger Rabatt – maßgeblich ist der Preis, den du beim Buchen siehst.
      </Text>
    </Card>
  );
}


/* ============================================================ Häufige Fragen */

export function PlanFaq() {
  const colors = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  const faq = planFaq(CLUB_RULES);

  return (
    <Card padded={false}>
      {faq.map((item, i) => {
        const expanded = open === i;
        return (
          <View key={item.q} style={[i > 0 && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border }]}>
            <PressableScale
              onPress={() => setOpen(expanded ? null : i)}
              haptic="select"
              scaleTo={0.99}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={item.q}
              style={styles.faqHead}>
              <Text style={[styles.faqQ, { color: colors.text }]}>{item.q}</Text>
              <View style={{ transform: [{ rotate: expanded ? '-90deg' : '90deg' }] }}>
                <Icon name="chevron-right" size={16} color={colors.textSecondary} />
              </View>
            </PressableScale>
            {expanded ? (
              <Entrance>
                <Text style={[styles.faqA, { color: colors.textSecondary }]}>{item.a}</Text>
              </Entrance>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionHead: { gap: 2, marginTop: Spacing.two },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 20, letterSpacing: -0.3 },
  sectionSubtitle: { fontFamily: FontFamily.medium, fontSize: 13.5, lineHeight: 19 },

  table: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  headRow: { borderBottomWidth: Stroke },
  // 1,45 : 1 : 1 : 1 – „Gruppenrabatt" passt in eine Zeile, „Platinum" in die Pille.
  labelCell: { flex: 1.45, paddingVertical: 10, paddingLeft: 12, paddingRight: Spacing.one, justifyContent: 'center', gap: 2 },
  valueCell: { flex: 1, paddingVertical: 10, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center', gap: 3 },
  headPill: { borderRadius: Radius.chip, paddingHorizontal: 7, paddingVertical: 4, maxWidth: '100%' },
  headName: { fontFamily: FontFamily.bold, fontSize: 11.5 },
  mine: { fontFamily: FontFamily.bold, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4 },
  rowLabel: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 17 },
  rowHint: { fontFamily: FontFamily.medium, fontSize: 11, lineHeight: 14 },
  cellText: { fontFamily: FontFamily.semibold, fontSize: 12.5, textAlign: 'center', lineHeight: 16 },

  example: { gap: Spacing.three },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pickLabel: { width: 72, fontFamily: FontFamily.semibold, fontSize: 12.5 },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  exampleFull: { fontFamily: FontFamily.semibold, fontSize: 12.5, marginBottom: -Spacing.two },
  quotes: { gap: Spacing.two },
  quote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: Stroke, borderRadius: Radius.card, padding: 12 },
  quoteLeft: { flex: 1, gap: 6, alignItems: 'flex-start' },
  quoteSub: { fontFamily: FontFamily.medium, fontSize: 12 },
  quoteRight: { alignItems: 'flex-end', gap: 2 },
  quoteTotal: { fontFamily: FontFamily.bold, fontSize: 17 },
  quoteSaved: { fontFamily: FontFamily.bold, fontSize: 12.5 },
  footnote: { fontFamily: FontFamily.medium, fontSize: 11.5, lineHeight: 16 },

  faqHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 14 },
  faqQ: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14.5 },
  faqA: { fontFamily: FontFamily.medium, fontSize: 13.5, lineHeight: 20, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, marginTop: -4 },
});
