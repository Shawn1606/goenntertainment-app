import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { TrashIcon } from '@/components/ui/icons';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import { type Activity, type AdminStats, type AdminStatsPoint, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-Datum → „TT.MM." für kompakte Achsen-/Zeilenbeschriftung. */
function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

export default function AdminPanelScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [s, a] = await Promise.all([api.adminStats(token), api.activities(token)]);
      setStats(s);
      setActivities(a.data);
    } catch {
      setError('Admin-Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleDelete = useCallback(
    async (activity: Activity) => {
      if (!token) return;
      const ok = await confirmAction(
        'Event löschen',
        `„${activity.title}" wirklich unwiderruflich löschen?`,
        'Löschen',
        true,
      );
      if (!ok) return;
      try {
        await api.deleteActivity(token, activity.id);
        setActivities((prev) => prev.filter((a) => a.id !== activity.id));
        // Kennzahlen leicht anpassen, ohne neu zu laden.
        setStats((prev) =>
          prev ? { ...prev, totals: { ...prev.totals, activities: Math.max(0, prev.totals.activities - 1) } } : prev,
        );
      } catch {
        setError('Löschen fehlgeschlagen.');
      }
    },
    [token],
  );

  // Sicherheitsnetz: Der Tab ist zwar nur für Admins sichtbar, aber die Route
  // ist per URL erreichbar. Nicht-Admins bekommen hier nichts zu sehen.
  if (!user?.is_admin) {
    return (
      <HomeBackground style={[styles.screen, styles.centered]}>
        <ThemedText style={{ color: surface.textMuted }}>Kein Admin-Zugang.</ThemedText>
      </HomeBackground>
    );
  }

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}>
        <View style={styles.header}>
          <ThemedText type="small" style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBg }]}>
            ADMIN
          </ThemedText>
          <ThemedText style={[styles.title, { color: surface.text }]}>Dashboard</ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            Überblick über deine App
          </ThemedText>
        </View>

        {loading && !stats ? (
          <View style={styles.centered}>
            <ActivityIndicator color={surface.accent} />
          </View>
        ) : error ? (
          <ThemedText style={{ color: '#ef4444', textAlign: 'center' }}>{error}</ThemedText>
        ) : stats ? (
          <>
            {/* Wichtig für die App: läuft es? */}
            <ThemedText type="smallBold" style={[styles.sectionLabel, { color: surface.textMuted }]}>
              App-Zahlen
            </ThemedText>
            <View style={styles.kpiGrid}>
              <Kpi label="Nutzer" value={stats.totals.users} surface={surface} />
              <Kpi label="Events" value={stats.totals.activities} surface={surface} />
              <Kpi label="Beitritte" value={stats.totals.joins} surface={surface} />
              <Kpi label={`Neue Nutzer (${stats.recent.days}T)`} value={stats.recent.new_users} surface={surface} />
              <Kpi label={`Beitritte (${stats.recent.days}T)`} value={stats.recent.joins} surface={surface} />
              <Kpi label="Umsatz" value="—" hint="noch nicht angebunden" surface={surface} />
            </View>

            {/* Nutzeraktivität als Verlauf */}
            <ThemedText type="smallBold" style={[styles.sectionLabel, { color: surface.textMuted }]}>
              Nutzeraktivität (letzte {stats.series.days} Tage)
            </ThemedText>
            <BarChart title="Anmeldungen / Tag" points={stats.series.signups} color={surface.accent} surface={surface} />
            <BarChart title="Beitritte / Tag" points={stats.series.joins} color="#22c55e" surface={surface} />

            {/* Events verwalten */}
            <ThemedText type="smallBold" style={[styles.sectionLabel, { color: surface.textMuted }]}>
              Alle Events ({activities.length})
            </ThemedText>
            <View style={[styles.listCard, { backgroundColor: surface.card, borderColor: surface.cardBorder }]}>
              {activities.length === 0 ? (
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  Noch keine Events.
                </ThemedText>
              ) : (
                activities.map((item, i) => (
                  <View
                    key={item.id}
                    style={[
                      styles.row,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.cardBorder },
                    ]}>
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                        {item.title}
                      </ThemedText>
                      <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                        {[shortDate(item.starts_at), item.host ? `von ${item.host.name}` : null, `${item.participants_count ?? 0} dabei`]
                          .filter(Boolean)
                          .join(' · ')}
                      </ThemedText>
                    </View>
                    <Pressable
                      onPress={() => handleDelete(item)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Event löschen"
                      style={({ pressed }) => [styles.rowDelete, pressed && { opacity: 0.6 }]}>
                      <TrashIcon size={18} color="#ef4444" />
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </HomeBackground>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

function Kpi({
  label,
  value,
  hint,
  surface,
}: {
  label: string;
  value: number | string;
  hint?: string;
  surface: Surface;
}) {
  return (
    <View style={[styles.kpiCard, { backgroundColor: surface.card, borderColor: surface.cardBorder }]}>
      <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.kpiValue, { color: surface.accent }]}>{value}</ThemedText>
      {hint ? (
        <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const CHART_HEIGHT = 96;

/** Simpler Balken-Graph aus reinen Views – läuft ohne Extra-Pakete auf Web & Handy. */
function BarChart({
  title,
  points,
  color,
  surface,
}: {
  title: string;
  points: AdminStatsPoint[];
  color: string;
  surface: Surface;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <View style={[styles.chartCard, { backgroundColor: surface.card, borderColor: surface.cardBorder }]}>
      <View style={styles.chartHead}>
        <ThemedText type="smallBold" style={{ color: surface.text }}>
          {title}
        </ThemedText>
        <ThemedText type="small" style={{ color: surface.textMuted }}>
          {total} gesamt
        </ThemedText>
      </View>
      <View style={styles.bars}>
        {points.map((p) => (
          <View key={p.date} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(2, Math.round((p.count / max) * CHART_HEIGHT)),
                  backgroundColor: p.count > 0 ? color : surface.cardBorder,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.chartAxis}>
        <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
          {shortDate(first?.date ?? null)}
        </ThemedText>
        <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
          {shortDate(last?.date ?? null)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  header: { gap: Spacing.half, marginBottom: Spacing.one },
  badge: {
    alignSelf: 'flex-start',
    fontWeight: '800',
    letterSpacing: 2,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  title: { fontSize: 28, fontWeight: '800' },
  sectionLabel: { marginTop: Spacing.two },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  kpiCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: 2,
  },
  kpiValue: { fontSize: 26, fontWeight: '800' },
  chartCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 3 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  listCard: { borderWidth: 1, borderRadius: 16, paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.three, gap: Spacing.two },
  rowText: { flex: 1, gap: 2 },
  rowDelete: { padding: Spacing.one },
});
