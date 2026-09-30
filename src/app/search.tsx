import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { FriendAction } from '@/components/friends/friend-action';
import { HomeBackground } from '@/components/home-background';
import { MascotEmpty } from '@/components/mascot';
import { StoryAvatar } from '@/components/story-avatar';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { BackButton } from '@/components/ui/icon-button';
import { BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import { EMPTY_FILTER, filterActivities } from '@/domain/activity-filter';
import { formatEventWhen } from '@/domain/event-when';
import type { SearchHistoryEntry } from '@/domain/search-history';
import { useTheme } from '@/hooks/use-theme';
import { type Activity, type Interest, type PersonCard, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';
import { useSearchHistory } from '@/lib/search-history-store';

/**
 * Die Suche – Personen und Aktivitäten an einem Ort, mit Verlauf.
 *
 * ## Warum ein eigener Bildschirm
 *
 * Vorher gab es zwei halbe Suchen: ein Filterfeld auf der Startseite (nur
 * Aktivitäten) und ein Feld im Freunde-Tab (nur Personen, erst nach Enter). Wer
 * „Anna" suchte, musste wissen, in welchem Tab Anna wohnt. Jetzt öffnet die Lupe
 * auf der Startseite genau diesen Screen – wie bei Instagram und TikTok.
 *
 * ## Was man sieht
 *
 *  - **Ohne Eingabe:** „Zuletzt" – angetippte Personen, Aktivitäten und
 *    Suchbegriffe, jeweils mit × zum Entfernen. Gibt es noch keinen Verlauf,
 *    stehen dort Kategorien zum Stöbern, damit der Bildschirm nie leer ist.
 *  - **Beim Tippen:** Treffer sofort. Aktivitäten filtert die App selbst (sie hat
 *    die Liste schon); Personen fragt sie nach einer kurzen Pause beim Server an –
 *    sonst wären es für „Alexandra" neun Anfragen, von denen acht verworfen werden.
 *
 * `scope=people` (aus dem Freunde-Tab) zeigt nur Personen.
 */

/** Ab so vielen Zeichen fragt die Personensuche den Server – wie dort (`/api/users`). */
const MIN_PEOPLE_QUERY = 2;
/** Pause nach dem letzten Tastendruck, bevor gesucht wird. */
const DEBOUNCE_MS = 280;
/** Vergangenes nicht als Treffer – dieselbe Grenze wie im Feed. */
const PAST_CUTOFF_MS = 3 * 60 * 60 * 1000;

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useTheme();
  const { token, user } = useAuth();
  const params = useLocalSearchParams<{ scope?: string }>();
  const peopleOnly = params.scope === 'people';

  const { history, add, remove, clear } = useSearchHistory(user?.id);

  const [query, setQuery] = useState('');
  /** Treffer samt dem Begriff, für den sie gelten – daraus folgt auch „sucht noch". */
  const [peopleResult, setPeopleResult] = useState<{ q: string; list: PersonCard[] } | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<Activity | null>(null);
  const inputRef = useRef<TextInput>(null);

  const trimmed = query.trim();

  // Die Aktivitäten einmal holen – gefiltert wird dann ohne Server.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    if (!peopleOnly) {
      api
        .activities(token)
        .then((res) => alive && setActivities(res.data))
        .catch(() => {});
    }
    api
      .interests()
      .then((res) => alive && setInterests(res.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, peopleOnly]);

  // Personensuche mit kurzer Pause nach dem Tippen. Die Rückgabe räumt die
  // alte Anfrage ab, damit eine langsame Antwort auf „Ann" nicht die schnellere
  // auf „Anna" überschreibt.
  useEffect(() => {
    if (!token || trimmed.length < MIN_PEOPLE_QUERY) return;
    let alive = true;
    const timer = setTimeout(() => {
      api
        .searchUsers(token, trimmed)
        .then((res) => alive && setPeopleResult({ q: trimmed, list: res.data }))
        .catch(() => alive && setPeopleResult({ q: trimmed, list: [] }));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, trimmed]);

  const peopleQuery = trimmed.length >= MIN_PEOPLE_QUERY;
  const people = peopleQuery && peopleResult?.q === trimmed ? peopleResult.list : null;
  const searchingPeople = peopleQuery && people === null;
  const setPeople = (next: (prev: PersonCard[] | null) => PersonCard[] | null) =>
    setPeopleResult((prev) => {
      if (!prev) return prev;
      const list = next(prev.list);
      return list ? { ...prev, list } : prev;
    });

  const activityHits = useMemo(() => {
    if (peopleOnly || trimmed.length === 0) return [];
    const now = new Date();
    const cutoff = now.getTime() - PAST_CUTOFF_MS;
    const upcoming = activities.filter((a) => {
      if (a.is_permanent) return true;
      const at = Date.parse(a.starts_at ?? '');
      return !Number.isFinite(at) || at >= cutoff;
    });
    const hostNeedle = trimmed.toLowerCase().replace(/^@/, '');
    const byText = filterActivities(upcoming, { ...EMPTY_FILTER, query: trimmed }, { now });
    // Auch über den Namen der Veranstalter:in finden – „was macht Anna so?".
    const byHost = upcoming.filter(
      (a) =>
        !byText.includes(a) &&
        (a.host?.name.toLowerCase().includes(hostNeedle) || a.host?.username?.toLowerCase().includes(hostNeedle)),
    );
    return [...byText, ...byHost].slice(0, 20);
  }, [activities, trimmed, peopleOnly]);

  const openPerson = useCallback(
    (person: { id: number; name: string; username: string | null; avatar: string | null }) => {
      feedback.tapped();
      add({ kind: 'person', id: person.id, name: person.name, username: person.username, avatar: person.avatar });
      if (!person.username) return;
      if (person.id === user?.id) router.navigate('/me');
      else router.push({ pathname: '/profile/[username]', params: { username: person.username } });
    },
    [add, router, user?.id],
  );

  const openActivity = useCallback(
    (activity: Activity) => {
      feedback.opened();
      add({ kind: 'activity', id: activity.id, title: activity.title, banner_url: activity.banner_url });
      setSelected(activity);
    },
    [add],
  );

  /** Ein Verlaufs-Eintrag wird wieder, was er war. */
  const openHistory = useCallback(
    async (entry: SearchHistoryEntry) => {
      if (entry.kind === 'query') {
        feedback.selected();
        setQuery(entry.text);
        add(entry);
        return;
      }
      if (entry.kind === 'person') {
        openPerson(entry);
        return;
      }
      const known = activities.find((a) => a.id === entry.id);
      if (known) {
        openActivity(known);
        return;
      }
      if (!token) return;
      try {
        const res = await api.activity(token, entry.id);
        openActivity(res.data);
      } catch {
        // Gelöscht oder nicht mehr sichtbar: Dann gehört der Eintrag nicht mehr
        // in den Verlauf – sonst tippt man immer wieder ins Leere.
        remove(entry);
      }
    },
    [activities, add, openActivity, openPerson, remove, token],
  );

  async function onAddFriend(person: PersonCard) {
    if (!token) return;
    try {
      const res = await api.addFriend(token, person.id);
      feedback.joined();
      setPeople((prev) => prev?.map((p) => (p.id === person.id ? { ...p, friendship: res.status } : p)) ?? prev);
    } catch {
      feedback.failed();
    }
  }

  async function onCancelFriend(person: PersonCard) {
    if (!token) return;
    try {
      await api.removeFriend(token, person.id);
      feedback.left();
      setPeople((prev) => prev?.map((p) => (p.id === person.id ? { ...p, friendship: 'none' } : p)) ?? prev);
    } catch {
      feedback.failed();
    }
  }

  const showResults = trimmed.length > 0;
  const peopleVisible = people ?? [];
  const nothingFound =
    showResults &&
    !searchingPeople &&
    activityHits.length === 0 &&
    (trimmed.length < MIN_PEOPLE_QUERY || peopleVisible.length === 0);

  return (
    <HomeBackground>
      <View style={[styles.top, { paddingTop: insets.top + Spacing.one }]}>
        <BackButton />
        <View style={[styles.field, { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected }]}>
          <Icon name="search" size={18} color={colors.textSecondary} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => trimmed && add({ kind: 'query', text: trimmed })}
            placeholder={peopleOnly ? 'Name oder @Benutzername' : 'Leute, Aktivitäten, Orte …'}
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={peopleOnly ? 'Leute suchen' : 'Suchen'}
            style={[styles.input, { color: colors.text }]}
          />
          {query ? (
            <Pressable
              onPress={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Eingabe leeren">
              <View style={[styles.clear, { backgroundColor: colors.textSecondary }]}>
                <Icon name="close" size={11} color={colors.background} />
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}>
        {!showResults ? (
          <>
            {history.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Zuletzt gesucht</Text>
                  <Pressable onPress={clear} hitSlop={8} accessibilityRole="button">
                    <Text style={[styles.sectionAction, { color: colors.tint }]}>Alle löschen</Text>
                  </Pressable>
                </View>
                {history.map((entry) => (
                  <HistoryRow
                    key={entry.kind === 'query' ? `q-${entry.text}` : `${entry.kind}-${entry.id}`}
                    entry={entry}
                    onPress={() => openHistory(entry)}
                    onRemove={() => remove(entry)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.hint}>
                <MascotEmpty mood="idle" size={76} gesture="look">
                  <Text style={[styles.hintTitle, { color: colors.text }]}>
                    {peopleOnly ? 'Wen suchst du?' : 'Wonach suchst du?'}
                  </Text>
                  <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                    {peopleOnly
                      ? 'Tipp einen Namen oder @Benutzernamen. Wen du antippst, findest du hier beim nächsten Mal wieder.'
                      : 'Leute, Aktivitäten, Orte oder Kategorien. Was du antippst, steht hier beim nächsten Mal unter „Zuletzt".'}
                  </Text>
                </MascotEmpty>
              </View>
            )}

            {!peopleOnly && interests.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Entdecken</Text>
                <View style={styles.chips}>
                  {interests.slice(0, 12).map((interest) => (
                    <Pressable
                      key={interest.id}
                      onPress={() => {
                        feedback.selected();
                        setQuery(interest.name);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Nach ${interest.name} suchen`}
                      style={({ pressed }) => [
                        styles.chip,
                        { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected },
                        pressed && styles.pressed,
                      ]}>
                      <CategoryIcon interest={interest} size={16} color={colors.tint} />
                      <Text style={[styles.chipText, { color: colors.text }]}>{interest.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <>
            {trimmed.length >= MIN_PEOPLE_QUERY ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Personen</Text>
                  {searchingPeople ? <ActivityIndicator size="small" color={colors.tint} /> : null}
                </View>
                {peopleVisible.map((person) => (
                  // Zeile und Freundschafts-Knopf nebeneinander statt ineinander:
                  // Ein Knopf in einem Knopf ist im Web ungültiges HTML, und der
                  // innere Tipp löste sonst zusätzlich den äußeren aus.
                  <View key={person.id} style={styles.row}>
                    <Pressable
                      onPress={() => openPerson(person)}
                      accessibilityRole="button"
                      accessibilityLabel={`Profil von ${person.name}`}
                      style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
                      <StoryAvatar size={46} avatar={person.avatar} name={person.name} />
                      <View style={styles.rowText}>
                        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                          {person.name}
                        </Text>
                        {person.username ? (
                          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
                            @{person.username}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    <FriendAction
                      state={person.friendship ?? 'none'}
                      onAdd={() => onAddFriend(person)}
                      onCancel={() => onCancelFriend(person)}
                    />
                  </View>
                ))}
                {!searchingPeople && people !== null && peopleVisible.length === 0 ? (
                  <Text style={[styles.none, { color: colors.textSecondary }]}>Niemand mit diesem Namen.</Text>
                ) : null}
              </View>
            ) : null}

            {!peopleOnly && activityHits.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Aktivitäten</Text>
                {activityHits.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} onPress={() => openActivity(activity)} />
                ))}
              </View>
            ) : null}

            {nothingFound ? (
              <View style={styles.hint}>
                <MascotEmpty mood="thinking" size={76}>
                  <Text style={[styles.hintTitle, { color: colors.text }]}>Nichts gefunden</Text>
                  <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                    Prüf die Schreibweise – oder versuch es mit einem Ort oder einer Kategorie.
                  </Text>
                </MascotEmpty>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <ActivityDetailModal
        activity={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated) => setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
        onDeleted={(id) => {
          setSelected(null);
          setActivities((prev) => prev.filter((a) => a.id !== id));
        }}
      />
    </HomeBackground>
  );
}

function HistoryRow({
  entry,
  onPress,
  onRemove,
}: {
  entry: SearchHistoryEntry;
  onPress: () => void;
  onRemove: () => void;
}) {
  const colors = useTheme();
  const title = entry.kind === 'person' ? entry.name : entry.kind === 'activity' ? entry.title : entry.text;
  const sub =
    entry.kind === 'person' ? (entry.username ? `@${entry.username}` : 'Person') : entry.kind === 'activity' ? 'Aktivität' : 'Suche';

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${sub}`}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        {entry.kind === 'person' ? (
          <StoryAvatar size={46} avatar={entry.avatar} name={entry.name} />
        ) : entry.kind === 'activity' ? (
          <Thumb uri={entry.banner_url} />
        ) : (
          <View style={[styles.roundIcon, { borderColor: colors.backgroundSelected }]}>
            <Icon name="history" size={20} color={colors.text} />
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {sub}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onRemove}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`${title} aus dem Verlauf entfernen`}
        style={({ pressed }) => pressed && styles.pressed}>
        <Icon name="close" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function ActivityRow({ activity, onPress }: { activity: Activity; onPress: () => void }) {
  const colors = useTheme();
  const when = formatEventWhen(activity.starts_at, new Date(), { permanent: activity.is_permanent });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${activity.title} öffnen`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Thumb uri={activity.banner_url} interest={activity.interests[0]} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {activity.title}
        </Text>
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {when}
          {activity.location ? ` · ${activity.location}` : ''}
        </Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

/** Kleines Vorschaubild einer Aktivität – ohne Foto im Markenverlauf. */
function Thumb({ uri, interest }: { uri: string | null; interest?: Interest }) {
  return (
    <View style={styles.thumb}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.thumbEmpty]}>
          <CategoryIcon interest={interest} size={20} color="#ffffff" />
        </LinearGradient>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  input: { flex: 1, fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 0 },
  clear: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: Spacing.three,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    gap: Spacing.four,
    paddingTop: Spacing.two,
  },
  section: { gap: Spacing.one },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.one },
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  sectionAction: { fontFamily: FontFamily.semibold, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontFamily: FontFamily.semibold, fontSize: 15 },
  rowSub: { fontFamily: FontFamily.regular, fontSize: 13 },
  roundIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 46, height: 46, borderRadius: Radius.card, overflow: 'hidden' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 14 },
  none: { fontFamily: FontFamily.regular, fontSize: 14, paddingVertical: Spacing.two },
  hint: { paddingTop: Spacing.four },
  hintTitle: { fontFamily: FontFamily.bold, fontSize: 18, textAlign: 'center' },
  hintText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
