import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { BrandLogo } from '@/components/brand-logo';
import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import { type Activity, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import { useNearbyActivities } from '@/lib/use-nearby-activities';

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  personal: 'Persönlich',
  business: 'Business',
};

/** Die drei Home-Tabs. */
type Segment = 'recommended' | 'nearby' | 'other';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'recommended', label: 'Für dich empfohlen' },
  { key: 'nearby', label: 'In deiner Nähe' },
  { key: 'other', label: 'Weitere' },
];

/** Passender Leer-Text je Tab. */
function emptyMessage(segment: Segment, hasLocation: boolean): string {
  if (segment === 'recommended') {
    return 'Noch nichts, das zu deinen Interessen passt. Wähle Interessen im Profil oder erstelle mit ＋ die erste Activity!';
  }
  if (segment === 'nearby') {
    return hasLocation
      ? 'In deiner Nähe ist gerade nichts los. Schau später wieder vorbei!'
      : 'Für „In deiner Nähe" brauchen wir Zugriff auf deinen Standort. Erlaube ihn in den Einstellungen.';
  }
  return 'Keine weiteren Aktivitäten. Erstelle mit ＋ die erste!';
}

export default function HomeScreen() {
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const { user, logout, token } = useAuth();
  const surface = useBrandSurface();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Angetippte Activity → Detail-Popup. `null` = geschlossen.
  const [selected, setSelected] = useState<Activity | null>(null);
  // Aktiver Home-Tab.
  const [segment, setSegment] = useState<Segment>('recommended');

  // „In deiner Nähe": Standort holen + Orte der Activities geocoden.
  const { nearbyIds, resolving: nearbyResolving, hasLocation } = useNearbyActivities(activities);

  // IDs der Interessen des Accounts – für „Für dich empfohlen".
  const myInterestIds = useMemo(
    () => new Set((user?.interests ?? []).map((i) => i.id)),
    [user?.interests],
  );

  // Passt die Activity zu meinen Interessen? (mind. eine Überschneidung)
  const matchesInterests = useCallback(
    (activity: Activity) => activity.interests.some((i) => myInterestIds.has(i.id)),
    [myInterestIds],
  );

  // Die drei Listen. Überschneidet sich eine Activity mit Interesse UND Nähe,
  // taucht sie bewusst in beiden Tabs auf. „Weitere" = weder noch.
  const grouped = useMemo(() => {
    const recommended: Activity[] = [];
    const nearby: Activity[] = [];
    const other: Activity[] = [];
    for (const activity of activities) {
      const isRecommended = matchesInterests(activity);
      const isNearby = nearbyIds.has(activity.id);
      if (isRecommended) recommended.push(activity);
      if (isNearby) nearby.push(activity);
      if (!isRecommended && !isNearby) other.push(activity);
    }
    return { recommended, nearby, other };
  }, [activities, matchesInterests, nearbyIds]);

  const visible =
    segment === 'recommended'
      ? grouped.recommended
      : segment === 'nearby'
        ? grouped.nearby
        : grouped.other;

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.activities(token);
      setActivities(res.data);
    } catch {
      setError('Aktivitäten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Bei jedem Fokus neu laden – so erscheint eine neu erstellte Activity sofort.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Nach Beitreten/Verlassen im Popup: Liste + offenes Popup mit den frischen
  // Daten (Teilnehmerzahl, is_joined) aktualisieren.
  const handleChanged = useCallback((updated: Activity) => {
    setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  // Admin: Event löschen (mit Rückfrage). Nach Erfolg sofort aus der Liste entfernen.
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
      } catch {
        setError('Löschen fehlgeschlagen.');
      }
    },
    [token],
  );

  return (
    <HomeBackground style={styles.container}>
      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.id)}
        style={styles.list}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: safeAreaInsets.top + Spacing.four,
            paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        ListHeaderComponent={
          <View>
            <View style={styles.topBar}>
              <BrandLogo size="small" />
              <Pressable onPress={logout} style={styles.logout} hitSlop={8}>
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  Abmelden
                </ThemedText>
              </Pressable>
            </View>

            <View
              style={[
                styles.nameWidget,
                { backgroundColor: surface.card, borderColor: surface.cardBorder },
              ]}>
              <ThemedText style={[styles.greetingText, { color: surface.text }]}>
                Hallo {user?.name ?? ''} 👋
              </ThemedText>
              <View style={styles.metaRow}>
                {user?.username ? (
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    @{user.username}
                  </ThemedText>
                ) : null}
                {user?.username && user?.account_type ? (
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    ·
                  </ThemedText>
                ) : null}
                {user?.account_type ? (
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    {ACCOUNT_TYPE_LABELS[user.account_type] ?? user.account_type}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            {user?.interests && user.interests.length > 0 ? (
              <View style={styles.chipRow}>
                {user.interests.map((interest) => (
                  <View
                    key={interest.id}
                    style={[
                      styles.chip,
                      { backgroundColor: surface.card, borderColor: surface.cardBorder },
                    ]}>
                    <ThemedText type="small" style={{ color: surface.chipText }}>
                      {interest.name}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Segment-Leiste: Für dich empfohlen · In deiner Nähe · Weitere */}
            <View
              style={[
                styles.segmentBar,
                { backgroundColor: surface.card, borderColor: surface.cardBorder },
              ]}>
              {SEGMENTS.map((seg) => {
                const active = seg.key === segment;
                return (
                  <Pressable
                    key={seg.key}
                    onPress={() => setSegment(seg.key)}
                    style={[styles.segment, active && { backgroundColor: surface.accent }]}>
                    <ThemedText
                      type="small"
                      numberOfLines={1}
                      style={[
                        styles.segmentText,
                        { color: active ? surface.accentText : surface.textMuted },
                      ]}>
                      {seg.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ActivityCard
            activity={item}
            onPress={() => setSelected(item)}
            onDelete={user?.is_admin ? () => handleDelete(item) : undefined}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        ListEmptyComponent={
          loading || (segment === 'nearby' && hasLocation && nearbyResolving) ? (
            <View style={styles.empty}>
              <ActivityIndicator color={surface.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <ThemedText style={[styles.emptyText, { color: surface.textMuted }]}>
                {error ?? emptyMessage(segment, hasLocation)}
              </ThemedText>
            </View>
          )
        }
      />

      <Pressable
        onPress={() => router.push('/create-activity')}
        style={[
          styles.fab,
          {
            backgroundColor: surface.accent,
            bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
          },
        ]}>
        <ThemedText style={styles.fabText}>＋</ThemedText>
      </Pressable>

      <ActivityDetailModal
        activity={selected}
        onClose={() => setSelected(null)}
        onChanged={handleChanged}
      />
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  logout: {
    paddingVertical: Spacing.one,
  },
  nameWidget: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    gap: Spacing.half,
    marginBottom: Spacing.three,
  },
  greetingText: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.four,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  segmentBar: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.half,
    gap: Spacing.half,
    marginBottom: Spacing.three,
  },
  segment: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontWeight: '600',
    textAlign: 'center',
  },
  empty: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 4 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  fabText: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
    color: '#ffffff',
  },
});
