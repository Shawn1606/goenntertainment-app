/**
 * Freunde und Gruppen.
 *
 * ## Was dieser Screen ist – und was nicht mehr
 *
 * Er steuert drei Listen (Anfragen, Freunde, Gruppen) und die Personensuche. Wie
 * eine Person, eine Gruppenkarte oder das Gruppen-Formular AUSSEHEN, steht nicht
 * mehr hier, sondern in `src/components/friends/`. Vorher waren es 778 Zeilen, in
 * denen ein `api.addGroupMember`-Aufruf mitten in einem `onPress` einer Pille
 * stand – das ließ sich weder ansehen noch an einer Stelle auf Fehler prüfen.
 *
 * Was hier bleibt, ist die Zuständigkeit, die ein Screen hat: laden, ändern,
 * Fehler anzeigen, navigieren.
 *
 * ## Die Suche ist eine PERSONEN-Suche
 *
 * Das ist der Unterschied zum Suchfeld der Startseite: Dort sucht man Events,
 * hier Leute. Beide Felder sehen gleich aus (`GlassSearchField`), führen aber zu
 * verschiedenen Dingen – deshalb steht die Personensuche hier und nicht als
 * zweiter Modus im Event-Filter. Ein Feld, das je nach Umschalter etwas anderes
 * durchsucht, ist die Sorte Cleverness, die man beim zweiten Benutzen nicht mehr
 * versteht.
 *
 * ## Warum Gruppen Freundschaften voraussetzen
 *
 * In eine Gruppe kommt nur, wer eine Freundschaft bestätigt hat. Sonst wäre
 * „Gruppe" der Weg, jemanden ohne Zustimmung in eine Liste zu ziehen – und seit
 * es Gruppen-Chats gibt, auch der Weg, ungefragt in fremden Nachrichten
 * aufzutauchen. Der Server prüft dieselbe Regel.
 *
 * ## Der Weg zu den Chats
 *
 * Oben rechts, mit der Zahl der ungelesenen Nachrichten. Die Chat-Übersicht ist
 * eine Stack-Route und kein Tab: Die untere Leiste fasst fünf Ziele und ist voll
 * (siehe `app-tabs.tsx`). Der Einstieg liegt hier, weil hier die Gruppen wohnen.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupCard } from '@/components/friends/group-card';
import { GroupForm } from '@/components/friends/group-form';
import { PersonRow } from '@/components/friends/person-row';
import { HomeBackground } from '@/components/home-background';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { TabMascot } from '@/components/tab-mascot';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassButton, GlassCard, GlassChip, GlassSearchField, SectionHeader } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { Segmented } from '@/components/ui/segmented';
import { BottomTabInset, FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { unreadBadge } from '@/domain/chat';
import { useBrandSurface } from '@/hooks/use-theme';
import { ApiError, api, type FriendGroup, type PersonCard } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';

/** Welche der beiden Listen offen ist. */
type Panel = 'friends' | 'groups';

/** Ab so vielen Zeichen fragt die Suche den Server – wie dort (`/api/users`). */
const MIN_QUERY = 2;

/** Welches Formular offen ist; `null` = keins. */
type FormState = { mode: 'create' } | { mode: 'rename'; group: FriendGroup } | null;

export default function FriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const { token, user } = useAuth();

  const [panel, setPanel] = useState<Panel>('friends');
  const [friends, setFriends] = useState<PersonCard[]>([]);
  const [incoming, setIncoming] = useState<PersonCard[]>([]);
  const [outgoing, setOutgoing] = useState<PersonCard[]>([]);
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suche. `results === null` heißt „es wurde nicht gesucht" und ist damit etwas
  // anderes als „nichts gefunden" – nur so lässt sich der Unterschied anzeigen.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonCard[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [form, setForm] = useState<FormState>(null);
  const [savingGroup, setSavingGroup] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [people, groupList] = await Promise.all([api.friends(token), api.groups(token)]);
      setFriends(people.friends);
      setIncoming(people.incoming);
      setOutgoing(people.outgoing);
      setGroups(groupList.data);
    } catch {
      setError('Freunde konnten nicht geladen werden. Läuft das Backend?');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    feedback.tapped();
    await load();
    setRefreshing(false);
  }, [load]);

  /**
   * Suchen auf Knopfdruck bzw. Enter – nicht bei jedem Zeichen.
   *
   * Bei jedem Zeichen zu suchen hieße, für „Alexandra" neun Anfragen zu stellen,
   * von denen acht verworfen werden. Ein Entprellen wäre die halbe Lösung; bei
   * einer Personensuche tippt man ohnehin einen Namen fertig, bevor man ihn
   * erwartet.
   */
  const runSearch = useCallback(
    async (term: string) => {
      if (!token) return;
      const trimmed = term.trim();
      if (trimmed.length < MIN_QUERY) {
        setResults(null);
        return;
      }
      setSearching(true);
      try {
        const res = await api.searchUsers(token, trimmed);
        setResults(res.data);
      } catch {
        setResults([]);
        setError('Die Suche hat nicht geantwortet.');
      } finally {
        setSearching(false);
      }
    },
    [token],
  );

  function clearSearch() {
    setQuery('');
    setResults(null);
  }

  /** Fehler aus einem API-Aufruf einheitlich anzeigen. */
  function reportError(err: unknown, fallback: string) {
    feedback.failed();
    setError(err instanceof ApiError ? err.firstError() : fallback);
  }

  /** Anfragen oder annehmen – derselbe Aufruf (siehe api.addFriend). */
  async function onAdd(person: PersonCard) {
    if (!token) return;
    try {
      const res = await api.addFriend(token, person.id);
      feedback.joined();
      // Den Zustand im Suchergebnis mitziehen, damit der Knopf sofort passt.
      setResults((prev) =>
        prev ? prev.map((row) => (row.id === person.id ? { ...row, friendship: res.status } : row)) : prev,
      );
      await load();
    } catch (err) {
      reportError(err, 'Das hat nicht geklappt.');
    }
  }

  async function onRemove(person: PersonCard, mode: 'friend' | 'request') {
    if (!token) return;
    if (mode === 'friend') {
      const ok = await confirmAction(
        'Freundschaft beenden',
        `${person.name} verschwindet aus deiner Liste – und aus deinen Gruppen.`,
        'Beenden',
        true,
      );
      if (!ok) return;
    }
    try {
      await api.removeFriend(token, person.id);
      feedback.left();
      setResults((prev) =>
        prev ? prev.map((row) => (row.id === person.id ? { ...row, friendship: 'none' } : row)) : prev,
      );
      await load();
    } catch (err) {
      reportError(err, 'Das hat nicht geklappt.');
    }
  }

  function openProfile(person: PersonCard) {
    if (!person.username) return;
    feedback.tapped();
    router.push({ pathname: '/profile/[username]', params: { username: person.username } });
  }

  function openChat(group: FriendGroup) {
    feedback.tapped();
    router.push({
      pathname: '/chat',
      params: { kind: 'group', id: String(group.id), title: group.name },
    });
  }

  /** Anlegen und Umbenennen laufen über dasselbe Formular (siehe GroupForm). */
  async function onSubmitGroup(name: string, members: number[]) {
    if (!token || !form || savingGroup) return;
    if (!name) {
      setError('Gib der Gruppe einen Namen.');
      return;
    }
    setSavingGroup(true);
    setError(null);
    try {
      if (form.mode === 'create') await api.createGroup(token, name, '', members);
      else await api.updateGroup(token, form.group.id, { name });
      feedback.joined();
      setForm(null);
      await load();
    } catch (err) {
      reportError(err, 'Die Gruppe konnte nicht gespeichert werden.');
    } finally {
      setSavingGroup(false);
    }
  }

  async function onAddMember(group: FriendGroup, person: PersonCard) {
    if (!token) return;
    try {
      const res = await api.addGroupMember(token, group.id, person.id);
      feedback.selected();
      setGroups((prev) => prev.map((row) => (row.id === group.id ? res.data : row)));
    } catch (err) {
      reportError(err, 'Aufnehmen hat nicht geklappt.');
    }
  }

  /**
   * Gruppe löschen (als Anlegende:r) oder verlassen (als Mitglied).
   *
   * Zwei Handlungen an einem Knopf, weil sie am selben Platz stehen und dasselbe
   * bedeuten: „Diese Gruppe ist für mich vorbei." Wer sie angelegt hat, kann nicht
   * einfach aussteigen – sonst bliebe sie führerlos zurück (der Server weist das
   * mit 422 ab).
   */
  async function onLeaveOrDelete(group: FriendGroup) {
    if (!token || !user) return;
    const ok = await confirmAction(
      group.is_owner ? 'Gruppe löschen' : 'Gruppe verlassen',
      group.is_owner
        ? `„${group.name}" wird für alle Mitglieder entfernt – samt Chat. Das lässt sich nicht rückgängig machen.`
        : `Du bist danach nicht mehr in „${group.name}" und siehst den Chat nicht mehr.`,
      group.is_owner ? 'Löschen' : 'Verlassen',
      true,
    );
    if (!ok) return;

    try {
      if (group.is_owner) await api.deleteGroup(token, group.id);
      // Sich selbst entfernen IST das Verlassen – dieselbe Route, eigene ID.
      else await api.removeGroupMember(token, group.id, user.id);
      await load();
    } catch (err) {
      reportError(err, 'Das hat nicht geklappt.');
    }
  }

  const segments = useMemo(
    () => [
      { value: 'friends' as const, label: 'Freunde', count: friends.length },
      { value: 'groups' as const, label: 'Gruppen', count: groups.length },
    ],
    [friends.length, groups.length],
  );

  /** Ungelesene über alle Gruppen – die Zahl am Chat-Knopf oben. */
  const unreadTotal = groups.reduce((sum, group) => sum + (group.unread ?? 0), 0);
  const chatBadge = unreadBadge(unreadTotal);

  /** Wonach die Figur oben klingt – der Zustand sagt mehr als der Tab-Satz. */
  const mascotLine =
    incoming.length > 0
      ? incoming.length === 1
        ? 'Eine Anfrage wartet auf dich.'
        : `${incoming.length} Anfragen warten auf dich.`
      : friends.length > 0
        ? undefined
        : 'Such nach Leuten, die du kennst.';

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={surface.accent}
            colors={[surface.accent]}
          />
        }>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.title}>Freunde</ThemedText>

            {/* Weg zu den Chats. Die Zahl steht dort, weil man sie sehen soll,
                ohne erst eine Gruppe zu öffnen. */}
            <Pressable
              onPress={() => {
                feedback.tapped();
                router.push('/chats');
              }}
              accessibilityRole="button"
              accessibilityLabel={
                chatBadge ? `Chats, ${unreadTotal} ungelesen` : 'Chats öffnen'
              }
              hitSlop={8}
              style={({ pressed }) => [
                styles.chatEntry,
                { borderColor: surface.chipBorder, backgroundColor: surface.chipBg },
                pressed && styles.pressed,
              ]}>
              <Icon name="chat" size={18} color={surface.accent} />
              <ThemedText type="smallBold" style={{ color: surface.accent }}>
                Chats
              </ThemedText>
              {chatBadge ? (
                <View style={[styles.badge, { backgroundColor: surface.accent }]}>
                  <ThemedText style={[styles.badgeText, { color: surface.accentText }]}>
                    {chatBadge}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          </View>

          <TabMascot tab="friends" line={mascotLine} />

          <GlassSearchField
            value={query}
            onChangeText={setQuery}
            onClear={clearSearch}
            onSubmitEditing={() => runSearch(query)}
            placeholder="Leute suchen: Name oder @Benutzername"
            accessibilityLabel="Leute suchen"
            autoCapitalize="none"
          />
          {query.trim().length >= MIN_QUERY ? (
            <Pressable onPress={() => runSearch(query)} accessibilityRole="button" hitSlop={6}>
              <ThemedText type="smallBold" style={{ color: surface.accent }}>
                {searching ? 'Sucht …' : `Nach „${query.trim()}" suchen`}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {error ? <MascotError detail={error} onRetry={loading ? undefined : load} /> : null}

        {/* Suchergebnisse verdrängen alles andere: Wer sucht, will Treffer sehen
            und nicht darunter noch seine Freundesliste. */}
        {results !== null ? (
          <View style={styles.section}>
            <SectionHeader
              title={`Treffer · ${results.length}`}
              action={
                <Pressable onPress={clearSearch} accessibilityRole="button" hitSlop={6}>
                  <ThemedText type="smallBold" style={{ color: surface.accent }}>
                    Zurück
                  </ThemedText>
                </Pressable>
              }
            />
            {results.length === 0 ? (
              <GlassCard tone="accent">
                <MascotEmpty mood="thinking" size={72}>
                  <ThemedText style={{ color: surface.text }}>Niemand gefunden.</ThemedText>
                  <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                    Prüf die Schreibweise – oder frag nach dem Benutzernamen.
                  </ThemedText>
                </MascotEmpty>
              </GlassCard>
            ) : (
              results.map((person, index) => (
                <Entrance key={person.id} index={index}>
                  <PersonRow
                    person={person}
                    onPress={() => openProfile(person)}
                    action={
                      <FriendAction
                        state={person.friendship ?? 'none'}
                        onAdd={() => onAdd(person)}
                        onCancel={() => onRemove(person, 'request')}
                      />
                    }
                  />
                </Entrance>
              ))
            )}
          </View>
        ) : (
          <>
            {/* Anfragen: immer oben, ohne Umschalter. */}
            {incoming.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={`Anfragen · ${incoming.length}`} />
                {incoming.map((person, index) => (
                  <Entrance key={person.id} index={index}>
                    <PersonRow
                      person={person}
                      onPress={() => openProfile(person)}
                      action={
                        <View style={styles.actionRow}>
                          <GlassChip label="Annehmen" selected onPress={() => onAdd(person)} />
                          <GlassChip label="Ablehnen" onPress={() => onRemove(person, 'request')} />
                        </View>
                      }
                    />
                  </Entrance>
                ))}
              </View>
            ) : null}

            <Segmented segments={segments} value={panel} onChange={setPanel} />

            {panel === 'friends' ? (
              <View style={styles.section}>
                {friends.length === 0 ? (
                  <GlassCard tone="accent">
                    <MascotEmpty mood="thinking" size={80}>
                      <ThemedText style={{ color: surface.text }}>Noch keine Freunde.</ThemedText>
                      <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                        Such oben nach einem Namen oder Benutzernamen und schick eine Anfrage.
                      </ThemedText>
                    </MascotEmpty>
                  </GlassCard>
                ) : (
                  friends.map((person, index) => (
                    <Entrance key={person.id} index={index}>
                      <PersonRow
                        person={person}
                        onPress={() => openProfile(person)}
                        action={
                          <Pressable
                            onPress={() => onRemove(person, 'friend')}
                            accessibilityRole="button"
                            accessibilityLabel={`Freundschaft mit ${person.name} beenden`}
                            hitSlop={8}
                            style={({ pressed }) => pressed && styles.pressed}>
                            <Icon name="close" size={18} color={surface.textMuted} />
                          </Pressable>
                        }
                      />
                    </Entrance>
                  ))
                )}

                {/* Eigene offene Anfragen zuletzt: Sie brauchen keine Handlung,
                    sollen aber nachlesbar sein, damit man nicht zweimal fragt. */}
                {outgoing.length > 0 ? (
                  <>
                    <SectionHeader title="Von dir angefragt" />
                    {outgoing.map((person) => (
                      <PersonRow
                        key={person.id}
                        person={person}
                        onPress={() => openProfile(person)}
                        action={
                          <GlassChip label="Zurückziehen" onPress={() => onRemove(person, 'request')} />
                        }
                      />
                    ))}
                  </>
                ) : null}
              </View>
            ) : (
              <View style={styles.section}>
                {form ? (
                  <GroupForm
                    mode={form.mode}
                    initialName={form.mode === 'rename' ? form.group.name : ''}
                    friends={friends}
                    saving={savingGroup}
                    onSubmit={onSubmitGroup}
                    onCancel={() => setForm(null)}
                  />
                ) : (
                  <GlassButton
                    title="Gruppe anlegen"
                    variant="primary"
                    onPress={() => {
                      feedback.pressed();
                      setForm({ mode: 'create' });
                    }}
                  />
                )}

                {groups.length === 0 && !form ? (
                  <GlassCard tone="accent">
                    {/* Winkt: Dieser Leerzustand ist eine Einladung, keine Meldung. */}
                    <MascotEmpty mood="cheer" size={80} gesture="wave">
                      <ThemedText style={{ color: surface.text }}>Noch keine Gruppe.</ThemedText>
                      <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                        Eine Gruppe ist eine feste Runde mit eigenem Chat – praktisch, wenn ihr euch
                        öfter trefft.
                      </ThemedText>
                    </MascotEmpty>
                  </GlassCard>
                ) : (
                  groups.map((group, index) => (
                    <Entrance key={group.id} index={index}>
                      <GroupCard
                        group={group}
                        friends={friends}
                        onOpenChat={() => openChat(group)}
                        onOpenProfile={openProfile}
                        onAddMember={(person) => onAddMember(group, person)}
                        onRename={() => {
                          feedback.pressed();
                          setForm({ mode: 'rename', group });
                        }}
                        onLeaveOrDelete={() => onLeaveOrDelete(group)}
                      />
                    </Entrance>
                  ))
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </HomeBackground>
  );
}

/** Der Knopf in der Suche – vier Zustände, vier Beschriftungen. */
function FriendAction({
  state,
  onAdd,
  onCancel,
}: {
  state: NonNullable<PersonCard['friendship']>;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const surface = useBrandSurface();

  if (state === 'friends') {
    return (
      <View style={styles.actionRow}>
        <Icon name="check" size={18} color={surface.accent} />
        <ThemedText type="small" style={{ color: surface.textMuted }}>
          Befreundet
        </ThemedText>
      </View>
    );
  }
  if (state === 'incoming') return <GlassChip label="Annehmen" selected onPress={onAdd} />;
  if (state === 'outgoing') return <GlassChip label="Angefragt" onPress={onCancel} />;
  return <GlassChip label="Anfragen" selected onPress={onAdd} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },
  header: { gap: Spacing.three },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  title: { fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  chatEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 999,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '800', fontFamily: FontFamily.bold },
  section: { gap: Spacing.two },
  centered: { textAlign: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pressed: { opacity: 0.7 },
});
