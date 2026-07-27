import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import { type Activity, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Section = { key: 'created' | 'joined'; title: string; data: Activity[] };

/** Neueste zuerst – wie ein Verlauf (letzter Termin oben). */
function byStartDesc(a: Activity, b: Activity): number {
  const ta = a.starts_at ? new Date(a.starts_at).getTime() : 0;
  const tb = b.starts_at ? new Date(b.starts_at).getTime() : 0;
  return tb - ta;
}

/** Zuletzt beigetretenes zuerst – der echte Verlauf (Beitritts-Zeitpunkt). */
function byJoinedDesc(a: Activity, b: Activity): number {
  const ta = a.joined_at ? new Date(a.joined_at).getTime() : 0;
  const tb = b.joined_at ? new Date(b.joined_at).getTime() : 0;
  return tb - ta;
}

/**
 * „Meine Aktivitäten": zwei Abschnitte untereinander – oben die selbst
 * erstellten Events, darunter die, denen man beigetreten ist (ohne die
 * eigenen doppelt zu zeigen). Aufbau wie ein Verlauf, neueste zuerst.
 */
export default function MyActivitiesScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Activity | null>(null);

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

  // Bei jedem Fokus neu laden – neu erstellte/beigetretene Events sofort sichtbar.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Beitreten/Verlassen im Popup übernehmen (Liste + offenes Popup aktualisieren).
  const handleChanged = useCallback((updated: Activity) => {
    setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  const sections = useMemo<Section[]>(() => {
    const created = activities
      .filter((a) => a.host?.id === user?.id)
      .sort(byStartDesc);
    // Beigetreten, aber nicht selbst erstellt (Ersteller:in ist automatisch dabei).
    // Nach Beitritts-Zeitpunkt sortiert – echter Verlauf, zuletzt beigetreten oben.
    const joined = activities
      .filter((a) => a.is_joined && a.host?.id !== user?.id)
      .sort(byJoinedDesc);

    return [
      { key: 'created', title: 'Erstellt', data: created },
      { key: 'joined', title: 'Beigetreten', data: joined },
    ];
  }, [activities, user?.id]);

  return (
    <HomeBackground style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        style={styles.list}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText style={[styles.title, { color: surface.text }]}>
              Meine Aktivitäten
            </ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Erstellte und beigetretene Events – wie ein Verlauf.
            </ThemedText>
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.data.length > 0 ? (
            <View style={styles.sectionHeader}>
              <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                {section.title} · {section.data.length}
              </ThemedText>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ActivityCard activity={item} onPress={() => setSelected(item)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        SectionSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={surface.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <ThemedText style={[styles.emptyText, { color: surface.textMuted }]}>
                {error ??
                  'Noch nichts hier. Erstelle ein Event oder tritt einem bei – es erscheint dann in deinem Verlauf.'}
              </ThemedText>
            </View>
          )
        }
      />

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
  header: {
    gap: Spacing.half,
    marginBottom: Spacing.three,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  sectionHeader: {
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  empty: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
});
