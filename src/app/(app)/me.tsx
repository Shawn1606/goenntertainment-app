import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { HomeBackground } from '@/components/home-background';
import { StoryAvatar } from '@/components/story-avatar';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { type Activity, api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { pickImage } from '@/lib/pick-image';

/**
 * Das eigene Profil – gebaut wie ein Instagram-Profil.
 *
 *   @benutzername                         ＋  ≡
 *   (Bild)   12        3        8
 *            Erstellt Dabei    Freunde
 *   Name
 *   #Sport #Musik
 *   [ Profil bearbeiten ] [ Freunde finden ]
 *   ▦ Erstellt   ✓ Dabei   ⌑ Gemerkt
 *   ┌───┬───┬───┐
 *   │   │   │   │   Kacheln wie Instagram-Beiträge
 *
 * ## Was hier zusammengekommen ist
 *
 * Vorher waren das drei Orte: der Tab „Aktivitäten" (erstellt/dabei/Verlauf),
 * der Tab „Einstellungen" und das Konto-Blatt hinter dem Profilbild auf Home.
 * Instagram hat genau EINEN Ort für „ich": das Profil, mit dem Menü oben rechts.
 * Wer das kennt – und das tun fast alle –, sucht hier und findet es.
 */

type Tab = 'created' | 'joined' | 'saved';

const TABS: { key: Tab; icon: UiIconName; label: string }[] = [
  { key: 'created', icon: 'grid', label: 'Erstellt' },
  { key: 'joined', icon: 'check', label: 'Dabei' },
  { key: 'saved', icon: 'bookmark', label: 'Gemerkt' },
];

function startOf(activity: Activity): number {
  return activity.starts_at ? Date.parse(activity.starts_at) : 0;
}

/** Kommende zuerst (nächste oben), danach Vergangenes (jüngstes oben). */
function byRelevance(list: Activity[], now: number): Activity[] {
  const upcoming = list.filter((a) => a.is_permanent || startOf(a) >= now).sort((a, b) => startOf(a) - startOf(b));
  const past = list.filter((a) => !a.is_permanent && startOf(a) < now).sort((a, b) => startOf(b) - startOf(a));
  return [...upcoming, ...past];
}

export default function MeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const { user, token, applyUser } = useAuth();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [saved, setSaved] = useState<Activity[]>([]);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('created');
  const [selected, setSelected] = useState<Activity | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  /** „Jetzt“ für kommend/vorbei – beim Laden gesetzt, nicht bei jedem Zeichnen. */
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [list, marks, friends] = await Promise.all([
        api.activities(token),
        api.savedActivities(token).catch(() => null),
        api.friends(token).catch(() => null),
      ]);
      setActivities(list.data);
      if (marks) setSaved(marks.data);
      if (friends) setFriendCount(friends.friends.length);
      setNow(Date.now());
    } catch {
      // Das Profil selbst steht auch ohne Liste – leere Kacheln statt Fehlerwand.
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const { created, joined } = useMemo(() => {
    return {
      created: byRelevance(activities.filter((a) => a.host?.id === user?.id), now),
      joined: byRelevance(activities.filter((a) => a.is_joined && a.host?.id !== user?.id), now),
    };
  }, [activities, user?.id, now]);

  const shown = tab === 'created' ? created : tab === 'joined' ? joined : saved;

  const replaceActivity = useCallback((updated: Activity) => {
    setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSaved((prev) =>
      updated.is_saved === false ? prev.filter((a) => a.id !== updated.id) : prev.map((a) => (a.id === updated.id ? updated : a)),
    );
    setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  /** Nach dem Löschen im Detail-Blatt (das fragt selbst nach und prüft die Rechte). */
  const removeActivity = useCallback((id: number) => {
    setSelected(null);
    setActivities((prev) => prev.filter((a) => a.id !== id));
    setSaved((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const changeAvatar = useCallback(async () => {
    if (!token || avatarBusy) return;
    const picked = await pickImage('Profilbild', 'avatar', { aspect: [1, 1], shape: 'oval' });
    if (!picked) return;
    setAvatarBusy(true);
    try {
      const { user: updated } = await api.setProfileImage(token, 'avatar', picked);
      applyUser(updated);
      feedback.achieved();
    } catch (e) {
      await notifyUser('Profilbild', e instanceof ApiError ? e.firstError() : 'Das Bild konnte nicht gespeichert werden.');
    } finally {
      setAvatarBusy(false);
    }
  }, [token, avatarBusy, applyUser]);

  if (!user) return null;

  const tags = (user.interests ?? []).slice(0, 6).map((i) => `#${i.name.replace(/\s+/g, '')}`);

  return (
    <HomeBackground>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.one }]}>
        <Text style={[styles.handle, { color: colors.text }]} numberOfLines={1}>
          {user.username ? `@${user.username}` : user.name}
        </Text>
        <View style={styles.topIcons}>
          <IconButton icon="plus" label="Neue Aktivität" onPress={() => router.push('/create-activity')} />
          <IconButton icon="menu" label="Einstellungen" onPress={() => router.push('/settings')} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.tint}
          />
        }
        showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          <View style={styles.header}>
            <Pressable
              onPress={changeAvatar}
              accessibilityRole="button"
              accessibilityLabel="Profilbild ändern"
              style={styles.avatarWrap}>
              <StoryAvatar size={86} avatar={user.avatar} name={user.name} />
              <View style={[styles.avatarBadge, { backgroundColor: colors.tint, borderColor: colors.background }]}>
                {avatarBusy ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="plus" size={14} color="#fff" />}
              </View>
            </Pressable>
            <View style={styles.stats}>
              <Stat value={created.length} label="Erstellt" onPress={() => setTab('created')} />
              <Stat value={joined.length} label="Dabei" onPress={() => setTab('joined')} />
              <Stat value={friendCount} label="Freunde" onPress={() => router.navigate('/friends')} />
            </View>
          </View>

          <Text style={[styles.name, { color: colors.text }]}>{user.name}</Text>
          {tags.length > 0 ? (
            <Text style={[styles.tags, { color: colors.tint }]} numberOfLines={2}>
              {tags.join(' ')}
            </Text>
          ) : null}

          <View style={styles.buttons}>
            <ProfileButton label="Profil bearbeiten" onPress={() => router.push('/settings')} />
            <ProfileButton label="Freunde finden" onPress={() => router.navigate('/friends')} />
          </View>
        </View>

        <View style={[styles.tabs, { borderTopColor: colors.backgroundSelected }]} accessibilityRole="tablist">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => {
                  feedback.selected();
                  setTab(t.key);
                }}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: active }}
                style={[styles.tab, { borderTopColor: active ? colors.text : 'transparent' }]}>
                <Icon name={t.icon} size={22} color={active ? colors.text : colors.textSecondary} />
                <Text style={[styles.tabLabel, { color: active ? colors.text : colors.textSecondary }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.column}>
          {loading ? (
            <ActivityIndicator style={styles.loading} color={colors.tint} />
          ) : shown.length === 0 ? (
            <EmptyTab tab={tab} onCreate={() => router.push('/create-activity')} onExplore={() => router.navigate('/')} />
          ) : (
            <View style={styles.grid}>
              {shown.map((activity) => (
                <Tile key={activity.id} activity={activity} now={now} onPress={() => setSelected(activity)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <ActivityDetailModal
        activity={selected}
        onClose={() => setSelected(null)}
        onChanged={replaceActivity}
        onDeleted={removeActivity}
      />
    </HomeBackground>
  );
}

function Stat({ value, label, onPress }: { value: number | null; label: string; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.stat} accessibilityRole="button" accessibilityLabel={`${value ?? 0} ${label}`}>
      <Text style={[styles.statValue, { color: colors.text }]}>{value ?? '–'}</Text>
      <Text style={[styles.statLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function ProfileButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: colors.backgroundElement }, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.buttonLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function Tile({ activity, now, onPress }: { activity: Activity; now: number; onPress: () => void }) {
  const past = !activity.is_permanent && startOf(activity) < now - 3 * 60 * 60 * 1000;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${activity.title}${past ? ', vorbei' : ''}`}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
      {activity.banner_url ? (
        <Image source={{ uri: activity.banner_url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <LinearGradient colors={['#fe2c55', '#8134af']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.tileEmpty]}>
          <CategoryIcon interest={activity.interests[0]} size={30} color="rgba(255,255,255,0.95)" />
        </LinearGradient>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.tileShade} pointerEvents="none">
        <Text style={styles.tileTitle} numberOfLines={2}>
          {activity.title}
        </Text>
      </LinearGradient>
      {past ? (
        <View style={styles.pastBadge} pointerEvents="none">
          <Text style={styles.pastText}>Vorbei</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function EmptyTab({ tab, onCreate, onExplore }: { tab: Tab; onCreate: () => void; onExplore: () => void }) {
  const colors = useTheme();
  const copy = {
    created: {
      icon: 'plus-square' as UiIconName,
      title: 'Noch nichts erstellt',
      text: 'Deine Aktivitäten erscheinen hier – wie Beiträge auf einem Profil.',
      action: 'Erste Aktivität erstellen',
      onPress: onCreate,
    },
    joined: {
      icon: 'check' as UiIconName,
      title: 'Du bist noch nirgends dabei',
      text: 'Tipp im Feed auf „Mitmachen" – dann steht die Aktivität hier.',
      action: 'Zum Feed',
      onPress: onExplore,
    },
    saved: {
      icon: 'bookmark' as UiIconName,
      title: 'Nichts gemerkt',
      text: 'Mit dem Lesezeichen im Feed merkst du dir Aktivitäten, ohne gleich zuzusagen.',
      action: 'Zum Feed',
      onPress: onExplore,
    },
  }[tab];

  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { borderColor: colors.text }]}>
        <Icon name={copy.icon} size={34} color={colors.text} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{copy.title}</Text>
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{copy.text}</Text>
      <Pressable onPress={copy.onPress} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.emptyAction, { color: colors.tint }]}>{copy.action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  handle: { fontFamily: FontFamily.bold, fontSize: 22, flexShrink: 1 },
  topIcons: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  content: { paddingBottom: Spacing.six },
  column: { width: '100%', maxWidth: 620, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, gap: Spacing.four },
  avatarWrap: { position: 'relative' },
  avatarBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', minWidth: 64 },
  statValue: { fontFamily: FontFamily.bold, fontSize: 18 },
  statLabel: { fontFamily: FontFamily.regular, fontSize: 13 },
  name: { fontFamily: FontFamily.bold, fontSize: 15, paddingHorizontal: Spacing.three, marginTop: Spacing.three },
  tags: { fontFamily: FontFamily.medium, fontSize: 14, paddingHorizontal: Spacing.three, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, marginTop: Spacing.three },
  button: { flex: 1, borderRadius: Radius.field, paddingVertical: Spacing.two, alignItems: 'center' },
  buttonLabel: { fontFamily: FontFamily.semibold, fontSize: 14 },
  tabs: {
    flexDirection: 'row',
    marginTop: Spacing.four,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two + 2, borderTopWidth: 1.5, marginTop: -1, gap: 2 },
  tabLabel: { fontFamily: FontFamily.semibold, fontSize: 11 },
  loading: { marginTop: Spacing.five },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  tile: { width: '33%', flexGrow: 1, maxWidth: '33.4%', aspectRatio: 1, overflow: 'hidden', backgroundColor: '#222' },
  tileEmpty: { alignItems: 'center', justifyContent: 'center' },
  tileShade: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingTop: 18, paddingBottom: 6 },
  tileTitle: { color: '#fff', fontFamily: FontFamily.bold, fontSize: 12 },
  pastBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: Radius.chip,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pastText: { color: '#fff', fontFamily: FontFamily.semibold, fontSize: 10 },
  empty: { alignItems: 'center', paddingHorizontal: Spacing.five, paddingTop: Spacing.five, gap: Spacing.two },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 20, textAlign: 'center' },
  emptyText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyAction: { fontFamily: FontFamily.bold, fontSize: 15, marginTop: Spacing.two },
});
