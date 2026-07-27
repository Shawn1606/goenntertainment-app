import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TrashIcon } from '@/components/ui/icons';
import { Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';

type Props = {
  activity: Activity;
  onPress?: () => void;
  /** Wenn gesetzt, erscheint oben rechts ein Papierkorb (nur für Admins nutzen). */
  onDelete?: () => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-Datum → „TT.MM.JJJJ, HH:MM" (ohne Intl, robust auf Hermes). */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ActivityCard({ activity, onPress, onDelete }: Props) {
  const when = formatDate(activity.starts_at);
  const surface = useBrandSurface();

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <View style={[styles.card, { backgroundColor: surface.card, borderColor: surface.cardBorder }]}>
        {activity.banner_url ? (
          <Image source={{ uri: activity.banner_url }} style={styles.banner} resizeMode="cover" />
        ) : null}

        {onDelete ? (
          <Pressable
            onPress={onDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Event löschen"
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
            <TrashIcon size={18} color="#ef4444" />
          </Pressable>
        ) : null}

        <View style={styles.body}>
          <ThemedText type="smallBold" style={{ color: surface.text }}>
            {activity.title}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {[when, activity.location].filter(Boolean).join(' · ')}
          </ThemedText>

          <View style={[styles.attendees, { backgroundColor: surface.chipBg }]}>
            <ThemedText type="small" style={{ color: surface.chipText }}>
              👥{' '}
              {activity.max_participants != null
                ? `${activity.participants_count}/${activity.max_participants} dabei`
                : activity.participants_count === 1
                  ? '1 dabei'
                  : `${activity.participants_count} dabei`}
              {activity.is_joined
                ? ' · du bist dabei'
                : activity.max_participants != null && activity.participants_count >= activity.max_participants
                  ? ' · voll'
                  : ''}
            </ThemedText>
          </View>

          <View style={styles.footer}>
            <View style={styles.chips}>
              {activity.interests.slice(0, 3).map((interest) => (
                <View key={interest.id} style={[styles.chip, { backgroundColor: surface.chipBg }]}>
                  <ThemedText type="small" style={{ color: surface.chipText }}>
                    {interest.name}
                  </ThemedText>
                </View>
              ))}
            </View>

            {activity.host ? (
              <ThemedText type="small" style={{ color: surface.chipText }}>
                von {activity.host.name}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  card: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 2 },
      default: {
        shadowColor: '#7c3aed',
        shadowOpacity: 0.1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  banner: {
    width: '100%',
    height: 130,
  },
  deleteButton: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  attendees: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    flexShrink: 1,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
});
