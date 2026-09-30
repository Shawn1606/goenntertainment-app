/**
 * Die Glocke: was passiert ist, während man weg war.
 *
 * ## Was hier landet
 *
 * Zwei Sorten, und sie sind verschieden gemeint:
 *
 *  - **Von Leuten, denen du folgst** – Story, Event, Beitrag. Das ist der Grund,
 *    warum es Folgen überhaupt gibt: Ohne diese Meldungen wäre ein Abo eine Zahl
 *    auf einem Profil und sonst nichts.
 *  - **Über dich** – jemand folgt dir, liked oder kommentiert deinen Beitrag.
 *
 * Beide stehen in einer Liste und nicht in zwei Reitern: Zwei Listen mit je zwei
 * Einträgen sind schlechter zu lesen als eine mit vier, und die Sorte steht
 * ohnehin im Symbol.
 *
 * ## Alles gilt als gelesen, sobald die Liste offen war
 *
 * Man liest Benachrichtigungen als Stapel, nicht einzeln. Eine Liste, in der nach
 * dem Durchscrollen noch neun als ungelesen stehen, wird ihren Zähler nie wieder
 * los. Abgehakt wird deshalb einmal beim Öffnen – aber erst NACH dem Laden, damit
 * man noch sieht, was neu war.
 */
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassCard } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { BackButton } from '@/components/ui/icon-button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { formatRelativeShort } from '@/domain/date-format';
import { notificationIcon, notificationTarget } from '@/domain/notification';
import { isUiIconName } from '@/domain/ui-icon';
import { useBrandSurface } from '@/hooks/use-theme';
import { api, type AppNotification } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const { token, user } = useAuth();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Wurde in dieser Sitzung schon abgehakt?
   *
   * Als `Ref` und nicht als State: Ein State-Update würde `load` neu bauen und
   * damit den Fokus-Effekt erneut auslösen – ein Abhaken, das sich selbst wieder
   * anstößt.
   */
  const marked = useRef(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.notifications(token);
      setItems(res.data);

      // Erst nach dem Laden abhaken: Sonst wäre die Liste beim ersten Blick
      // schon grau, und man sähe nicht mehr, was neu war.
      if (!marked.current && res.unread > 0) {
        marked.current = true;
        api.markNotificationsRead(token).catch(() => {});
      }
    } catch {
      setError('Die Benachrichtigungen ließen sich nicht laden. Läuft das Backend?');
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

  /** Wohin ein Eintrag führt – die Regel steht in `src/domain/notification.ts`. */
  const open = useCallback(
    (item: AppNotification) => {
      const target = notificationTarget(item, user ? { username: user.username } : null);
      if (!target) return;
      feedback.tapped();

      const href: Href =
        target.kind === 'home'
          ? '/'
          : target.kind === 'profile'
            ? { pathname: '/profile/[username]', params: { username: target.username } }
            : // Für ein Event gibt es keine eigene Adresse – das Popup hängt an
              // der Startseite. Bis es eine gibt, führt der Tipp dorthin, wo das
              // Event steht, statt ins Leere.
              '/';
      router.push(href);
    },
    [router, user],
  );

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.four,
            // Kein `BottomTabInset`: Stack-Route, liegt über der Tab-Leiste.
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
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <BackButton />
            <ThemedText style={styles.title}>Benachrichtigungen</ThemedText>
          </View>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            Was Leute gemacht haben, denen du folgst – und was auf deinen Beiträgen passiert ist.
          </ThemedText>
        </View>

        {error ? <MascotError detail={error} onRetry={loading ? undefined : load} /> : null}

        {!loading && items.length === 0 && !error ? (
          <GlassCard tone="accent">
            <MascotEmpty mood="thinking" size={84}>
              <ThemedText style={{ color: surface.text }}>Noch nichts Neues.</ThemedText>
              <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                Folge Leuten auf ihrem Profil – dann erfährst du hier, wenn sie eine Story, ein
                Event oder einen Beitrag veröffentlichen.
              </ThemedText>
            </MascotEmpty>
          </GlassCard>
        ) : null}

        {items.map((item, index) => (
          <Entrance key={item.id} index={index}>
            <NotificationRow item={item} onPress={() => open(item)} />
          </Entrance>
        ))}
      </ScrollView>
    </HomeBackground>
  );
}

/** Eine Zeile: Symbol bzw. Profilbild, Text, Zeit – und links ein Punkt, wenn ungelesen. */
function NotificationRow({ item, onPress }: { item: AppNotification; onPress: () => void }) {
  const surface = useBrandSurface();
  // Unbekannte Sorten bekommen die Glocke; `isUiIconName` fängt zusätzlich den
  // Fall ab, dass die Symbol-Tabelle einen Namen nicht (mehr) kennt.
  const rawIcon = notificationIcon(item.type);
  const icon = isUiIconName(rawIcon) ? rawIcon : 'bell';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[item.title, item.body].filter(Boolean).join('. ')}
      style={({ pressed }) => pressed && styles.pressed}>
      <GlassCard tone={item.read ? 'card' : 'accent'} style={styles.row}>
        <View style={styles.avatarWrap}>
          {item.actor?.avatar ? (
            <Image source={{ uri: item.actor.avatar }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View
              style={[
                styles.avatar,
                styles.avatarEmpty,
                { backgroundColor: surface.chipBg, borderColor: surface.chipBorder },
              ]}>
              <Icon name={icon} size={18} color={surface.accent} />
            </View>
          )}
          {/* Das Symbol wandert bei vorhandenem Profilbild an dessen Ecke: Wer
              etwas getan hat UND was getan wurde – beides in einem Blick. */}
          {item.actor?.avatar ? (
            <View style={[styles.kind, { backgroundColor: surface.accent }]}>
              <Icon name={icon} size={11} color={surface.accentText} />
            </View>
          ) : null}
        </View>

        <View style={styles.rowText}>
          <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={2}>
            {item.title}
          </ThemedText>
          {item.body ? (
            <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={2}>
              {item.body}
            </ThemedText>
          ) : null}
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {formatRelativeShort(item.created_at, new Date())}
          </ThemedText>
        </View>

        {/* Ungelesen: ein Punkt, keine Zahl. Bei einer einzelnen Zeile wäre eine
            1 eine Angabe ohne Aussage. */}
        {!item.read ? <View style={[styles.dot, { backgroundColor: surface.accent }]} /> : null}
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
    gap: Spacing.two,
  },
  header: { gap: Spacing.half, marginBottom: Spacing.two },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  title: { flex: 1, fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  centered: { textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  avatarWrap: { width: 42, height: 42 },
  avatar: { width: 42, height: 42, borderRadius: Radius.field },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  kind: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pressed: { opacity: 0.7 },
});
