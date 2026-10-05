/**
 * Kleine Bausteine für den Admin-Bereich – damit alle Admin-Seiten gleich
 * aussehen: Rahmen mit Zugangsprüfung, Kennzahl-Kachel, Abschnittstitel,
 * Umschalter und Formularzeilen.
 *
 * Der Admin-Bereich wird oft am Rechner im Browser bedient (`expo start --web`);
 * alles hier funktioniert dort genauso wie am Handy.
 */
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';

import { MascotEmpty } from '@/components/mascot';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

export function AdminScreen({
  title,
  children,
  refreshing,
  onRefresh,
  headerRight,
}: {
  title: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  headerRight?: () => ReactNode;
}) {
  const colors = useTheme();
  const { user } = useAuth();

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title, headerRight }} />
      {!user?.is_admin ? (
        <View style={styles.center}>
          <MascotEmpty mood="thinking">
            <Text style={{ color: colors.textSecondary, fontFamily: FontFamily.medium }}>Kein Admin-Zugang.</Text>
          </MascotEmpty>
        </View>
      ) : (
        <KeyboardForm
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.tint} /> : undefined}>
          {children}
        </KeyboardForm>
      )}
    </View>
  );
}

export function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: UiIconName; tone?: 'warn' }) {
  const colors = useTheme();
  return (
    <View style={styles.kpiWrap}>
      <Card style={styles.kpi}>
        <Icon name={icon} size={18} color={tone === 'warn' ? '#d97706' : colors.tint} />
        <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1}>
          {value}
        </Text>
        <Text style={[styles.kpiLabel, { color: colors.textSecondary }]} numberOfLines={2}>
          {label}
        </Text>
      </Card>
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  const colors = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.section, { color: colors.text }]} accessibilityRole="header">
        {children}
      </Text>
      {action}
    </View>
  );
}

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const colors = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[styles.toggleHint, { color: colors.textSecondary }]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.tint }} />
    </View>
  );
}

/** Zahl aus einem Textfeld – leer wird `null`, Unsinn auch. */
export function numberOrNull(value: string): number | null {
  const n = Number(value.replace(',', '.').trim());
  return value.trim() === '' || !Number.isFinite(n) ? null : n;
}

/** Euro-Eingabe („29,99") → Cent. */
export function centsOrNull(value: string): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.round(n * 100);
}

/** Cent → Eingabe („29,99"). */
export function euroInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  // Am Handy zwei, auf breiten Schirmen drei Spalten – Beträge wie „1.234,56 €" brauchen Platz.
  kpiWrap: { width: '31%', flexGrow: 1, minWidth: 150 },
  kpi: { gap: 2 },
  kpiValue: { fontFamily: FontFamily.bold, fontSize: 22 },
  kpiLabel: { fontFamily: FontFamily.medium, fontSize: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
  section: { fontFamily: FontFamily.bold, fontSize: 18 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  toggleLabel: { fontFamily: FontFamily.semibold, fontSize: 15 },
  toggleHint: { fontFamily: FontFamily.medium, fontSize: 12.5 },
});
