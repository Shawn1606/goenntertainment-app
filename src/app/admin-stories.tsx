/**
 * Admin: alle laufenden Storys – ansehen und löschen.
 *
 * ## Warum ein eigener Bildschirm und keine Liste im Dashboard
 *
 * Eine Story ist ein BILD. Sie zu beurteilen heißt, sie anzusehen, und dafür
 * braucht die Liste Platz: Vorschau, wer sie gemacht hat, wie lange sie noch
 * läuft. Im Dashboard, zwischen Kennzahlen und Graphen, wäre das eine
 * Bilderreihe, die alles andere erschlägt.
 *
 * ## Was hier steht und was nicht
 *
 * Nur **laufende** Storys (siehe GET /api/admin/stories). Abgelaufene sind für
 * niemanden mehr sichtbar – sie hier zum Löschen anzubieten wäre Arbeit ohne
 * Wirkung. Storys **gesperrter** Konten stehen dagegen mit drin und sind als
 * solche markiert: Eine Sperre nimmt das Bild nicht aus der Datenbank, und
 * genau darum geht es hier.
 *
 * Gelöscht wird über denselben Endpunkt, mit dem eine Person ihre eigene Story
 * löscht (DELETE /api/stories/:id) – dort darf ein Admin ohnehin jede löschen,
 * samt Bilddatei. Zwei Wege zum selben Ziel wären zwei Wege, die auseinander
 * laufen können.
 */
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { accountLabel } from '@/domain/account';
import { formatDayTimeShort } from '@/domain/date-format';
import { remainingLabel } from '@/domain/story';
import { useBrandSurface } from '@/hooks/use-theme';
import { ApiError, type AdminStory, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';

export default function AdminStoriesScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [items, setItems] = useState<AdminStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Welche Story gerade gelöscht wird – sperrt genau ihren Knopf. */
  const [busyId, setBusyId] = useState<number | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.adminStories(token);
      setItems(res.data);
    } catch {
      setError('Storys konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleDelete = useCallback(
    async (story: AdminStory) => {
      if (!token) return;
      const who = story.user.username ? `@${story.user.username}` : story.user.name;
      const ok = await confirmAction(
        'Story löschen',
        `Die Story von ${who} wirklich löschen? Das Bild ist danach weg.`,
        'Löschen',
        true,
      );
      if (!ok) return;
      setBusyId(story.id);
      setError(null);
      try {
        await api.deleteStory(token, story.id);
        // Nur die eine Zeile entfernen statt neu zu laden: Die Liste soll beim
        // Aufräumen nicht unter dem Finger wegspringen.
        setItems((prev) => prev.filter((s) => s.id !== story.id));
      } catch (e) {
        setError(e instanceof ApiError ? e.firstError() : 'Löschen fehlgeschlagen.');
      } finally {
        setBusyId(null);
      }
    },
    [token],
  );

  const header = <Stack.Screen options={{ headerShown: true, title: 'Storys' }} />;

  if (!user?.is_admin) {
    return (
      <HomeBackground style={[styles.screen, styles.centered]}>
        {header}
        <ThemedText style={{ color: surface.textMuted }}>Kein Admin-Zugang.</ThemedText>
      </HomeBackground>
    );
  }

  return (
    <HomeBackground style={styles.screen}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="small" style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBg }]}>
              STORYS
            </ThemedText>
            <ThemedText style={[styles.title, { color: surface.text }]}>Laufende Storys</ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {items.length === 0
                ? 'Storys laufen 24 Stunden und verschwinden dann von selbst.'
                : `${items.length} sichtbar · Bild antippen zum Vergrößern`}
            </ThemedText>
            {error ? (
              <ThemedText type="small" style={styles.errorText}>
                {error}
              </ThemedText>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const left = remainingLabel(item.expires_in_minutes);
          return (
            <GlassSurface radius={Radius.card} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardHeadText}>
                  <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                    {item.user.name}
                    {item.user.username ? ` (@${item.user.username})` : ''}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                    {[accountLabel(item.user.account_type), formatDayTimeShort(item.created_at), left]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                </View>

                {/* Der Knopf sitzt oben rechts, nicht unter dem Bild: So liegt er
                    bei jeder Karte an derselben Stelle, egal wie hoch das Bild ist. */}
                <Pressable
                  onPress={() => handleDelete(item)}
                  disabled={busyId === item.id}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Story von ${item.user.name} löschen`}
                  style={({ pressed }) => [styles.deleteBtn, (pressed || busyId === item.id) && { opacity: 0.5 }]}>
                  {busyId === item.id ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Icon name="trash" size={18} color="#ef4444" />
                  )}
                </Pressable>
              </View>

              {item.user.banned ? (
                <ThemedText type="small" style={styles.errorText}>
                  Dieses Konto ist gesperrt – die Story läuft trotzdem noch.
                </ThemedText>
              ) : null}

              {item.image_url ? (
                <Pressable onPress={() => setZoom(item.image_url)}>
                  <Image source={{ uri: item.image_url }} style={styles.storyImage} resizeMode="cover" />
                </Pressable>
              ) : (
                <ThemedText type="small" style={{ color: surface.textMuted, fontStyle: 'italic' }}>
                  Kein Bild gespeichert
                </ThemedText>
              )}

              {item.caption ? (
                <ThemedText type="small" style={{ color: surface.text }}>
                  {item.caption}
                </ThemedText>
              ) : null}

              <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
                {item.views} {item.views === 1 ? 'Ansicht' : 'Ansichten'}
              </ThemedText>
            </GlassSurface>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={surface.accent} />
            </View>
          ) : (
            <View style={styles.centered}>
              <ThemedText style={{ color: surface.textMuted, textAlign: 'center' }}>
                Gerade läuft keine Story.
              </ThemedText>
            </View>
          )
        }
      />

      {/* Bild groß ansehen – zum Beurteilen reicht die Vorschau nicht. */}
      <Modal visible={zoom !== null} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={styles.zoomBackdrop} onPress={() => setZoom(null)}>
          {zoom ? <Image source={{ uri: zoom }} style={styles.zoomImage} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: { gap: Spacing.half, marginBottom: Spacing.three },
  badge: {
    alignSelf: 'flex-start',
    fontWeight: '800',
    letterSpacing: 2,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  title: { fontSize: 28, fontWeight: '800' },
  errorText: { color: '#ef4444' },
  card: { padding: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardHeadText: { flex: 1, gap: 2 },
  deleteBtn: { padding: Spacing.one },
  storyImage: { width: '100%', height: 200, borderRadius: 12 },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  zoomImage: { width: '100%', height: '100%' },
});
