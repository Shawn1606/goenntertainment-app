import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { GlassSurface } from '@/components/ui/glass';
import { formatDateTimeCompact } from '@/domain/date-format';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import { type AdminModerationReport, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { UiIconName } from '@/domain/ui-icon';

/**
 * Symbol, Farbe und Text zur Maßnahme, damit man Treffer sofort sieht.
 *
 * Farbe allein reicht nicht – wer Rot und Grün nicht unterscheidet, sähe sonst
 * nur graue Zeilen. Deshalb tragen alle drei dieselbe Aussage.
 */
function actionStyle(item: AdminModerationReport): { label: string; color: string; icon: UiIconName } {
  if (item.verdict === 'error') return { label: 'Prüfung fehlgeschlagen', color: '#f59e0b', icon: 'warning' };
  if (item.verdict === 'refusal') return { label: 'Nicht prüfbar – abgelehnt', color: '#f59e0b', icon: 'warning' };
  if (item.action === 'timeout') return { label: 'Abgelehnt + 7 Tage Sperre', color: '#ef4444', icon: 'ban' };
  if (item.action === 'blocked') return { label: 'Abgelehnt', color: '#ef4444', icon: 'ban' };
  if (item.severity > 0) return { label: 'Grenzwertig – durchgelassen', color: '#f59e0b', icon: 'eye' };
  return { label: 'Unbedenklich', color: '#22c55e', icon: 'check' };
}

const SEVERITY_LABELS = ['0 · unbedenklich', '1 · grenzwertig', '2 · nicht jugendfrei', '3 · schwer'];

export default function AdminModerationScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const surface = useBrandSurface();

  const [report, setReport] = useState<AdminModerationReport[]>([]);
  const [totals, setTotals] = useState({ checked: 0, blocked: 0, timeouts: 0, errors: 0 });
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.adminModeration(token, onlyFlagged);
      setReport(res.data);
      setTotals(res.totals);
    } catch {
      setError('Berichte konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [token, onlyFlagged]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const header = <Stack.Screen options={{ headerShown: true, title: 'KI-Verifizierung' }} />;

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
        data={report}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        ListHeaderComponent={
          <View style={styles.head}>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Jede erstellte Aktivität wird auf Titel, Beschreibung, Interessen und Bild geprüft. Ab
              Schwere 2 wird der Inhalt abgelehnt und das Konto 7 Tage gesperrt.
            </ThemedText>

            <View style={styles.kpiRow}>
              <Kpi label="Geprüft" value={totals.checked} surface={surface} />
              <Kpi label="Abgelehnt" value={totals.blocked} surface={surface} color="#ef4444" />
              <Kpi label="Sperren" value={totals.timeouts} surface={surface} color="#ef4444" />
              <Kpi label="Fehler" value={totals.errors} surface={surface} color="#f59e0b" />
            </View>

            <Pressable
              onPress={() => setOnlyFlagged((prev) => !prev)}
              accessibilityRole="button"
              style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <GlassSurface radius={Radius.card} style={styles.toggle}>
                <ThemedText type="smallBold" style={{ color: surface.accent }}>
                  {onlyFlagged ? 'Nur Auffälligkeiten' : 'Alle Prüfungen'}
                </ThemedText>
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  tippen zum Wechseln
                </ThemedText>
              </GlassSurface>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => {
          const action = actionStyle(item);
          return (
            <GlassSurface radius={Radius.card} style={styles.card}>
              <View style={styles.cardHead}>
                <ThemedText type="smallBold" style={{ color: surface.text, flex: 1 }} numberOfLines={1}>
                  {item.user ? `${item.user.name}${item.user.username ? ` (@${item.user.username})` : ''}` : 'Konto gelöscht'}
                </ThemedText>
                <Icon name={action.icon} size={16} color={action.color} />
                <ThemedText type="small" style={{ color: action.color }}>
                  {action.label}
                </ThemedText>
              </View>

              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Schwere: {SEVERITY_LABELS[item.severity] ?? item.severity}
                {item.categories.length > 0 ? ` · ${item.categories.join(', ')}` : ''}
              </ThemedText>

              {item.reason ? (
                <ThemedText type="small" style={{ color: surface.text }}>
                  Begründung: {item.reason}
                </ThemedText>
              ) : null}

              <View style={[styles.snapshot, { borderColor: surface.cardBorder }]}>
                <ThemedText type="small" style={{ color: surface.text }} numberOfLines={2}>
                  Titel: {item.title ?? '—'}
                </ThemedText>
                {item.body ? (
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={4}>
                    Beschreibung: {item.body}
                  </ThemedText>
                ) : null}
                {item.interests ? (
                  <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={2}>
                    Interessen: {item.interests}
                  </ThemedText>
                ) : null}
                {item.fields.length > 0 ? (
                  <ThemedText type="small" style={{ color: '#ef4444' }}>
                    Beanstandet: {item.fields.join(', ')}
                  </ThemedText>
                ) : null}
              </View>

              {item.image_url ? (
                <Pressable onPress={() => setZoom(item.image_url)}>
                  <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="cover" />
                </Pressable>
              ) : null}

              <ThemedText type="small" style={{ color: surface.textMuted, fontSize: 11 }}>
                {formatDateTimeCompact(item.created_at)}
                {item.model ? ` · ${item.model}` : ''}
                {item.latency_ms ? ` · ${(item.latency_ms / 1000).toFixed(1)} s` : ''}
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
              <ThemedText style={{ color: error ? '#ef4444' : surface.textMuted, textAlign: 'center' }}>
                {error ??
                  (onlyFlagged
                    ? 'Keine Auffälligkeiten. Tippe oben auf „Alle Prüfungen", um jede Prüfung zu sehen.'
                    : 'Noch keine Prüfungen. Sie entstehen, sobald jemand eine Aktivität erstellt.')}
              </ThemedText>
            </View>
          )
        }
      />

      {/* Beanstandetes Bild groß anzeigen */}
      <Modal visible={zoom !== null} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={styles.zoomBackdrop} onPress={() => setZoom(null)}>
          {zoom ? <Image source={{ uri: zoom }} style={styles.zoomImage} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </HomeBackground>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

function Kpi({
  label,
  value,
  surface,
  color,
}: {
  label: string;
  value: number;
  surface: Surface;
  color?: string;
}) {
  return (
    <GlassSurface radius={Radius.card} style={styles.kpiCard}>
      <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.kpiValue, { color: color ?? surface.accent }]}>{value}</ThemedText>
    </GlassSurface>
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
  head: { gap: Spacing.three, marginBottom: Spacing.three },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  kpiCard: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 78,
    padding: Spacing.two,
    gap: 2,
  },
  kpiValue: { fontSize: 22, fontWeight: '800' },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  card: { padding: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  snapshot: { borderLeftWidth: 3, paddingLeft: Spacing.three, gap: 2 },
  image: { width: '100%', height: 180, borderRadius: 12 },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  zoomImage: { width: '100%', height: '100%' },
});
