/**
 * Übersicht aller Chats: Gruppen und laufende Events.
 *
 * ## Warum hier auch stumme Chats stehen
 *
 * Eine Gruppe ohne eine einzige Nachricht steht mit in der Liste. Das ist
 * Absicht: Der Chat ist sonst unsichtbar, bis jemand anfängt – und niemand fängt
 * an, was er nicht sieht. Der Eintrag sagt dann „Noch nichts geschrieben" und ist
 * damit eine Einladung statt eines leeren Platzes.
 *
 * ## Die Reihenfolge macht der Server
 *
 * Ungelesenes zuerst, dann nach letzter Nachricht (siehe
 * server/src/routes/chat.js). Hier wird bewusst nicht nachsortiert: Zwei
 * Sortierungen an zwei Orten sind eine, die irgendwann anders ist als die andere.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassCard, SectionHeader } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { BackButton } from '@/components/ui/icon-button';
import { FontFamily, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { unreadBadge } from '@/domain/unread-badge';
import { formatRelativeShort } from '@/domain/date-format';
import { useBrandSurface } from '@/hooks/use-theme';
import { api, type ChatOverviewEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';

export default function ChatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const { token } = useAuth();

  const [chats, setChats] = useState<ChatOverviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.chats(token);
      setChats(res.data);
    } catch {
      setError('Die Chats ließen sich nicht laden. Läuft das Backend?');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Beim Betreten neu laden – hier gibt es KEIN Nachfragen im Takt: Diese Liste
  // ist eine Übersicht, keine Unterhaltung. Wer auf neue Nachrichten wartet, ist
  // im Chat selbst (dort wird gepollt).
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

  function open(chat: ChatOverviewEntry) {
    feedback.tapped();
    router.push({
      pathname: '/chat',
      // Der Titel geht mit, damit die Kopfzeile sofort dasteht und nicht erst
      // „Chat" zeigt, bis der Verlauf geladen ist.
      params: { kind: chat.kind, id: String(chat.ref_id), title: chat.title },
    });
  }

  const groups = chats.filter((chat) => chat.kind === 'group');
  const events = chats.filter((chat) => chat.kind === 'activity');
  const unreadTotal = chats.reduce((sum, chat) => sum + chat.unread, 0);

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            // Kein `BottomTabInset`: Dieser Screen ist eine Stack-Route und liegt
            // damit ÜBER der Tab-Leiste, nicht darin (siehe app-tabs.tsx – die
            // fünf Plätze sind voll und bleiben es).
            paddingBottom: insets.bottom + Spacing.four,
          },
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
        {/* Kopfzeile mit Zurück.
            Ohne sie war dieser Screen eine Sackgasse: Er ist eine Stack-Route und
            liegt damit ÜBER der Tab-Leiste (siehe app-tabs.tsx) – wer hier landet,
            sieht die Leiste nicht mehr und kam ohne Zurück-Knopf nicht mehr auf die
            Startseite. Der Einzelchat hatte einen, die Übersicht nicht. */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <BackButton />
            <ThemedText style={styles.title}>Chats</ThemedText>
          </View>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {unreadTotal > 0
              ? unreadTotal === 1
                ? 'Eine neue Nachricht wartet.'
                : `${unreadTotal} neue Nachrichten warten.`
              : 'Deine Gruppen und die Events, bei denen du dabei bist.'}
          </ThemedText>
        </View>

        {error ? <MascotError detail={error} onRetry={loading ? undefined : load} /> : null}

        {!loading && chats.length === 0 && !error ? (
          <GlassCard tone="accent">
            <MascotEmpty mood="thinking" size={84}>
              <ThemedText style={{ color: surface.text }}>Noch keine Chats.</ThemedText>
              <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                Leg eine Gruppe an oder tritt einem Event bei – der Chat entsteht dann von selbst.
              </ThemedText>
            </MascotEmpty>
          </GlassCard>
        ) : null}

        {groups.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title={`Gruppen · ${groups.length}`} />
            {groups.map((chat, index) => (
              <Entrance key={`group-${chat.ref_id}`} index={index}>
                <ChatRow chat={chat} onPress={() => open(chat)} />
              </Entrance>
            ))}
          </View>
        ) : null}

        {events.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title={`Events · ${events.length}`} />
            {events.map((chat, index) => (
              <Entrance key={`activity-${chat.ref_id}`} index={index}>
                <ChatRow chat={chat} onPress={() => open(chat)} />
              </Entrance>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </HomeBackground>
  );
}

/** Eine Zeile: Symbol, Name, Vorschau – und rechts Zeit und Ungelesen-Plakette. */
function ChatRow({ chat, onPress }: { chat: ChatOverviewEntry; onPress: () => void }) {
  const surface = useBrandSurface();
  const badge = unreadBadge(chat.unread);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        badge ? `${chat.title}, ${chat.unread} ungelesen` : chat.title
      }
      style={({ pressed }) => pressed && styles.pressed}>
      <GlassCard tone="card" style={styles.row}>
        <View
          style={[
            styles.avatar,
            { backgroundColor: surface.chipBg, borderColor: surface.chipBorder },
          ]}>
          <Icon
            name={chat.kind === 'group' ? 'users' : 'ticket'}
            size={20}
            color={surface.accent}
          />
        </View>

        <View style={styles.rowText}>
          <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
            {chat.title}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
            {chat.last_message
              ? `${chat.last_message.author}: ${chat.last_message.preview}`
              : 'Noch nichts geschrieben'}
          </ThemedText>
        </View>

        <View style={styles.rowMeta}>
          {chat.last_message ? (
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {formatRelativeShort(chat.last_message.created_at, new Date())}
            </ThemedText>
          ) : null}
          {badge ? (
            <View style={[styles.badge, { backgroundColor: surface.accent }]}>
              <ThemedText style={[styles.badgeText, { color: surface.accentText }]}>
                {badge}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </GlassCard>
    </Pressable>
  );
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
  header: { gap: Spacing.half },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { flex: 1, fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  section: { gap: Spacing.two },
  centered: { textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: Radius.field,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
  rowMeta: { alignItems: 'flex-end', gap: Spacing.one },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '800', fontFamily: FontFamily.bold },
  pressed: { opacity: 0.7 },
});
