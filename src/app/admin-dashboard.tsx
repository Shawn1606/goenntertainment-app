import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { TrashIcon } from '@/components/ui/icons';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { formatDayShort } from '@/domain/date-format';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import { type Activity, type AdminStats, type AdminStatsPoint, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';

export default function AdminPanelScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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

  const header = <Stack.Screen options={{ headerShown: true, title: 'Admin' }} />;

  /**
   * Offene Konto-Anfragen. Ältere Server kennen das Feld nicht – dann steht
   * hier 0 und die Karte zeigt kein Abzeichen, statt „undefined offen".
   */
  const pendingRequests = stats?.totals.pending_requests ?? 0;
  /** Offene Meldungen. Ältere Server liefern das Feld nicht – dann steht keine Zahl. */
  const openReports = stats?.totals.open_reports ?? 0;

  // Sicherheitsnetz: Der Einstieg ist zwar nur für Admins sichtbar, aber die
  // Route ist per URL erreichbar. Nicht-Admins bekommen hier nichts zu sehen.
  if (!user?.is_admin) {
    return (
      <HomeBackground style={[styles.screen, styles.centered]}>
        {header}
        <ThemedText style={{ color: surface.textMuted }}>Kein Admin-Zugang.</ThemedText>
      </HomeBackground>
    );
  }

  return (
    <HomeBackground style={styles.screen}>
      {header}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
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

            {/* Einstiege in die Unterbereiche. „Beweise" hing früher als
                eigener Tab unten – jetzt führt der Weg hier entlang.

                Ganz oben steht, was auf Arbeit WARTET: Offene Konto-Anfragen
                sind der einzige Punkt im Panel, an dem jemand anderes auf eine
                Antwort sitzt. Alles darunter kann man ansehen, wann man will. */}
            <NavCard
              icon="user-check"
              title="Konto-Anfragen"
              hint={
                pendingRequests > 0
                  ? `${pendingRequests} ${pendingRequests === 1 ? 'Anfrage wartet' : 'Anfragen warten'} auf dich`
                  : 'Creator, Business und Business Plus freischalten'
              }
              badge={pendingRequests > 0 ? String(pendingRequests) : null}
              onPress={() => router.push('/admin-requests')}
              surface={surface}
            />
            {/* Meldungen stehen direkt unter den Konto-Anfragen: Auch hier wartet
                jemand – und zwar jemand, der ein Problem gemeldet hat. Ohne diese
                Karte wäre der Meldeknopf in der App eine Attrappe. */}
            <NavCard
              icon="flag"
              title="Meldungen"
              hint={
                openReports > 0
                  ? `${openReports} ${openReports === 1 ? 'Meldung wartet' : 'Meldungen warten'} auf dich`
                  : 'Gemeldete Events, Nachrichten und Konten'
              }
              badge={openReports > 0 ? String(openReports) : null}
              onPress={() => router.push('/admin-reports')}
              surface={surface}
            />
            <NavCard
              icon="camera"
              title="Storys"
              hint={
                stats.totals.stories === undefined
                  ? 'Laufende Storys ansehen und löschen'
                  : `${stats.totals.stories} laufen gerade`
              }
              onPress={() => router.push('/admin-stories')}
              surface={surface}
            />
            <NavCard
              icon="users"
              title="Alle Nutzer ansehen"
              hint={`${stats.totals.users} registriert`}
              onPress={() => router.push('/admin-users')}
              surface={surface}
            />
            <NavCard
              icon="robot"
              title="KI-Verifizierung"
              hint="Geprüfte Inhalte & automatische Sperren"
              onPress={() => router.push('/admin-moderation')}
              surface={surface}
            />
            <NavCard
              icon="folder"
              title="Beweise"
              hint="Belege zu Sperren und Timeouts"
              onPress={() => router.push('/admin-evidence')}
              surface={surface}
            />

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
            <GlassSurface
              tone={activities.length === 0 ? 'accent' : 'card'}
              radius={Radius.card}
              style={styles.listCard}>
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
                        {[formatDayShort(item.starts_at), item.host ? `von ${item.host.name}` : null, `${item.participants_count ?? 0} dabei`]
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
            </GlassSurface>
          </>
        ) : null}
      </ScrollView>
    </HomeBackground>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

/**
 * Zeile, die in einen Unterbereich führt.
 *
 * Das Symbol kommt als NAME aus `src/domain/ui-icon.ts` und wird gezeichnet.
 * Vorher stand der Name als Text vor dem Titel („users Alle Nutzer ansehen") –
 * ein Rest aus der Zeit, als hier Emojis standen.
 *
 * `badge` ist für Zahlen, die auf Arbeit hinweisen (offene Anfragen). Eine 0
 * bekommt bewusst kein Abzeichen: Ein Punkt, der immer leuchtet, sagt nichts.
 */
function NavCard({
  icon,
  title,
  hint,
  badge,
  onPress,
  surface,
}: {
  icon: UiIconName;
  title: string;
  hint: string;
  badge?: string | null;
  onPress: () => void;
  surface: Surface;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <GlassSurface radius={Radius.card} style={styles.usersButton}>
        <Icon name={icon} size={20} color={surface.accent} />
        <View style={styles.usersButtonText}>
          <ThemedText type="smallBold" style={{ color: surface.text }}>
            {title}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {hint}
          </ThemedText>
        </View>
        {badge ? (
          <ThemedText type="smallBold" style={[styles.navBadge, { color: '#ffffff', backgroundColor: '#ef4444' }]}>
            {badge}
          </ThemedText>
        ) : null}
        <Icon name="chevron-right" size={18} color={surface.accent} />
      </GlassSurface>
    </Pressable>
  );
}

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
    <GlassSurface radius={Radius.card} style={styles.kpiCard}>
      <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.kpiValue, { color: surface.accent }]}>{value}</ThemedText>
      {hint ? (
        <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
          {hint}
        </ThemedText>
      ) : null}
    </GlassSurface>
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
    <GlassSurface radius={Radius.card} style={styles.chartCard}>
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
          {formatDayShort(first?.date ?? null)}
        </ThemedText>
        <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
          {formatDayShort(last?.date ?? null)}
        </ThemedText>
      </View>
    </GlassSurface>
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
    borderRadius: Radius.field,
    padding: Spacing.three,
    gap: 2,
  },
  kpiValue: { fontSize: 26, fontWeight: '800' },
  usersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  usersButtonText: { flex: 1, gap: 2 },
  navBadge: {
    minWidth: 22,
    textAlign: 'center',
    fontWeight: '800',
    borderRadius: 999,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  chartCard: { padding: Spacing.three, gap: Spacing.two },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 3 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  listCard: { paddingHorizontal: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.three, gap: Spacing.two },
  rowText: { flex: 1, gap: 2 },
  rowDelete: { padding: Spacing.one },
});
