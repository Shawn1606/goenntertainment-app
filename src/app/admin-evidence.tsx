import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { formatDateTimeCompact } from '@/domain/date-format';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import { type AdminEvidence, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** Kurzes Label für die Aktion. */
function actionLabel(e: AdminEvidence): string {
  if (e.action === 'ban') return 'Bann';
  return e.banned_until ? `Timeout bis ${formatDateTimeCompact(e.banned_until)}` : 'Timeout';
}

export default function AdminEvidenceScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [items, setItems] = useState<AdminEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.adminEvidence(token);
      setItems(res.data);
    } catch {
      setError('Beweismittel konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const header = <Stack.Screen options={{ headerShown: true, title: 'Beweise' }} />;

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
              BEWEISMITTEL
            </ThemedText>
            <ThemedText style={[styles.title, { color: surface.text }]}>Beweise</ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Alle Sperren mit Grund und Screenshot
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <GlassSurface radius={Radius.card} style={styles.card}>
            <View style={styles.cardHead}>
              <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                {item.user.name}
                {item.user.username ? ` (@${item.user.username})` : ''}
              </ThemedText>
              <ThemedText type="small" style={{ color: '#ef4444' }}>
                {actionLabel(item)}
              </ThemedText>
            </View>

            <ThemedText type="small" style={{ color: surface.text }}>
              Grund: {item.reason}
            </ThemedText>

            {item.image_url ? (
              <Pressable onPress={() => setZoom(item.image_url)}>
                <Image source={{ uri: item.image_url }} style={styles.evidenceImage} resizeMode="cover" />
              </Pressable>
            ) : (
              <ThemedText type="small" style={{ color: surface.textMuted, fontStyle: 'italic' }}>
                Kein Bild angehängt
              </ThemedText>
            )}

            <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
              {formatDateTimeCompact(item.created_at)}
              {item.source === 'ai' ? ' · automatisch (KI-Verifizierung)' : ''}
              {item.admin_name ? ` · von ${item.admin_name}` : ''}
            </ThemedText>
          </GlassSurface>
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={surface.accent} />
            </View>
          ) : (
            <View style={styles.centered}>
              <ThemedText style={{ color: error ? '#ef4444' : surface.textMuted, textAlign: 'center' }}>
                {error ?? 'Noch keine Beweismittel. Sie entstehen, sobald du jemanden mit Bild sperrst.'}
              </ThemedText>
            </View>
          )
        }
      />

      {/* Bild groß anzeigen */}
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
  card: { padding: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  evidenceImage: { width: '100%', height: 180, borderRadius: 12 },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  zoomImage: { width: '100%', height: '100%' },
});
