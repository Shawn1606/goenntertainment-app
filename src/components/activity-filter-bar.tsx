/**
 * Suchfeld + Filter-Chips (Ticket #6).
 *
 * Diese Komponente stellt nur dar und meldet Änderungen nach oben – *welche*
 * Aktivität ein Treffer ist, entscheidet allein `src/domain/activity-filter.ts`
 * (dort getestet). So lässt sich die Filterlogik ändern, ohne die Oberfläche
 * anzufassen, und umgekehrt.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassChip, GlassSearchField } from '@/components/ui/glass';
import { FontFamily, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import {
  EMPTY_FILTER,
  activeFilterCount,
  type ActivityFilter,
  type DateWindow,
  type Daytime,
} from '@/domain/activity-filter';
import { type Interest } from '@/lib/api';

const WHEN_OPTIONS: { value: DateWindow; label: string }[] = [
  { value: 'all', label: 'Jederzeit' },
  { value: 'today', label: 'Heute' },
  { value: 'tomorrow', label: 'Morgen' },
  { value: 'weekend', label: 'Wochenende' },
  { value: 'week', label: 'Diese Woche' },
  { value: 'month', label: 'Diesen Monat' },
];

const DAYTIME_OPTIONS: { value: Daytime; label: string }[] = [
  { value: 'all', label: 'Ganztags' },
  { value: 'morning', label: 'Vormittags' },
  { value: 'afternoon', label: 'Nachmittags' },
  { value: 'evening', label: 'Abends' },
  { value: 'night', label: 'Nachts' },
];

const DISTANCE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Egal wie weit' },
  { value: 2, label: 'bis 2 km' },
  { value: 5, label: 'bis 5 km' },
  { value: 15, label: 'bis 15 km' },
  { value: 50, label: 'bis 50 km' },
];


export type ActivityFilterBarProps = {
  filter: ActivityFilter;
  onChange: (next: ActivityFilter) => void;
  /** Auswählbare Kategorien (aus /api/interests). */
  interests: Interest[];
  /** Anzahl der Treffer – nur sichtbar, wenn ein Filter gesetzt ist. */
  resultCount: number;
  /** false = keine Standort-Freigabe, dann macht der Umkreis-Filter keinen Sinn. */
  distanceAvailable: boolean;
};

export function ActivityFilterBar({
  filter,
  onChange,
  interests,
  resultCount,
  distanceAvailable,
}: ActivityFilterBarProps) {
  const surface = useBrandSurface();
  const [expanded, setExpanded] = useState(false);

  const count = activeFilterCount(filter);
  const patch = (next: Partial<ActivityFilter>) => onChange({ ...filter, ...next });

  const toggleInterest = (id: number) =>
    patch({
      interestIds: filter.interestIds.includes(id)
        ? filter.interestIds.filter((x) => x !== id)
        : [...filter.interestIds, id],
    });

  return (
    <View style={styles.wrap}>
      <GlassSearchField
        value={filter.query}
        onChangeText={(query) => patch({ query })}
        onClear={() => patch({ query: '' })}
        placeholder="Suchen: Fußball, Bib, Köln …"
        accessibilityLabel="Aktivitäten durchsuchen"
      />

      <View style={styles.row}>
        <Pressable
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          // Im Web übersetzt React Native Web `expanded` nicht nach
          // `aria-expanded` – siehe die Notiz in `ui/setting-row.tsx`.
          aria-expanded={expanded}
          hitSlop={6}>
          <Text style={[styles.toggle, { color: surface.accent }]}>
            {expanded ? 'Filter ausblenden' : 'Filter'}
            {count > 0 ? ` · ${count}` : ''}
          </Text>
        </Pressable>

        {count > 0 ? (
          <View style={styles.rowRight}>
            <Text style={[styles.count, { color: surface.textMuted }]}>
              {resultCount === 1 ? '1 Treffer' : `${resultCount} Treffer`}
            </Text>
            <Pressable onPress={() => onChange(EMPTY_FILTER)} accessibilityRole="button" hitSlop={6}>
              <Text style={[styles.reset, { color: surface.accent }]}>Zurücksetzen</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {expanded ? (
        <View style={styles.panel}>
          <FilterRow label="Wann">
            {WHEN_OPTIONS.map((option) => (
              <GlassChip
                key={option.value}
                label={option.label}
                selected={filter.when === option.value}
                onPress={() => patch({ when: option.value })}
              />
            ))}
          </FilterRow>

          {/* Tageszeit getrennt von „Wann": „diese Woche abends" ist die
              häufigste Suche und mit einer einzigen Reihe nicht ausdrückbar. */}
          <FilterRow label="Tageszeit">
            {DAYTIME_OPTIONS.map((option) => (
              <GlassChip
                key={option.value}
                label={option.label}
                selected={filter.daytime === option.value}
                onPress={() => patch({ daytime: option.value })}
              />
            ))}
          </FilterRow>

          {distanceAvailable ? (
            <FilterRow label="Umkreis">
              {DISTANCE_OPTIONS.map((option) => (
                <GlassChip
                  key={String(option.value)}
                  label={option.label}
                  selected={filter.maxDistanceKm === option.value}
                  onPress={() => patch({ maxDistanceKm: option.value })}
                />
              ))}
            </FilterRow>
          ) : null}

          {interests.length > 0 ? (
            <FilterRow label="Kategorie">
              {interests.map((interest) => (
                <GlassChip
                  key={interest.id}
                  label={interest.name}
                  selected={filter.interestIds.includes(interest.id)}
                  onPress={() => toggleInterest(interest.id)}
                />
              ))}
            </FilterRow>
          ) : null}

          <FilterRow label="Plätze">
            <GlassChip
              label="Nur mit freien Plätzen"
              selected={filter.hideFull}
              onPress={() => patch({ hideFull: !filter.hideFull })}
            />
          </FilterRow>
        </View>
      ) : null}
    </View>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  const surface = useBrandSurface();

  return (
    <View style={styles.filterRow}>
      <Text style={[styles.filterLabel, { color: surface.textMuted }]}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
    minHeight: 24,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  toggle: { fontSize: 13, fontWeight: '700', fontFamily: FontFamily.bold },
  count: { fontSize: 13, fontFamily: FontFamily.regular },
  reset: { fontSize: 13, fontWeight: '700', fontFamily: FontFamily.bold },
  panel: { gap: Spacing.two },
  filterRow: { gap: Spacing.one },
  filterLabel: { fontSize: 12, fontWeight: '700', fontFamily: FontFamily.bold, marginLeft: Spacing.one },
  chips: { gap: Spacing.two, paddingRight: Spacing.four, paddingVertical: 2 },
});
