import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { ActivityFilterBar } from '@/components/activity-filter-bar';
import { BrandLogo } from '@/components/brand-logo';
import { CategoryStrip } from '@/components/category-strip';
import { ActivityPost } from '@/components/feed/activity-post';
import { EvergreenRail } from '@/components/feed/evergreen-rail';
import { FeedEmpty } from '@/components/feed/feed-empty';
import { HomeBackground } from '@/components/home-background';
import { MascotError } from '@/components/mascot';
import { ReportSheet } from '@/components/report-sheet';
import { ShareSheet } from '@/components/share-sheet';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { OptionsSheet, type SheetOption } from '@/components/ui/options-sheet';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { toggledLike } from '@/domain/activity-social';
import {
  activeFilterCount,
  EMPTY_FILTER,
  filterActivities,
  isFilterActive,
  type ActivityFilter,
} from '@/domain/activity-filter';
import { mixFeed, type FeedItem } from '@/domain/feed-mix';
import { firstName, greetingLine } from '@/domain/greeting';
import { explainMatch, rankActivities } from '@/domain/recommendations';
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
 *   Kopf:    GÖ4Fun-Schriftzug · Suche · Chats
 *   Reiter:  Für dich | In der Nähe | Heute
 *   Kacheln: Filter · Kategorien zum Antippen
 *   Feed:    eine Aktivität unter der anderen, jede wie ein Instagram-Post –
 *            im „Für dich"-Reiter mit dem Grund, warum sie vorgeschlagen wird,
 *            und zwischendurch einer Leiste „Jederzeit möglich" (Dauerangebote,
 *            siehe src/domain/feed-mix.ts)
 *
 * ## „Für dich" ist eine Vorschlags-Seite
 *
 * Die Reihenfolge kommt aus `rankActivities` (eigene Interessen, Nähe, bald,
 * Verlauf). Neu ist, dass der Feed das auch SAGT: „Für dich · Passt zu Sport"
 * steht über jedem Beitrag, der wegen eines Interesses oben steht. Ein
 * Vorschlag, dessen Grund man nicht kennt, wirkt zufällig; einer mit Grund wirkt
 * wie ein Tipp von jemandem, der einen kennt.
 *
 * ## Die Lupe öffnet die Suche
 *
 * Vorher klappte sie hier eine Filterleiste auf – und Leute fand man nur im
 * Freunde-Tab. Jetzt öffnet sie `/search` (Personen UND Aktivitäten, mit
 * Verlauf). Die Filter stehen als erste Kachel in der Kategorie-Reihe.
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
  const [filterOpen, setFilterOpen] = useState(false);

  const [selected, setSelected] = useState<Activity | null>(null);
  const [focusComments, setFocusComments] = useState(false);
  const [sharing, setSharing] = useState<Activity | null>(null);
  const [menuFor, setMenuFor] = useState<Activity | null>(null);
  const [reporting, setReporting] = useState<Activity | null>(null);
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
  const feed = useMemo<FeedItem<Activity>[]>(() => {
    const cutoff = now.getTime() - 3 * 60 * 60 * 1000;
    const upcoming = activities.filter((a) => {
      if (a.is_permanent) return true;
      const at = Date.parse(a.starts_at ?? '');
      return !Number.isFinite(at) || at >= cutoff;
    });

    const windowed: ActivityFilter = tab === 'today' ? { ...filter, when: 'today' } : filter;
    const matching = filterActivities(upcoming, windowed, { now, distanceById });
    const asPosts = (list: Activity[]): FeedItem<Activity>[] =>
      list.map((activity) => ({ kind: 'post', key: `post-${activity.id}`, activity }));

    if (tab === 'nearby') {
      return asPosts(
        matching
          .filter((a) => nearbyIds.has(a.id))
          .sort((a, b) => (distanceById.get(a.id) ?? Infinity) - (distanceById.get(b.id) ?? Infinity)),
      );
    }
    if (tab === 'today') {
      return asPosts(
        matching
          .filter((a) => !a.is_permanent)
          .sort((a, b) => Date.parse(a.starts_at ?? '') - Date.parse(b.starts_at ?? '')),
      );
    }
    // Für dich: nach Relevanz, Dauerangebote eingestreut statt oben gestapelt.
    return mixFeed(rankActivities(matching, profile, { now, distanceById }));
  }, [activities, filter, tab, now, distanceById, nearbyIds, profile]);

  const postCount = useMemo(() => feed.filter((i) => i.kind === 'post').length, [feed]);

  const replaceActivity = useCallback((updated: Activity) => {
    setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  const removeFromFeed = useCallback((id: number) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
    setSelected((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  const open = useCallback((activity: Activity) => {
    setFocusComments(false);
    setSelected(activity);
  }, []);

  const openComments = useCallback((activity: Activity) => {
    feedback.tapped();
    setFocusComments(true);
    setSelected(activity);
  }, []);

  const toggleJoin = useCallback(
    async (activity: Activity) => {
      if (!token) return;
      if (activity.is_joined) {
        const ok = await confirmAction(
          'Nicht mehr dabei sein?',
          'Dein Platz wird frei, und den Event-Chat siehst du danach nicht mehr.',
          'Austreten',
          true,
        );
        if (!ok) return;
      }
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

  const toggleLike = useCallback(
    async (activity: Activity) => {
      if (!token) return;
      // Gleiches Prinzip wie beim Merken: sofort umspringen, dann bestätigen
      // (siehe src/domain/activity-social.ts).
      replaceActivity(toggledLike(activity));
      try {
        const { data } = activity.liked_by_me
          ? await api.unlikeActivity(token, activity.id)
          : await api.likeActivity(token, activity.id);
        replaceActivity(data);
      } catch {
        replaceActivity(activity);
      }
    },
    [token, replaceActivity],
  );

  const deleteActivity = useCallback(
    async (activity: Activity) => {
      if (!token) return;
      const own = activity.host?.id === user?.id;
      const ok = await confirmAction(
        'Aktivität löschen',
        own
          ? `„${activity.title}" wirklich löschen? Alle, die dabei sind, verlieren ihren Platz.`
          : `„${activity.title}" von ${activity.host?.name ?? 'dieser Person'} als Admin löschen? Das lässt sich nicht rückgängig machen.`,
        'Löschen',
        true,
      );
      if (!ok) return;
      try {
        await api.deleteActivity(token, activity.id);
        feedback.left();
        removeFromFeed(activity.id);
      } catch (e) {
        await notifyUser('Löschen fehlgeschlagen', e instanceof ApiError ? e.firstError() : 'Bitte versuch es noch mal.');
      }
    },
    [token, user?.id, removeFromFeed],
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

  /** Die Optionen hinter „…" am Beitrag. Löschen: eigene – und als Admin alle. */
  const menuOptions = useMemo<SheetOption[]>(() => {
    const a = menuFor;
    if (!a) return [];
    const own = a.host?.id === user?.id;
    const options: SheetOption[] = [
      { key: 'open', label: 'Details ansehen', icon: 'info', onPress: () => open(a) },
      { key: 'share', label: 'Teilen', icon: 'share', onPress: () => setSharing(a) },
      {
        key: 'save',
        label: a.is_saved ? 'Nicht mehr merken' : 'Merken',
        icon: a.is_saved ? 'bookmark-filled' : 'bookmark',
        onPress: () => toggleSave(a),
      },
    ];
    if (a.host?.username && !own) {
      options.push({ key: 'host', label: `Profil von ${a.host.name}`, icon: 'user', onPress: () => openHost(a) });
    }
    if (!own) options.push({ key: 'report', label: 'Melden', icon: 'flag', destructive: true, onPress: () => setReporting(a) });
    if (own || user?.is_admin) {
      options.push({
        key: 'delete',
        label: own ? 'Aktivität löschen' : 'Als Admin löschen',
        icon: 'trash',
        destructive: true,
        onPress: () => deleteActivity(a),
      });
    }
    return options;
  }, [menuFor, user?.id, user?.is_admin, open, toggleSave, openHost, deleteActivity]);

  const reasonFor = useCallback(
    (activity: Activity) => (tab === 'for-you' && !activity.is_permanent ? explainMatch(activity, profile) : null),
    [tab, profile],
  );

  const chatBadge = unreadBadge(unreadChats);
  const greeting = greetingLine(now, firstName(user?.name));
  const filterCount = activeFilterCount(filter);

  const header = (
    <View>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.one }]}>
        <BrandLogo size="small" />
        <View style={styles.topIcons}>
          <IconButton
            icon="search"
            label="Suchen: Leute und Aktivitäten"
            onPress={() => {
              feedback.tapped();
              router.push('/search');
            }}
          />
          <IconButton
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
              <View style={[styles.tabLine, { backgroundColor: active ? colors.tint : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>

      {tab === 'for-you' && !isFilterActive(filter) ? (
        <View style={styles.greeting}>
          <Icon name={greeting.icon} size={16} color={colors.tint} />
          <Text style={[styles.greetingText, { color: colors.text }]} numberOfLines={1}>
            {greeting.text} – das passt gerade zu dir
          </Text>
        </View>
      ) : null}

      {interests.length > 0 ? (
        <View style={styles.strip}>
          <CategoryStrip
            interests={interests}
            selectedIds={filter.interestIds}
            onToggle={toggleCategory}
            onOpenFilter={() => {
              feedback.tapped();
              setFilterOpen((v) => !v);
            }}
            filterCount={filterCount}
          />
        </View>
      ) : null}

      {filterOpen ? (
        <View style={styles.filter}>
          <ActivityFilterBar
            filter={filter}
            onChange={setFilter}
            interests={interests}
            resultCount={postCount}
            distanceAvailable={hasLocation}
          />
          <Pressable
            onPress={() => {
              setFilter(EMPTY_FILTER);
              setFilterOpen(false);
            }}
            accessibilityRole="button"
            hitSlop={6}
            style={styles.filterClose}>
            <Text style={[styles.filterCloseText, { color: colors.tint }]}>
              {isFilterActive(filter) ? 'Filter zurücksetzen' : 'Filter schließen'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <HomeBackground>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        style={styles.flex}
        renderItem={({ item }) =>
          item.kind === 'evergreen' ? (
            <View style={styles.column}>
              <EvergreenRail activities={item.activities} distanceById={distanceById} onOpen={open} />
            </View>
          ) : (
            <View style={styles.column}>
              <ActivityPost
                activity={item.activity}
                now={now}
                distanceKm={distanceById.get(item.activity.id) ?? null}
                isOwn={item.activity.host?.id === user?.id}
                busy={busyId === item.activity.id}
                reason={reasonFor(item.activity)}
                onOpen={open}
                onOpenComments={openComments}
                onToggleJoin={toggleJoin}
                onToggleSave={toggleSave}
                onToggleLike={toggleLike}
                onShare={setSharing}
                onChat={openChat}
                onMore={setMenuFor}
                onOpenHost={item.activity.host?.username ? openHost : undefined}
              />
            </View>
          )
        }
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
        onDeleted={removeFromFeed}
        focusComments={focusComments}
        distanceKm={selected ? distanceById.get(selected.id) ?? null : null}
      />
      <OptionsSheet
        visible={menuFor !== null}
        title={menuFor?.title}
        options={menuOptions}
        onClose={() => setMenuFor(null)}
      />
      <ShareSheet activity={sharing} onClose={() => setSharing(null)} />
      <ReportSheet
        target={reporting ? { type: 'activity', id: reporting.id, label: reporting.title } : null}
        onClose={() => setReporting(null)}
      />
    </HomeBackground>
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
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { alignItems: 'center', paddingTop: Spacing.two, gap: Spacing.two },
  tabLabel: { fontSize: 15 },
  tabLine: { height: 3, width: 28, borderRadius: 2 },
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  greetingText: { fontFamily: FontFamily.semibold, fontSize: 14, flexShrink: 1 },
  strip: { paddingVertical: Spacing.three },
  filter: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    maxWidth: 620,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.two,
  },
  filterClose: { alignSelf: 'center', paddingVertical: Spacing.one },
  filterCloseText: { fontFamily: FontFamily.semibold, fontSize: 14 },
});
