import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MapPinIcon } from '@/components/ui/icons';
import { Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import { type Activity, api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Props = {
  /** Die anzuzeigende Activity – `null` schließt das Popup. */
  activity: Activity | null;
  onClose: () => void;
  /** Wird nach Beitreten/Verlassen mit der aktualisierten Activity aufgerufen. */
  onChanged?: (updated: Activity) => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-Datum → „TT.MM.JJJJ, HH:MM" (ohne Intl, robust auf Hermes). */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Detail-Popup für ein Event: zeigt alle Infos (Banner, Beschreibung, Ort,
 * Zeit, Teilnehmer:innen) und unten einen Knopf zum Beitreten/Verlassen.
 * Der lokale Zustand wird nach jeder Aktion aktualisiert, damit die Anzeige
 * (Teilnehmerliste + Knopf) sofort reagiert.
 */
export function ActivityDetailModal({ activity, onClose, onChanged }: Props) {
  const surface = useBrandSurface();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  // Eigene Kopie, damit Teilnehmerzahl/-liste nach dem Beitreten sofort passt.
  const [current, setCurrent] = useState<Activity | null>(activity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(activity);
    setError(null);
  }, [activity]);

  const visible = activity !== null;
  const data = current ?? activity;

  async function toggleJoin() {
    if (!token || !data) return;
    setBusy(true);
    setError(null);
    try {
      const res = data.is_joined
        ? await api.leaveActivity(token, data.id)
        : await api.joinActivity(token, data.id);
      setCurrent(res.data);
      onChanged?.(res.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.firstError() : 'Das hat leider nicht geklappt. Bitte erneut versuchen.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  const when = formatDate(data.starts_at);
  // Voll = Maximum gesetzt und erreicht. Wer schon dabei ist, darf trotzdem
  // verlassen; nur das Beitreten wird gesperrt.
  const isFull =
    data.max_participants != null && data.participants_count >= data.max_participants;
  const joinBlocked = isFull && !data.is_joined;
  const countLabel =
    data.max_participants != null
      ? `${data.participants_count}/${data.max_participants}`
      : String(data.participants_count);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Innerer Pressable fängt Klicks ab, damit ein Tap im Sheet nicht schließt. */}
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: surface.card,
              borderColor: surface.cardBorder,
              paddingBottom: insets.bottom + Spacing.four,
            },
          ]}
          onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: surface.cardBorder }]} />

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {data.banner_url ? (
              <Image source={{ uri: data.banner_url }} style={styles.banner} resizeMode="cover" />
            ) : null}

            <ThemedText type="subtitle" style={{ color: surface.text }}>
              {data.title}
            </ThemedText>

            <View style={styles.metaRow}>
              {when ? (
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  🗓 {when}
                </ThemedText>
              ) : null}
              {data.location ? (
                <View style={styles.metaItem}>
                  <MapPinIcon size={16} color={surface.textMuted} />
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    {data.location}
                  </ThemedText>
                </View>
              ) : null}
            </View>

            {data.host ? (
              <ThemedText type="small" style={{ color: surface.chipText }}>
                Veranstaltet von {data.host.name}
              </ThemedText>
            ) : null}

            {data.interests.length > 0 ? (
              <View style={styles.chips}>
                {data.interests.map((interest) => (
                  <View key={interest.id} style={[styles.chip, { backgroundColor: surface.chipBg }]}>
                    <ThemedText type="small" style={{ color: surface.chipText }}>
                      {interest.name}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}

            {data.description ? (
              <ThemedText style={{ color: surface.text }}>{data.description}</ThemedText>
            ) : null}

            {/* Teilnehmer:innen */}
            <View style={styles.participantsBlock}>
              <ThemedText type="smallBold" style={{ color: surface.text }}>
                Teilnehmer:innen ({countLabel}){isFull ? ' · voll' : ''}
              </ThemedText>
              {data.participants.length > 0 ? (
                <View style={styles.participants}>
                  {data.participants.map((p) => (
                    <View key={p.id} style={[styles.participantPill, { backgroundColor: surface.chipBg }]}>
                      <ThemedText type="small" style={{ color: surface.chipText }}>
                        {p.name}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ) : (
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  Noch niemand dabei – sei die:der Erste!
                </ThemedText>
              )}
            </View>

            {error ? (
              <ThemedText type="small" style={styles.errorText}>
                {error}
              </ThemedText>
            ) : null}
          </ScrollView>

          {/* Aktionsleiste */}
          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              disabled={busy}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: surface.cardBorder },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
                Schließen
              </ThemedText>
            </Pressable>

            <Pressable
              onPress={toggleJoin}
              disabled={busy || joinBlocked}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: data.is_joined ? surface.chipBg : surface.accent },
                (pressed || joinBlocked) && styles.pressed,
              ]}>
              {busy ? (
                <ActivityIndicator color={data.is_joined ? surface.chipText : surface.accentText} />
              ) : (
                <ThemedText
                  type="smallBold"
                  style={{ color: data.is_joined ? surface.chipText : surface.accentText }}>
                  {data.is_joined ? 'Verlassen' : joinBlocked ? 'Event ist voll' : 'Beitreten'}
                </ThemedText>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    maxHeight: '88%',
    ...Platform.select({
      android: { elevation: 8 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
      },
    }),
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.three,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  banner: {
    width: '100%',
    height: 170,
    borderRadius: Spacing.three,
  },
  metaRow: {
    gap: Spacing.two,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  participantsBlock: {
    gap: Spacing.two,
  },
  participants: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  participantPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  errorText: {
    color: '#ef4444',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButton: {
    flex: 2,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
