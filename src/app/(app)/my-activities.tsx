import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { HistoryCard } from '@/components/history-card';
import { HomeBackground } from '@/components/home-background';
import { Mascot, MascotError, type MascotMood } from '@/components/mascot';
import { TabMascot } from '@/components/tab-mascot';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { Segmented } from '@/components/ui/segmented';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { accountAbilities } from '@/domain/account';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import { type Activity, type ActivityHistoryEntry, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';

type Tab = 'created' | 'joined' | 'history';

/** Zeitstempel eines Events (0, wenn keins gesetzt ist). */
function startOf(activity: Activity): number {
  return activity.starts_at ? new Date(activity.starts_at).getTime() : 0;
}

/**
 * Was als Nächstes ansteht, zuerst; Vergangenes danach (das Jüngste oben).
 * Genau in dieser Reihenfolge braucht man die Liste im Alltag.
 */
function byRelevance(list: Activity[], now: number): Activity[] {
  const upcoming = list.filter((a) => startOf(a) >= now).sort((a, b) => startOf(a) - startOf(b));
  const past = list.filter((a) => startOf(a) < now).sort((a, b) => startOf(b) - startOf(a));
  return [...upcoming, ...past];
}

/**
 * „Meine Aktivitäten" in drei Sichten statt einer langen Seite:
 *
 * - Erstellt: eigene Events, jeweils löschbar
 * - Dabei: Events, bei denen man mitmacht
 * - Verlauf: Schnappschuss aller Events der letzten Tage – bleibt auch nach
 *   Löschen/Verlassen noch 7 Tage bestehen (kommt so vom Server)
 *
 * Die Zahlen stehen schon am Umschalter, man muss also nicht erst klicken,
 * um zu sehen, wo etwas liegt.
 */
export default function MyActivitiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [history, setHistory] = useState<ActivityHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [tab, setTab] = useState<Tab>('created');

  /** Events erstellen gibt es ab dem Creator-Konto (siehe src/domain/account.ts). */
  const canCreate = accountAbilities(user).canCreateActivities;

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      // Live-Events (für die löschbare Liste) und Verlauf parallel laden.
      const [acts, hist] = await Promise.all([api.activities(token), api.history(token)]);
      setActivities(acts.data);
      setHistory(hist.data);
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
  // Danach den Verlauf nachladen, damit ein Austritt dort als „verlassen" erscheint.
  const handleChanged = useCallback(
    (updated: Activity) => {
      setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
      load();
    },
    [load],
  );

  // Eigenes Event löschen (mit Rückfrage). Nach Erfolg aus der Liste entfernen,
  // ein evtl. offenes Popup schließen und den Verlauf neu laden (Snapshot bleibt).
  const handleDelete = useCallback(
    async (activity: Activity) => {
      if (!token) return;
      const ok = await confirmAction(
        'Aktivität löschen',
        `„${activity.title}" wirklich unwiderruflich löschen?`,
        'Löschen',
        true,
      );
      if (!ok) return;
      try {
        await api.deleteActivity(token, activity.id);
        setActivities((prev) => prev.filter((a) => a.id !== activity.id));
        setSelected((prev) => (prev && prev.id === activity.id ? null : prev));
        load();
      } catch {
        setError('Löschen fehlgeschlagen.');
      }
    },
    [token, load],
  );

  const { created, joined } = useMemo(() => {
    const now = Date.now();
    const mine = activities.filter((a) => a.host?.id === user?.id);
    const attending = activities.filter((a) => a.is_joined && a.host?.id !== user?.id);
    return { created: byRelevance(mine, now), joined: byRelevance(attending, now) };
  }, [activities, user?.id]);

  // Tippen auf eine Verlaufs-Karte öffnet das Detail-Popup nur, wenn das Event
  // noch existiert (aktiv) und in der Live-Liste vorhanden ist.
  const openFromHistory = useCallback(
    (entry: ActivityHistoryEntry) => {
      if (!entry.is_active || entry.activity_id == null) return;
      const live = activities.find((a) => a.id === entry.activity_id);
      if (live) setSelected(live);
    },
    [activities],
  );

  const busy = loading && activities.length === 0 && history.length === 0;

  return (
    <HomeBackground style={styles.container}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: surface.text }]}>Meine Aktivitäten</ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            Alles, was du erstellt hast, wo du dabei bist – und was war.
          </ThemedText>
          <TabMascot tab="activities" style={styles.mascot} />
        </View>

        {/* Drei Zahlen als Überblick: was habe ich hier eigentlich zu tun? */}
        <View style={styles.statRow}>
          <StatTile icon="tent" value={created.length} label="Erstellt" surface={surface} />
          <StatTile icon="user-check" value={joined.length} label="Dabei" surface={surface} />
          <StatTile icon="clock" value={history.length} label="Im Verlauf" surface={surface} />
        </View>

        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          segments={[
            { value: 'created', label: 'Erstellt', count: created.length },
            { value: 'joined', label: 'Dabei', count: joined.length },
            { value: 'history', label: 'Verlauf', count: history.length },
          ]}
        />

        {busy ? (
          <View style={styles.state}>
            <ActivityIndicator color={surface.accent} />
          </View>
        ) : error ? (
          <View style={styles.state}>
            <MascotError detail={error} onRetry={load} />
          </View>
        ) : (
          <View style={styles.section}>
            {tab === 'created' ? (
              created.length > 0 ? (
                /* Beim Umschalten sind es andere Einträge mit anderen Keys, die
                   Karten hängen also neu ein und treten von selbst ein – der
                   Wechsel bekommt damit seine Bewegung ohne Zusatzaufwand. */
                created.map((item, index) => (
                  <Entrance key={item.id} index={index}>
                    <ActivityCard
                      activity={item}
                      onPress={() => setSelected(item)}
                      onDelete={() => handleDelete(item)}
                    />
                  </Entrance>
                ))
              ) : (
                /* Ohne Creator-Konto führt der Knopf zum Upgrade statt ins
                   Formular – dort käme man ohnehin nicht weiter. */
                <EmptyState
                  mood="thinking"
                  title="Noch nichts erstellt"
                  text={
                    canCreate
                      ? 'Du entscheidest, was läuft: Sport, Kaffee, Lerngruppe – erstelle dein erstes Event.'
                      : 'Eigene Events gibt es ab dem Creator-Konto. Nach dem Upgrade entscheidest du, was läuft.'
                  }
                  actionLabel={canCreate ? '＋ Aktivität erstellen' : 'Upgrade ansehen'}
                  onAction={() => router.push(canCreate ? '/create-activity' : '/upgrade')}
                  surface={surface}
                />
              )
            ) : null}

            {tab === 'joined' ? (
              joined.length > 0 ? (
                joined.map((item, index) => (
                  <Entrance key={item.id} index={index}>
                    <ActivityCard activity={item} onPress={() => setSelected(item)} />
                  </Entrance>
                ))
              ) : (
                <EmptyState
                  mood="idle"
                  title="Du bist noch nirgends dabei"
                  text="Auf der Startseite findest du Events in deiner Nähe – ein Tipp genügt."
                  actionLabel="Events entdecken"
                  onAction={() => router.push('/')}
                  surface={surface}
                />
              )
            ) : null}

            {tab === 'history' ? (
              history.length > 0 ? (
                history.map((entry, index) => {
                  const canOpen =
                    entry.is_active &&
                    entry.activity_id != null &&
                    activities.some((a) => a.id === entry.activity_id);
                  return (
                    <Entrance key={entry.id} index={index}>
                      <HistoryCard
                        entry={entry}
                        onPress={canOpen ? () => openFromHistory(entry) : undefined}
                      />
                    </Entrance>
                  );
                })
              ) : (
                <EmptyState
                  mood="asleep"
                  title="Dein Verlauf ist leer"
                  text="Sobald du ein Event erstellst oder einem beitrittst, taucht es hier auf – und bleibt 7 Tage sichtbar."
                  surface={surface}
                />
              )
            ) : null}
          </View>
        )}
      </ScrollView>

      <ActivityDetailModal
        activity={selected}
        onClose={() => setSelected(null)}
        onChanged={handleChanged}
      />
    </HomeBackground>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

/** Eine der drei Überblick-Zahlen über dem Umschalter. */
function StatTile({
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
    <GlassSurface tone="accent" radius={Radius.card} style={styles.statTile}>
      <Icon name={icon} size={19} color={surface.accent} />
      <ThemedText style={[styles.statValue, { color: surface.text }]}>{value}</ThemedText>
      <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
        {label}
      </ThemedText>
    </GlassSurface>
  );
}

/**
 * Leerer Bereich mit Erklärung – und, wenn möglich, dem nächsten Schritt.
 *
 * Hier steht das Maskottchen und kein Symbol: Ein leerer Bereich ist die eine
 * Stelle, an der ohnehin nichts wäre – und die Figur macht daraus einen Moment
 * statt einer Fehlanzeige. Die Stimmung passt zum Grund der Leere (siehe
 * `src/components/mascot.tsx`).
 */
function EmptyState({
  mood,
  title,
  text,
  actionLabel,
  onAction,
  surface,
}: {
  mood: MascotMood;
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  surface: Surface;
}) {
  return (
    <GlassSurface tone="accent" radius={Radius.panel} style={styles.empty}>
      <Mascot mood={mood} size={88} color={surface.accent} />
      <ThemedText style={[styles.emptyTitle, { color: surface.text }]}>{title}</ThemedText>
      <ThemedText type="small" style={[styles.centerText, { color: surface.textMuted }]}>
        {text}
      </ThemedText>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.emptyAction,
            { backgroundColor: surface.accent },
            pressed && { opacity: 0.8 },
          ]}>
          <ThemedText type="smallBold" style={{ color: surface.accentText }}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },
  header: { gap: Spacing.half },
  mascot: { marginTop: Spacing.two },
  title: { fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },

  statRow: { flexDirection: 'row', gap: Spacing.two },
  statTile: { flex: 1, alignItems: 'center', paddingVertical: Spacing.three, gap: 1 },
  statIcon: { fontSize: 18, lineHeight: 23 },
  statValue: { fontSize: 20, lineHeight: 26, fontWeight: '800' },

  section: { gap: Spacing.three },
  state: { paddingVertical: Spacing.six, alignItems: 'center' },
  centerText: { textAlign: 'center' },

  empty: { alignItems: 'center', gap: Spacing.two, padding: Spacing.five },
  emptyEmoji: { fontSize: 40, lineHeight: 48 },
  emptyTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  emptyAction: {
    marginTop: Spacing.two,
    borderRadius: 999,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
});
