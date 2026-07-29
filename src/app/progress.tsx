/**
 * Fortschritt & Rangliste (Tickets #17 und #18).
 *
 * Der Server liefert nur die nackten Kennzahlen (`/api/me/progress`,
 * `/api/leaderboard`). Level, Titel und Abzeichen rechnet die App daraus
 * selbst – mit derselben getesteten Logik aus `src/domain/gamification.ts`.
 */
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { CountUp } from '@/components/ui/count-up';
import { GlassCard, GlassProgressBar, GlassSurface, SectionHeader } from '@/components/ui/glass';
import { Entrance } from '@/components/ui/entrance';
import { Glow, Skeleton } from '@/components/ui/glow';
import { Icon } from '@/components/ui/icon';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { badgesFor, levelFor, xpFor, type ActivityStats } from '@/domain/gamification';
import { rankMedal } from '@/domain/ui-icon';
import { useBrandSurface, useGlass, useSignals } from '@/hooks/use-theme';
import { type LeaderboardEntry, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';
import { useResolvedScheme } from '@/lib/theme-preference';

const EMPTY_STATS: ActivityStats = { hosted: 0, joined: 0, distinctInterests: 0 };

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const surface = useBrandSurface();
  const signal = useSignals();

  const [stats, setStats] = useState<ActivityStats>(EMPTY_STATS);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [me, setMe] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [progress, leaderboard] = await Promise.all([api.progress(token), api.leaderboard(token)]);
      setStats(progress.stats);
      setBoard(leaderboard.data);
      setMe(leaderboard.me);
    } catch {
      setError('Fortschritt konnte nicht geladen werden.');
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

  const xp = useMemo(() => xpFor(stats), [stats]);
  const level = useMemo(() => levelFor(xp), [xp]);
  const badges = useMemo(() => badgesFor(stats), [stats]);
  const earned = badges.filter((b) => b.earned).length;

  return (
    <HomeBackground style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: 'Dein Fortschritt' }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={surface.accent}
            colors={[surface.accent]}
          />
        }>
        {error ? <MascotError detail={error} onRetry={refreshing ? undefined : refresh} /> : null}

        {/* Beim ersten Laden Platzhalter in der Form dessen, was kommt – statt
            eines Spinners, der nur sagt „warte", ohne zu verraten worauf. */}
        {loading ? <ProgressSkeleton /> : null}

        {/* Level */}
        <GlassCard tone="accent" radius={Radius.panel} style={styles.levelCard}>
          <View style={styles.levelHead}>
            <View style={styles.levelText}>
              <ThemedText style={[styles.levelTitle, { color: surface.text }]}>{level.title}</ThemedText>
              <View style={styles.xpRow}>
                {/* Zählt beim Öffnen hoch: Dieser Bildschirm wird genau deshalb
                    aufgerufen, also darf die Zahl den Blick holen. */}
                <CountUp
                  value={xp}
                  animateOnMount
                  durationMs={900}
                  style={[styles.xpValue, { color: surface.textMuted }]}
                />
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  XP gesammelt
                </ThemedText>
              </View>
            </View>
            {/* Wie auf der Startseite: klare Plakette, Akzent in der Schrift. */}
            <GlassSurface
              tone="frost"
              radius={26}
              sheen={false}
              style={[styles.levelBadge, { borderColor: surface.chipBorder }]}>
              <ThemedText style={[styles.levelNumber, { color: surface.chipText }]}>{level.level}</ThemedText>
            </GlassSurface>
          </View>

          <GlassProgressBar progress={level.progress} height={10} />

          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {level.xpForNext !== null
              ? `Noch ${level.xpForNext - level.xpIntoLevel} XP bis „${level.nextTitle}"`
              : 'Höchste Stufe erreicht – Respekt!'}
          </ThemedText>
        </GlassCard>

        {/* Woher die Punkte kommen */}
        <View style={styles.statRow}>
          <StatTile label="Erstellt" value={stats.hosted} hint="je 50 XP" />
          <StatTile label="Mitgemacht" value={stats.joined} hint="je 20 XP" />
          <StatTile label="Kategorien" value={stats.distinctInterests} hint="je 10 XP" />
        </View>

        {/* Abzeichen */}
        <SectionHeader
          title="Abzeichen"
          action={
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {earned}/{badges.length}
            </ThemedText>
          }
        />
        <View style={styles.badgeGrid}>
          {badges.map((badge, index) => {
            // Fast geschafft = mindestens die Hälfte und noch offen. Genau diese
            // Abzeichen leuchten: Sie sind der Grund, heute noch etwas zu machen.
            // Verdiente Abzeichen leuchten NICHT – die sind erledigt, sie sollen
            // nicht mit dem konkurrieren, was noch geht.
            const almost = !badge.earned && badge.goal > 1 && badge.progress / badge.goal >= 0.5;

            return (
              /* Dieser Bildschirm wird geöffnet, UM die Abzeichen zu sehen –
                 hier darf die Reihenfolge des Eintretens den Blick führen. */
              <Entrance key={badge.id} index={index} style={styles.badgeWrap}>
              <Glow
                active={almost}
                color={signal.warnGlow}
                radius={Radius.card}
                intensity="soft">
                <GlassCard
                  tone="accent"
                  style={[
                    styles.badge,
                    !badge.earned && styles.badgeLocked,
                    // Verdient: ruhig grün umrandet. Das ist die Farbe, die in
                    // dieser App „geschafft" bedeutet.
                    badge.earned && { borderColor: signal.good, backgroundColor: signal.goodBg },
                    almost && { borderColor: signal.warnBorder, backgroundColor: signal.warnBg },
                  ]}>
                  {/* Verdient: das eigene Zeichen des Abzeichens in „geschafft"-
                      Grün. Offen: ein Schloss in Grau – dieselbe Fläche, damit
                      die Kacheln in der Reihe nicht springen. */}
                  <Icon
                    name={badge.earned ? badge.icon : 'lock'}
                    size={26}
                    color={badge.earned ? signal.good : surface.textMuted}
                    label={badge.earned ? undefined : 'Noch nicht verdient'}
                  />
                  <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                    {badge.name}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={2}>
                    {badge.description}
                  </ThemedText>
                  {badge.earned ? (
                    <ThemedText type="small" style={{ color: signal.good }}>
                      ✓ verdient
                    </ThemedText>
                  ) : (
                    <>
                      {/* Ein Balken sagt „so weit bist du" schneller als „2/5". */}
                      <GlassProgressBar progress={badge.progress / badge.goal} height={5} glowAt={1.1} />
                      <ThemedText
                        type="small"
                        style={{ color: almost ? signal.warn : surface.chipText }}>
                        {almost
                          ? `Nur noch ${badge.goal - badge.progress}!`
                          : `${badge.progress}/${badge.goal}`}
                      </ThemedText>
                    </>
                  )}
                </GlassCard>
              </Glow>
              </Entrance>
            );
          })}
        </View>

        {/* Rangliste */}
        <SectionHeader
          title="Rangliste"
          action={
            me ? (
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Du: Platz {me.rank}
              </ThemedText>
            ) : null
          }
        />
        <GlassCard tone="accent" style={styles.boardCard}>
          {board.length === 0 ? (
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Noch keine Punkte vergeben. Erstelle das erste Event!
            </ThemedText>
          ) : (
            board.map((entry, index) => {
              const isMe = entry.user.id === user?.id;
              return (
                <View
                  key={entry.user.id}
                  style={[
                    styles.boardRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: surface.chipBorder },
                  ]}>
                  {/* Podest: ein Zeichen in Gold/Silber/Bronze. Ab Platz 4 die
                      Zahl – die sagt dort mehr als ein viertes graues Abzeichen.
                      Das Zeichen trägt ein Label, weil es die Zahl ERSETZT und
                      damit selbst die Information ist. */}
                  <View style={styles.rank}>
                    {(() => {
                      const medal = rankMedal(entry.rank);
                      return medal ? (
                        <Icon
                          name={medal.icon}
                          size={19}
                          color={RANK_TONES[medal.tone]}
                          label={`Platz ${entry.rank}`}
                        />
                      ) : (
                        <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                          {entry.rank}
                        </ThemedText>
                      );
                    })()}
                  </View>
                  <View style={styles.boardText}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: isMe ? surface.accent : surface.text }}
                      numberOfLines={1}>
                      {entry.user.name}
                      {isMe ? ' (du)' : ''}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                      {entry.stats.hosted} erstellt · {entry.stats.joined} mitgemacht
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: surface.chipText }}>
                    {entry.xp} XP
                  </ThemedText>
                </View>
              );
            })
          )}
        </GlassCard>

        {/* Ehrlich bleiben: erklären, wie die Punkte entstehen. */}
        <ThemedText type="small" style={[styles.footnote, { color: surface.textMuted }]}>
          Punkte gibt es fürs Mitmachen, nicht fürs Draufschauen: 50 XP pro eigenem Event, 20 XP pro
          Teilnahme, 10 XP für jede Kategorie, die du ausprobiert hast.
        </ThemedText>
      </ScrollView>
    </HomeBackground>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  const surface = useBrandSurface();

  return (
    <GlassCard tone="accent" style={styles.statTile}>
      <ThemedText type="small" style={{ color: surface.textMuted }}>
        {label}
      </ThemedText>
      <CountUp value={value} animateOnMount style={[styles.statValue, { color: surface.accent }]} />
      <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
        {hint}
      </ThemedText>
    </GlassCard>
  );
}

/**
 * Platzhalter für den ersten Aufbau.
 *
 * Die Form folgt dem echten Bildschirm (Level-Karte, drei Kacheln): So springt
 * beim Eintreffen der Daten nichts, und man sieht schon beim Öffnen, was hier
 * gleich stehen wird.
 */
function ProgressSkeleton() {
  const glass = useGlass();
  const isDark = useResolvedScheme() === 'dark';
  const base = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(23,23,23,0.06)';
  const sheen = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.75)';

  return (
    <View style={styles.skeleton}>
      <Skeleton color={base} sheenColor={sheen} height={120} radius={Radius.panel} />
      <View style={styles.statRow}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.skeletonTile}>
            <Skeleton color={base} sheenColor={sheen} height={78} radius={Radius.card} />
          </View>
        ))}
      </View>
      <View style={[styles.skeletonRule, { backgroundColor: glass.border }]} />
    </View>
  );
}

/**
 * Farben fürs Podest. Gold/Silber/Bronze sind hier bewusst festgenagelt und
 * nicht aus dem Thema geholt: Sie bedeuten einen PLATZ, nicht einen Zustand –
 * und müssen in hell wie dunkel dieselben bleiben, sonst ist Platz 1 im
 * Dunkelmodus plötzlich Platz 3.
 */
const RANK_TONES = { gold: '#eab308', silver: '#94a3b8', bronze: '#b45309' } as const;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', paddingVertical: Spacing.four },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  levelCard: { gap: Spacing.two },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  levelText: { flex: 1, gap: 2 },
  levelTitle: { fontSize: 22, fontWeight: '800' },
  levelBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelNumber: { fontSize: 22, fontWeight: '800' },
  xpRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  xpValue: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: Spacing.two },
  statTile: { flex: 1, gap: 2 },
  statValue: { fontSize: 24, fontWeight: '800' },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  /** Der Lichthof-Rahmen übernimmt das Kachel-Verhalten, die Karte darin füllt aus. */
  badgeWrap: { flexGrow: 1, flexBasis: '30%', minWidth: 140 },
  badge: { gap: Spacing.one },
  /** Verschlossen, aber nicht unlesbar: 0.75 statt 0.6, sonst rät man den Text. */
  badgeLocked: { opacity: 0.75 },
  skeleton: { gap: Spacing.three },
  skeletonTile: { flex: 1 },
  skeletonRule: { height: StyleSheet.hairlineWidth * 2, marginTop: Spacing.two },
  boardCard: { paddingVertical: 0 },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  rank: { width: 28, alignItems: 'center', justifyContent: 'center' },
  boardText: { flex: 1, gap: 2 },
  footnote: { textAlign: 'center', lineHeight: 18, marginTop: Spacing.two },
});
