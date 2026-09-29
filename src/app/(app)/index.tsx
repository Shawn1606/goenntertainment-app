import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { ActivityFilterBar } from '@/components/activity-filter-bar';
import { BrandLogo } from '@/components/brand-logo';
import { CategoryStrip } from '@/components/category-strip';
import { ActivityPost } from '@/components/feed/activity-post';
import { FeedEmpty } from '@/components/feed/feed-empty';
import { HomeBackground } from '@/components/home-background';
import { MascotError } from '@/components/mascot';
import { ShareSheet } from '@/components/share-sheet';
import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { EMPTY_FILTER, filterActivities, isFilterActive, type ActivityFilter } from '@/domain/activity-filter';
import { rankActivities } from '@/domain/recommendations';
import { unreadBadge } from '@/domain/unread-badge';
import { useTheme } from '@/hooks/use-theme';
import { type Activity, type Interest, api, ApiError } from '@/lib/api';
import { useAppSettings } from '@/lib/app-settings';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { takeWeakPasswordFlag } from '@/lib/security-nudge';
import { useNearbyActivities } from '@/lib/use-nearby-activities';

/**
 * Home – der Feed.
 *
 * ## Aufbau (Instagram + TikTok)
 *
 *   Kopf:    GÖ4Fun-Schriftzug · Suche · Chats        (Instagram)
 *   Reiter:  Für dich | In der Nähe | Heute           (TikTok „Für dich / Folge ich")
 *   Chips:   Kategorien zum Antippen
 *   Feed:    eine Aktivität unter der anderen, jede wie ein Instagram-Post
 *
 * ## Was hier NICHT mehr steht – und warum
 *
 * Vorher stapelten sich hier Upgrade-Feld, Maskottchen-Kopf, Fortschritts-Karte,
 * Punkte-Karte, Story-Leiste, Kategorie-Spalten und fünf Regale – die erste
 * Aktivität lag unter dem sichtbaren Bereich. Ein Feed beantwortet genau EINE
 * Frage: „Was kann ich machen?". Alles andere ist entweder ausgeblendet (siehe
 * src/constants/features.ts) oder hat einen eigenen Ort bekommen: Erstellen ist
 * der ＋-Tab, „Meine Aktivitäten" und Gemerktes liegen im Profil.
 */

type FeedTab = 'for-you' | 'nearby' | 'today';

const FEED_TABS: { key: FeedTab; label: string }[] = [
  { key: 'for-you', label: 'Für dich' },
  { key: 'nearby', label: 'In der Nähe' },
  { key: 'today', label: 'Heute' },
];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const { user, token } = useAuth();
  const { settings } = useAppSettings();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [unreadChats, setUnreadChats] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<FeedTab>('for-you');
  const [filter, setFilter] = useState<ActivityFilter>(EMPTY_FILTER);
  const [searchOpen, setSearchOpen] = useState(false);

  const [selected, setSelected] = useState<Activity | null>(null);
  const [sharing, setSharing] = useState<Activity | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Minütlich, damit „Heute, 18:00" und „Läuft gerade" nicht stehen bleiben,
    // wenn die App offen liegt.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { nearbyIds, distanceById, hasLocation } = useNearbyActivities(activities, settings.useLocation);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [list, cats, chats] = await Promise.all([
        api.activities(token),
        api.interests().catch(() => null),
        api.chats(token).catch(() => null),
      ]);
      setActivities(list.data);
      if (cats) setInterests(cats.data);
      if (chats) setUnreadChats(chats.data.reduce((sum, c) => sum + (c.unread ?? 0), 0));
      setNow(new Date());
    } catch {
      setError('Die Aktivitäten konnten nicht geladen werden. Läuft das Backend?');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Einmal nach der Anmeldung: War das eingegebene Passwort schwach, sagen wir
      // es – genau dann, wenn es noch frisch im Kopf ist (src/lib/security-nudge.ts).
      if (takeWeakPasswordFlag()) {
        confirmAction(
          'Dein Passwort ist schwach',
          'Es ist leicht zu erraten. Weil in GÖ4Fun dein Konto und deine Daten dranhängen, lohnt sich ein stärkeres – dauert eine Minute.',
          'Jetzt ändern',
        ).then((ok) => {
          if (ok) router.push('/security/password');
        });
      }
    }, [load, router]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const profile = useMemo(
    () => ({
      interestIds: (user?.interests ?? []).map((i) => i.id),
      attendedInterestIds: activities.filter((a) => a.is_joined).flatMap((a) => a.interests.map((i) => i.id)),
    }),
    [user?.interests, activities],
  );

  /**
   * Was der Feed zeigt. Vergangenes fliegt überall raus – außer es läuft gerade
   * noch (dann steht „Läuft gerade" auf dem Bild). Drei Stunden nach Beginn gilt
   * ein Event als vorbei; genau diese Grenze kennt auch `urgencyFor`.
   */
  const feed = useMemo(() => {
    const cutoff = now.getTime() - 3 * 60 * 60 * 1000;
    const upcoming = activities.filter((a) => {
      if (a.is_permanent) return true;
      const at = Date.parse(a.starts_at ?? '');
      return !Number.isFinite(at) || at >= cutoff;
    });

    const windowed: ActivityFilter =
      tab === 'today' ? { ...filter, when: 'today' } : filter;
    const matching = filterActivities(upcoming, windowed, { now, distanceById });

    if (tab === 'nearby') {
      return matching
        .filter((a) => nearbyIds.has(a.id))
        .sort((a, b) => (distanceById.get(a.id) ?? Infinity) - (distanceById.get(b.id) ?? Infinity));
    }
    if (tab === 'today') {
      return [...matching].sort((a, b) => Date.parse(a.starts_at ?? '') - Date.parse(b.starts_at ?? ''));
    }
    return rankActivities(matching, profile, { now, distanceById });
  }, [activities, filter, tab, now, distanceById, nearbyIds, profile]);

  const replaceActivity = useCallback((updated: Activity) => {
    setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  const toggleJoin = useCallback(
    async (activity: Activity) => {
      if (!token) return;
      setBusyId(activity.id);
      try {
        const { data } = activity.is_joined
          ? await api.leaveActivity(token, activity.id)
          : await api.joinActivity(token, activity.id);
        if (activity.is_joined) feedback.left();
        else feedback.joined();
        replaceActivity(data);
      } catch (e) {
        await notifyUser('Hat nicht geklappt', e instanceof ApiError ? e.firstError() : 'Bitte versuch es gleich noch mal.');
      } finally {
        setBusyId(null);
      }
    },
    [token, replaceActivity],
  );

  const toggleSave = useCallback(
    async (activity: Activity) => {
      if (!token) return;
      feedback.selected();
      // Sofort umschalten, der Server bestätigt danach – ein Lesezeichen, das
      // erst nach einer Sekunde reagiert, fühlt sich kaputt an.
      replaceActivity({ ...activity, is_saved: !activity.is_saved });
      try {
        const { data } = activity.is_saved
          ? await api.unsaveActivity(token, activity.id)
          : await api.saveActivity(token, activity.id);
        replaceActivity(data);
      } catch {
        replaceActivity(activity);
      }
    },
    [token, replaceActivity],
  );

  const openChat = useCallback(
    (activity: Activity) => {
      const own = activity.host?.id === user?.id;
      if (!activity.is_joined && !own) {
        notifyUser('Erst mitmachen', 'Den Chat einer Aktivität sehen alle, die dabei sind. Tipp auf „Mitmachen".');
        return;
      }
      router.push({ pathname: '/chat', params: { kind: 'activity', id: String(activity.id), title: activity.title } });
    },
    [router, user?.id],
  );

  const openHost = useCallback(
    (activity: Activity) => {
      const username = activity.host?.username;
      if (!username) return;
      if (activity.host?.id === user?.id) {
        router.navigate('/me');
      } else {
        router.push({ pathname: '/profile/[username]', params: { username } });
      }
    },
    [router, user?.id],
  );

  const toggleCategory = useCallback((id: number) => {
    feedback.selected();
    setFilter((prev) => ({
      ...prev,
      interestIds: prev.interestIds.includes(id) ? prev.interestIds.filter((x) => x !== id) : [...prev.interestIds, id],
    }));
  }, []);

  const chatBadge = unreadBadge(unreadChats);

  const header = (
    <View>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.one }]}>
        <BrandLogo size="small" />
        <View style={styles.topIcons}>
          <HeaderButton
            icon={searchOpen ? 'close' : 'search'}
            label={searchOpen ? 'Suche schließen' : 'Suchen und filtern'}
            active={searchOpen || isFilterActive(filter)}
            onPress={() => {
              if (searchOpen) setFilter(EMPTY_FILTER);
              setSearchOpen((v) => !v);
            }}
          />
          <HeaderButton
            icon="send"
            label={chatBadge ? `Chats, ${chatBadge} ungelesen` : 'Chats'}
            badge={chatBadge}
            onPress={() => router.push('/chats')}
          />
        </View>
      </View>

      <View style={[styles.tabs, { borderBottomColor: colors.backgroundSelected }]} accessibilityRole="tablist">
        {FEED_TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => {
                feedback.selected();
                setTab(t.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={styles.tab}>
              <Text
                style={[
                  styles.tabLabel,
                  { color: active ? colors.text : colors.textSecondary, fontFamily: active ? FontFamily.bold : FontFamily.medium },
                ]}>
                {t.label}
              </Text>
              <View style={[styles.tabLine, { backgroundColor: active ? colors.text : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>

      {searchOpen ? (
        <View style={styles.filter}>
          <ActivityFilterBar
            filter={filter}
            onChange={setFilter}
            interests={interests}
            resultCount={feed.length}
            distanceAvailable={hasLocation}
          />
        </View>
      ) : interests.length > 0 ? (
        <View style={styles.strip}>
          <CategoryStrip interests={interests} selectedIds={filter.interestIds} onToggle={toggleCategory} />
        </View>
      ) : null}
    </View>
  );

  return (
    <HomeBackground>
      <FlatList
        data={feed}
        keyExtractor={(a) => String(a.id)}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        style={styles.flex}
        renderItem={({ item }) => (
          <View style={styles.column}>
            <ActivityPost
              activity={item}
              now={now}
              distanceKm={distanceById.get(item.id) ?? null}
              isOwn={item.host?.id === user?.id}
              busy={busyId === item.id}
              onOpen={setSelected}
              onToggleJoin={toggleJoin}
              onToggleSave={toggleSave}
              onShare={setSharing}
              onChat={openChat}
              onOpenHost={item.host?.username ? openHost : undefined}
            />
          </View>
        )}
        ListEmptyComponent={
          loading ? null : error ? (
            <View style={styles.column}>
              <MascotError detail={error} onRetry={load} />
            </View>
          ) : (
            <FeedEmpty
              tab={tab}
              filtered={isFilterActive(filter)}
              hasLocation={hasLocation}
              onCreate={() => router.navigate('/create')}
              onReset={() => {
                setFilter(EMPTY_FILTER);
                setTab('for-you');
              }}
            />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />}
        initialNumToRender={3}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />

      <ActivityDetailModal
        activity={selected}
        onClose={() => setSelected(null)}
        onChanged={replaceActivity}
        distanceKm={selected ? distanceById.get(selected.id) ?? null : null}
      />
      <ShareSheet activity={sharing} onClose={() => setSharing(null)} />
    </HomeBackground>
  );
}

function HeaderButton({
  icon,
  label,
  badge,
  active,
  onPress,
}: {
  icon: 'search' | 'close' | 'send';
  label: string;
  badge?: string | null;
  active?: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={26} color={active ? colors.tint : colors.text} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.tint, borderColor: colors.background }]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: Spacing.six },
  column: { width: '100%', maxWidth: 620, alignSelf: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingRight: Spacing.two },
  headerButton: { padding: 2 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontSize: 10, fontFamily: FontFamily.bold },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { alignItems: 'center', paddingTop: Spacing.two, gap: Spacing.two },
  tabLabel: { fontSize: 15 },
  tabLine: { height: 2, width: 28, borderRadius: 1 },
  strip: { paddingVertical: Spacing.two },
  filter: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, maxWidth: 620, width: '100%', alignSelf: 'center' },
});
