import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountSheet, AccountWidget } from '@/components/account-widget';
import { ActivityCard } from '@/components/activity-card';
import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { ActivityFilterBar } from '@/components/activity-filter-bar';
import { ActivityShelf } from '@/components/activity-shelf';
import { BrandLogo } from '@/components/brand-logo';
import { CategoryStrip } from '@/components/category-strip';
import { HomeBackground } from '@/components/home-background';
import { MascotError } from '@/components/mascot';
import { RewardsCard } from '@/components/rewards-card';
import { StoryRail } from '@/components/story-rail';
import { StoryViewer } from '@/components/story-viewer';
import { TabMascot } from '@/components/tab-mascot';
import { ThemedText } from '@/components/themed-text';
import { UpgradeChip } from '@/components/upgrade-chip';
import { CountUp } from '@/components/ui/count-up';
import { Entrance } from '@/components/ui/entrance';
import { GlassCard, GlassProgressBar, GlassSurface, SectionHeader } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { Glow, Pulse } from '@/components/ui/glow';
import { PressableScale } from '@/components/ui/pressable-scale';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { accountAbilities } from '@/domain/account';
import { EMPTY_FILTER, filterActivities, isFilterActive, type ActivityFilter } from '@/domain/activity-filter';
import { levelFor, xpFor } from '@/domain/gamification';
import { greetingLine } from '@/domain/greeting';
import { rankActivities } from '@/domain/recommendations';
import { urgencyFor } from '@/domain/urgency';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import {
  type Activity,
  type Interest,
  type ProgressStats,
  type RewardTotals,
  type Story,
  api,
} from '@/lib/api';
import { useAppSettings } from '@/lib/app-settings';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useNearbyActivities } from '@/lib/use-nearby-activities';

export default function HomeScreen() {
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [loading, setLoading] = useState(true);
  /** Nur für das Herunterziehen – trennt „lädt zum ersten Mal" von „lädt neu". */
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>(EMPTY_FILTER);
  /**
   * Ob Suchfeld und Filter aufgeklappt sind.
   *
   * Zu als Standard: Die Startseite ist zum Stöbern da, nicht zum Suchen. Wer ein
   * bestimmtes Event sucht, weiß das und tippt einmal – wer nur schauen will,
   * bekommt dafür vier Regale mehr auf dem ersten Bild.
   */
  const [searchOpen, setSearchOpen] = useState(false);

  // Prämien: nur der Stand, der Katalog steht auf `/rewards`.
  const [points, setPoints] = useState<RewardTotals | null>(null);
  const [redeemedCount, setRedeemedCount] = useState(0);

  // Storys und der Betrachter darüber. `storyIndex === null` = geschlossen.
  const [stories, setStories] = useState<Story[]>([]);
  const [canPublishStory, setCanPublishStory] = useState(false);
  const [storyIndex, setStoryIndex] = useState<number | null>(null);

  // Angetippte Activity → Detail-Popup. `null` = geschlossen.
  const [selected, setSelected] = useState<Activity | null>(null);
  // Konto-Blatt. Der Zustand liegt hier und nicht im Widget, weil das Blatt als
  // Kind DIESES Bildschirms hängen muss: Nur so liegt sein Weichzeichner im
  // selben Fenster wie die Startseite und kann sie überhaupt weichzeichnen.
  const [accountOpen, setAccountOpen] = useState(false);

  // Standort + Entfernungen; erweitert den Umkreis selbst, wenn nichts los ist.
  // Der Schalter aus den Einstellungen entscheidet, ob überhaupt gefragt wird.
  const { settings } = useAppSettings();
  const { nearbyIds, distanceById, radiusKm, expanded, resolving: nearbyResolving, hasLocation } =
    useNearbyActivities(activities, settings.useLocation);

  const profile = useMemo(
    () => ({
      interestIds: (user?.interests ?? []).map((i) => i.id),
      // Kategorien, bei denen man schon mitgemacht hat – Grundlage für „mehr davon".
      attendedInterestIds: activities
        .filter((a) => a.is_joined)
        .flatMap((a) => a.interests.map((i) => i.id)),
    }),
    [user?.interests, activities],
  );

  const filterOn = isFilterActive(filter);

  /**
   * Ein gemeinsames „jetzt" für den ganzen Bildschirm, das jede Minute nachrückt.
   *
   * Zwei Gründe: Erstens rechnen sonst Filter, Empfehlungen und jede einzelne
   * Karte mit ihrer eigenen Millisekunde – zwei Events mit gleichem Start können
   * dann unterschiedliche Texte tragen. Zweitens muss „in 3 Min" von selbst zu
   * „Läuft jetzt" werden; ohne Ticken bliebe die Startseite stehen, solange man
   * sie offen hat, und genau das fällt auf.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /** Treffer der Suche – immer berechnet, damit die Trefferzahl live stimmt. */
  const results = useMemo(
    () => filterActivities(activities, filter, { now, distanceById }),
    [activities, filter, distanceById, now],
  );

  /** Die Regale (nur ohne aktiven Filter sichtbar). */
  const grouped = useMemo(() => {
    const recommended = rankActivities(activities, profile, { now, distanceById }).slice(0, 12);
    const recommendedIds = new Set(recommended.map((a) => a.id));
    const nearby = activities.filter((a) => nearbyIds.has(a.id));
    const other = activities.filter((a) => !(recommendedIds.has(a.id) && nearbyIds.has(a.id)));

    // „Jetzt oder gleich": läuft gerade oder startet in den nächsten Stunden.
    // Das ist das einzige Regal, bei dem die Uhr die Reihenfolge bestimmt – hier
    // ist Nähe am Start wichtiger als Passung zum Profil.
    const live = activities
      .map((activity) => ({ activity, urgency: urgencyFor(activity, now) }))
      .filter(({ urgency }) => urgency.tone === 'live' || urgency.tone === 'soon')
      .sort((a, b) => {
        // Laufende zuerst, danach nach Startzeit.
        if (a.urgency.tone !== b.urgency.tone) return a.urgency.tone === 'live' ? -1 : 1;
        return (
          new Date(a.activity.starts_at ?? 0).getTime() - new Date(b.activity.starts_at ?? 0).getTime()
        );
      })
      .map(({ activity }) => activity);

    /**
     * Die Merkliste.
     *
     * Kommt ohne eigenen Aufruf zustande: `is_saved` liegt an jedem Event, das
     * `/api/activities` liefert. Ein zweiter Abruf auf `/activities/saved` wäre
     * hier eine Anfrage für Daten, die schon da sind – der Endpunkt existiert für
     * den Fall, dass die Merkliste einmal ihren eigenen Screen bekommt.
     *
     * Zuletzt Gemerktes zuerst ist NICHT möglich, ohne den Zeitpunkt mitzuliefern;
     * sortiert wird deshalb wie überall nach Startzeit. Das ist hier ohnehin die
     * nützlichere Reihenfolge: Was zuerst stattfindet, muss zuerst entschieden
     * werden.
     */
    const saved = activities.filter((activity) => activity.is_saved);

    return { recommended, nearby, other, live, saved };
  }, [activities, profile, distanceById, nearbyIds, now]);

  const level = useMemo(
    () => levelFor(stats ? xpFor(stats) : 0),
    [stats],
  );

  const greeting = useMemo(() => greetingLine(now, user?.name), [now, user?.name]);

  /** Kategorie an-/abwählen – gleiche Quelle wie die Filterleiste. */
  const toggleCategory = useCallback((id: number) => {
    // Auswahl darf man fühlen: Ohne Rückmeldung tippt man im Zweifel nochmal
    // und wählt die Kategorie damit gleich wieder ab.
    feedback.selected();
    setFilter((prev) => ({
      ...prev,
      interestIds: prev.interestIds.includes(id)
        ? prev.interestIds.filter((x) => x !== id)
        : [...prev.interestIds, id],
    }));
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      // Nur die Aktivitäten dürfen den Bildschirm scheitern lassen – sie SIND die
      // Startseite. Fortschritt, Prämien und Storys sind Beigaben: Fällt eine aus,
      // fehlt eine Karte, aber die Liste steht. Deshalb fangen die drei ihre
      // Fehler selbst.
      const [list, progress, rewards, storyList] = await Promise.all([
        api.activities(token),
        api.progress(token).catch(() => null),
        api.rewards(token).catch(() => null),
        api.stories(token).catch(() => null),
      ]);

      setActivities(list.data);
      if (progress) setStats(progress.stats);
      if (rewards) {
        setPoints(rewards.points);
        setRedeemedCount(rewards.redemptions.length);
      }
      if (storyList) {
        setStories(storyList.data);
        setCanPublishStory(storyList.can_publish);
      }
      // Ein frisches „jetzt" nach dem Laden: Sonst rechnen „Läuft jetzt" und
      // „in 3 Min" noch mit dem Stand von vor dem Abruf.
      setNow(new Date());
    } catch {
      setError('Aktivitäten konnten nicht geladen werden. Läuft das Backend?');
    } finally {
      setLoading(false);
    }
  }, [token]);

  /**
   * Herunterziehen zum Aktualisieren.
   *
   * Fehlte bisher – und zwar an der einen Stelle, an der jede:r es zuerst
   * versucht. Eine Liste, die auf das Ziehen nicht reagiert, fühlt sich schlicht
   * kaputt an, selbst wenn sie beim nächsten Fokus ohnehin neu lädt.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    feedback.tapped();
    await load();
    setRefreshing(false);
  }, [load]);

  // Kategorien einmalig für die Filterleiste laden.
  useEffect(() => {
    let alive = true;
    api
      .interests()
      .then((res) => alive && setInterests(res.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Bei jedem Fokus neu laden – so erscheint eine neu erstellte Activity sofort.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Nach Beitreten/Verlassen im Popup: Liste + offenes Popup aktualisieren.
  const handleChanged = useCallback((updated: Activity) => {
    setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  // Admin: Event löschen (mit Rückfrage).
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

  const onPress = useCallback((activity: Activity) => setSelected(activity), []);
  const onDelete = user?.is_admin ? handleDelete : undefined;

  /**
   * Story als gesehen melden.
   *
   * Der Ring wird SOFORT grau, ohne auf den Server zu warten: Das Ansehen ist
   * schon passiert, und ein Ring, der erst eine Netzwerk-Runde später umschaltet,
   * fühlt sich an, als hätte der Tipp nicht gezählt. Scheitert der Aufruf, steht
   * die Story beim nächsten Laden wieder als ungesehen da – das ist der
   * harmloseste denkbare Fehlerfall.
   */
  const handleStorySeen = useCallback(
    (story: Story) => {
      setStories((prev) =>
        prev.map((item) => (item.id === story.id ? { ...item, seen: true } : item)),
      );
      if (token) api.viewStory(token, story.id).catch(() => {});
    },
    [token],
  );

  const handleStoryDelete = useCallback(
    async (story: Story) => {
      if (!token) return;
      const ok = await confirmAction(
        'Story löschen',
        'Die Story verschwindet sofort für alle.',
        'Löschen',
        true,
      );
      if (!ok) return;
      // Erst schließen: Der Betrachter zeigt gerade genau diese Story.
      setStoryIndex(null);
      try {
        await api.deleteStory(token, story.id);
        setStories((prev) => prev.filter((item) => item.id !== story.id));
      } catch {
        setError('Die Story ließ sich nicht löschen.');
      }
    },
    [token],
  );

  // Events erstellen gibt es ab dem Creator-Konto. Der ＋-Knopf verschwindet
  // für Standard-Konten ganz – ein Knopf, der nur zum Server läuft, um dort ein
  // 403 zu holen, ist kein Angebot, sondern eine Falle. Der Server prüft
  // dieselbe Regel (server/src/accounts.js).
  const canCreate = accountAbilities(user).canCreateActivities;

  /**
   * Ab Creator führt der Konto-Knopf oben rechts auf die eigene Profilseite –
   * für Standard-Konten gibt es keine, dort öffnet weiterhin das Konto-Blatt.
   * Einstellungen, Admin und Abmelden bleiben in beiden Fällen erreichbar: auf
   * dem Profil über das Zahnrad, das dasselbe Blatt öffnet.
   */
  const profilePath: Href | null =
    accountAbilities(user).hasPublicProfile && user?.username
      ? { pathname: '/profile/[username]', params: { username: user.username } }
      : null;

  /** Was am Ende eines leeren Regals steht – je nachdem, ob man erstellen darf. */
  const createHint = canCreate
    ? 'Erstelle mit ＋ das erste Event!'
    : 'Für eigene Events brauchst du ein Creator-Konto – tippe oben links auf „Upgrade".';

  /**
   * Was Goenni auf der Startseite sagt.
   *
   * Der Satz aus der Tabelle ist die Grundstellung; läuft gerade etwas, sagt die
   * Figur das stattdessen. Das ist der Unterschied zwischen einer Begrüßung und
   * einer Reaktion – und Reaktion war der Punkt.
   */
  const mascotLine =
    grouped.live.length > 0
      ? grouped.live.length === 1
        ? 'Gerade läuft eine Aktivität!'
        : `Gerade laufen ${grouped.live.length} Aktivitäten!`
      : undefined;

  return (
    <HomeBackground style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: safeAreaInsets.top + Spacing.four,
            paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.four,
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
        {/* Kopf: Wortmarke und das Upgrade-Feld links, Konto rechts. Der
            Admin-Bereich hängt am Konto-Widget – dadurch bleibt die untere
            Leiste bei ihren Zielen. */}
        <View style={styles.header}>
          <View style={styles.topBar}>
            <View style={styles.topBarLeft}>
              <BrandLogo size="small" />
              {/* Zeigt sich nur, solange es eine höhere Stufe gibt. */}
              <UpgradeChip />
            </View>
            <AccountWidget
              onPress={() => (profilePath ? router.push(profilePath) : setAccountOpen(true))}
            />
          </View>

          {/* Goenni begrüßt und reagiert. Steht über der Fortschritts-Karte, weil
              das die Reihenfolge ist, in der man die Seite liest: erst „hallo",
              dann „wo stehe ich". */}
          <TabMascot tab="home" line={mascotLine} />

          {/* Fortschritts-Karte: Level, Balken und die drei Zahlen, die zählen.
              Ein Blick genügt, um zu sehen, wo man steht – und was fehlt. */}
          <Pressable
            onPress={() => router.push('/progress')}
            accessibilityRole="button"
            accessibilityLabel="Fortschritt und Abzeichen öffnen"
            style={({ pressed }) => pressed && styles.pressed}>
            <GlassCard tone="accent" radius={Radius.panel} style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={styles.heroText}>
                  <View style={styles.greetingRow}>
                    <Icon name={greeting.icon} size={19} color={surface.accent} />
                    <ThemedText style={[styles.greeting, { color: surface.text }]} numberOfLines={1}>
                      {greeting.text}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                    {level.title}
                  </ThemedText>
                </View>
                {/* Plakette auf der blauen Karte: klare Fläche, indigo Kontur,
                    Akzent nur in der Schrift. Ohne Lichtsaum – bei so kleinen
                    Flächen legt der nur einen milchigen Schleier darüber. */}
                <GlassSurface
                  tone="frost"
                  radius={Radius.panel}
                  sheen={false}
                  style={[styles.levelBadge, { borderColor: surface.chipBorder }]}>
                  <ThemedText style={[styles.levelNumber, { color: surface.chipText }]}>
                    {level.level}
                  </ThemedText>
                  <ThemedText style={[styles.levelWord, { color: surface.chipText }]}>LEVEL</ThemedText>
                </GlassSurface>
              </View>

              <View style={styles.progressBlock}>
                <GlassProgressBar progress={level.progress} />
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  {level.xpForNext !== null
                    ? `Noch ${level.xpForNext - level.xpIntoLevel} XP bis „${level.nextTitle}"`
                    : 'Höchste Stufe erreicht – stark!'}
                </ThemedText>
              </View>

              <View style={[styles.statsRow, { borderTopColor: surface.chipBorder }]}>
                <Stat icon="tent" value={stats?.hosted ?? 0} label="erstellt" surface={surface} />
                <Stat icon="user-check" value={stats?.joined ?? 0} label="dabei" surface={surface} />
                <Stat
                  icon="compass"
                  value={stats?.distinctInterests ?? 0}
                  label="Kategorien"
                  surface={surface}
                />
              </View>
            </GlassCard>
          </Pressable>

          {/* Die Prämien. Direkt unter dem Fortschritt, weil beide dieselbe Frage
              beantworten – „wo stehe ich?" –, nur einmal in XP und einmal in
              etwas, das man tatsächlich bekommt. Hier stand vorher die Serie;
              warum sie weg ist, steht in `src/components/rewards-card.tsx`. */}
          <RewardsCard
            balance={points?.balance ?? 0}
            redeemedCount={redeemedCount}
            onPress={() => router.push('/rewards')}
          />
        </View>

        {/* Storys unter der Hero-Karte: kurze Blicke von Creator- und
            Business-Konten, ungesehene zuerst (die Reihenfolge kommt vom Server).
            Läuft randlos wie die Kategorien darunter. */}
        <StoryRail
          stories={stories}
          canPublish={canPublishStory}
          onOpen={setStoryIndex}
          onCreate={() => router.push('/create-story')}
        />

        {/* Kategorien: der schnelle Einstieg ins Stöbern. Läuft randlos, damit
            die Kacheln zum Wischen einladen. Suchfeld und Filter hängen hier
            drunter und sind zugeklappt – siehe `searchOpen`. */}
        {interests.length > 0 ? (
          <View style={styles.categories}>
            <View style={styles.sectionHead}>
              <SectionHeader
                title="Worauf hast du Lust?"
                action={
                  <Pressable
                    onPress={() => {
                      feedback.selected();
                      setSearchOpen((prev) => !prev);
                      // Beim Zuklappen den Filter zurücksetzen: Ein aktiver Filter
                      // hinter einer geschlossenen Klappe ist die Sorte
                      // unsichtbarer Zustand, wegen der man später denkt, die App
                      // zeige zu wenige Events an.
                      if (searchOpen) setFilter(EMPTY_FILTER);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: searchOpen }}
                    // Im Web übersetzt React Native Web `expanded` nicht nach
                    // `aria-expanded` – siehe die Notiz in `setting-row.tsx`.
                    aria-expanded={searchOpen}
                    hitSlop={8}>
                    <View style={styles.searchToggle}>
                      <Icon name={searchOpen ? 'close' : 'search'} size={15} color={surface.accent} />
                      <ThemedText type="smallBold" style={{ color: surface.accent }}>
                        {searchOpen ? 'Schließen' : filterOn ? `Suche · ${results.length}` : 'Suchen & filtern'}
                      </ThemedText>
                    </View>
                  </Pressable>
                }
              />
            </View>

            {searchOpen ? (
              <View style={styles.searchPanel}>
                <ActivityFilterBar
                  filter={filter}
                  onChange={setFilter}
                  interests={interests}
                  resultCount={results.length}
                  distanceAvailable={hasLocation && distanceById.size > 0}
                />
              </View>
            ) : null}

            <CategoryStrip
              interests={interests}
              selectedIds={filter.interestIds}
              onToggle={toggleCategory}
            />
          </View>
        ) : null}

        {/* Fehler mit Gesicht statt roter Zeile – warum, steht in `MascotError`. */}
        {error ? (
          <View style={styles.errorWrap}>
            <MascotError detail={error} onRetry={refreshing ? undefined : refresh} />
          </View>
        ) : null}

        {filterOn ? (
          /* Suchmodus: eine klare Trefferliste statt drei Regale. */
          <View style={styles.results}>
            <SectionHeader title={`Treffer · ${results.length}`} />
            {results.length === 0 ? (
              <GlassCard tone="accent" style={styles.emptyCard}>
                <ThemedText style={{ color: surface.text }}>Nichts gefunden.</ThemedText>
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  Versuch es mit einem anderen Suchwort oder nimm einen Filter raus.
                </ThemedText>
              </GlassCard>
            ) : (
              /* Der Eintritt läuft beim Einhängen, also nur für WIRKLICH neue
                 Treffer. Überlebende bleiben dieselben Elemente und blitzen
                 nicht bei jedem getippten Zeichen erneut auf. */
              results.map((activity, index) => (
                <Entrance key={activity.id} index={index}>
                  <ActivityCard
                    activity={activity}
                    onPress={() => onPress(activity)}
                    onDelete={onDelete ? () => onDelete(activity) : undefined}
                    distanceKm={distanceById.get(activity.id) ?? null}
                    layout="row"
                    now={now}
                  />
                </Entrance>
              ))
            )}
          </View>
        ) : (
          <View style={styles.shelves}>
            {/* Ganz oben und nur, wenn es tatsächlich etwas gibt: Ein leeres
                „Jetzt oder gleich" wäre die schlechteste Variante – es würde
                jeden Tag mit „hier ist nichts" begrüßen. */}
            {grouped.live.length > 0 ? (
              <ActivityShelf
                icon="bolt"
                title="Jetzt oder gleich"
                activities={grouped.live}
                onPress={onPress}
                onDelete={onDelete}
                distanceById={distanceById}
                now={now}
                note="Läuft gerade oder startet in den nächsten Stunden."
                emptyText=""
              />
            ) : null}

            {/* Gemerktes direkt nach „Jetzt oder gleich": Was man sich selbst zur
                Seite gelegt hat, gehört vor alles, was die App vorschlägt. Leer
                erscheint das Regal nicht – dann hat man eben nichts gemerkt, und
                ein leeres Regal wäre nur eine Aufforderung ohne Anlass. */}
            {grouped.saved.length > 0 ? (
              <ActivityShelf
                icon="star-filled"
                title="Gemerkt"
                activities={grouped.saved}
                onPress={onPress}
                onDelete={onDelete}
                distanceById={distanceById}
                now={now}
                note="Was du dir zur Seite gelegt hast."
                emptyText=""
              />
            ) : null}

            <ActivityShelf
              icon="star"
              title="Für dich"
              activities={grouped.recommended}
              onPress={onPress}
              onDelete={onDelete}
              loading={loading}
              distanceById={distanceById}
              now={now}
              emptyText={`Noch nichts, das zu deinen Interessen passt. Wähle Interessen im Profil. ${createHint}`}
            />
            <ActivityShelf
              icon="map-pin"
              title={expanded ? `In deiner Nähe (bis ${radiusKm} km)` : 'In deiner Nähe'}
              activities={grouped.nearby}
              onPress={onPress}
              onDelete={onDelete}
              loading={loading || (hasLocation && nearbyResolving)}
              distanceById={distanceById}
              now={now}
              note={
                expanded
                  ? `Direkt um dich herum war nichts los – wir haben den Umkreis auf ${radiusKm} km erweitert.`
                  : undefined
              }
              emptyText={
                hasLocation
                  ? `Auch im erweiterten Umkreis ist gerade nichts los. ${createHint}`
                  : 'Für „In deiner Nähe" brauchen wir Zugriff auf deinen Standort. Erlaube ihn in den Einstellungen.'
              }
            />
            <ActivityShelf
              icon="balloon"
              title="Alles entdecken"
              activities={grouped.other}
              onPress={onPress}
              onDelete={onDelete}
              loading={loading}
              distanceById={distanceById}
              now={now}
              emptyText={`Keine weiteren Aktivitäten. ${createHint}`}
            />
          </View>
        )}
      </ScrollView>

      {canCreate ? (
        /* Der ＋-Knopf pulsiert und leuchtet dabei leicht auf. Er ist die einzige
           Handlung, die etwas Neues in die App bringt – und auf einer Seite voller
           fremder Events die Einladung, selbst etwas zu starten. Deshalb darf
           genau er sich bewegen.

           Zwei Ebenen mit VERSCHIEDENEN Dauern: `Glow` atmet in der Helligkeit
           (3600 ms), `Pulse` bewegt den Knopf selbst (1600 ms). Weil sich die
           beiden nicht deckungsgleich wiederholen, sieht es nicht nach Schleife
           aus. Und beide bewusst langsam: schnelles Pulsieren wäre nach zwei
           Minuten nervig statt einladend.

           Der Puls liegt INNEN, der Lichthof außen – der Hof ist eine
           Geschwister-Ebene neben dem Knopf, mitskaliert würde er darunter
           hervorwandern. */
        <View
          style={[styles.fabWrap, { bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three }]}>
          <Glow color={surface.accent} radius={28} intensity="soft" durationMs={3600}>
            <Pulse scaleTo={1.06} durationMs={1600}>
              <PressableScale
                onPress={() => router.push('/create-activity')}
                accessibilityRole="button"
                accessibilityLabel="Activity erstellen"
                haptic="press"
                scaleTo={0.9}
                style={[styles.fab, { backgroundColor: surface.accent }]}>
                {/* Als SVG und nicht als Textzeichen: Ein Glyph sitzt auf der
                    Schrift-Grundlinie und hat oben/unten unterschiedlich viel
                    Luft (Ober- und Unterlänge). In einem Kreis fällt das sofort
                    auf – das Plus stand sichtbar zu tief. Ein SVG mit
                    symmetrischer viewBox sitzt exakt in der Mitte. */}
                <Icon name="plus" size={28} color={surface.accentText} />
              </PressableScale>
            </Pulse>
          </Glow>
        </View>
      ) : null}

      <ActivityDetailModal
        activity={selected}
        distanceKm={selected ? distanceById.get(selected.id) ?? null : null}
        onClose={() => setSelected(null)}
        onChanged={handleChanged}
      />

      {/* Der Story-Betrachter ist ein eigenes Fenster (`Modal`) und deckt deshalb
          auch die native Tab-Leiste ab – siehe `story-viewer.tsx`. */}
      <StoryViewer
        stories={stories}
        startIndex={storyIndex}
        onClose={() => setStoryIndex(null)}
        onSeen={handleStorySeen}
        onDelete={handleStoryDelete}
      />

      {/* Ganz zuletzt, damit das Blatt über Liste und ＋-Knopf liegt. */}
      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />
    </HomeBackground>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

/** Eine der drei Zahlen im Fuß der Fortschritts-Karte. */
function Stat({
  icon,
  value,
  label,
  surface,
}: {
  icon: UiIconName;
  value: number;
  label: string;
  surface: Surface;
}) {
  return (
    <View style={styles.stat}>
      {/* Ohne `label`: Die Beschriftung darunter sagt schon, was gezählt wird. */}
      <Icon name={icon} size={19} color={surface.accent} />
      {/* Läuft hoch, sobald die Zahl steigt. Nur so sieht man überhaupt, dass
          da eben etwas dazugekommen ist. */}
      <CountUp value={value} style={[styles.statValue, { color: surface.text }]} />
      <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    // Kein horizontales Padding: die Regale scrollen randlos, der Kopf padded selbst.
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    // Großzügiger Abstand zwischen den Blöcken – das war vorher der Hauptgrund,
    // warum die Startseite „vollgepackt" wirkte.
    gap: Spacing.five,
  },
  header: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /** Wortmarke + Upgrade-Feld bilden zusammen die linke Seite der Kopfzeile. */
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  pressed: { opacity: 0.85 },
  hero: { gap: Spacing.three, padding: Spacing.four },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroText: { flex: 1, gap: 2 },
  /** Symbol und Gruß in einer Zeile – `flexShrink`, damit lange Namen kürzen
      statt das Symbol aus der Karte zu schieben. */
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  greeting: { flexShrink: 1, fontSize: 22, lineHeight: 29, fontWeight: '800', letterSpacing: -0.4 },
  levelBadge: {
    borderRadius: Radius.panel,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    minWidth: 62,
  },
  levelNumber: { fontSize: 22, lineHeight: 26, fontWeight: '800' },
  levelWord: { fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 1.4 },
  progressBlock: { gap: Spacing.two },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: Spacing.three,
  },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  statValue: { fontSize: 19, lineHeight: 24, fontWeight: '800' },
  categories: { gap: Spacing.three },
  sectionHead: { paddingHorizontal: Spacing.four },
  /** Symbol + Wort im Kopf der Kategorien-Sektion (der Aufklapper). */
  searchToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  /** Der aufgeklappte Bereich – padded selbst, weil die Sektion randlos läuft. */
  searchPanel: { paddingHorizontal: Spacing.four },
  results: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  emptyCard: { gap: Spacing.one },
  shelves: { gap: Spacing.five },
  errorWrap: { paddingHorizontal: Spacing.four },
  /** Die Position liegt am Rahmen, damit der Lichthof darin frei liegen kann. */
  fabWrap: {
    position: 'absolute',
    right: Spacing.four,
  },
  fab: {
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
});
