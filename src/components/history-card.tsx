import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { GlassSurface } from '@/components/ui/glass';
import { formatDateTime } from '@/domain/date-format';
import { Radius, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import type { ActivityHistoryEntry } from '@/lib/api';

type Props = {
  entry: ActivityHistoryEntry;
  /** Nur aktive Einträge mit noch existierendem Event sind antippbar. */
  onPress?: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Verbleibende Tage im Verlauf: removed_at + 7 Tage − jetzt (mind. 0). */
function daysLeft(removedAt: string | null): number {
  if (!removedAt) return 0;
  const removed = new Date(removedAt).getTime();
  if (Number.isNaN(removed)) return 0;
  const expires = removed + 7 * DAY_MS;
  return Math.max(0, Math.ceil((expires - Date.now()) / DAY_MS));
}

/**
 * Eine Karte im horizontalen „Verlauf"-Streifen. Zeigt einen Schnappschuss des
 * Events – auch wenn es inzwischen gelöscht wurde bzw. man ausgetreten ist. In
 * dem Fall erscheint ein Hinweis, wie lange der Eintrag noch bleibt.
 */
export function HistoryCard({ entry, onPress }: Props) {
  const surface = useBrandSurface();
  const when = formatDateTime(entry.starts_at);
  const roleLabel = entry.role === 'host' ? 'Erstellt' : 'Beigetreten';

  const remaining = daysLeft(entry.removed_at);
  const statusText = entry.is_active
    ? null
    : `${entry.activity_id == null ? 'Gelöscht' : 'Verlassen'} · noch ${remaining} ${remaining === 1 ? 'Tag' : 'Tage'} im Verlauf`;

  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={onPress}
      style={onPress ? ({ pressed }: { pressed: boolean }) => (pressed ? styles.pressed : undefined) : undefined}>
      <GlassSurface tone="accent" radius={Radius.card} style={!entry.is_active ? styles.inactive : undefined}>
        {entry.banner_url ? (
          <Image source={{ uri: entry.banner_url }} style={styles.banner} resizeMode="cover" />
        ) : (
          // Eine Stufe kräftiger als die Karte, sonst verschwindet das Ersatzbild.
          <View style={[styles.banner, styles.bannerFallback, { backgroundColor: surface.chipBgStrong }]}>
            <Icon name="party" size={26} color={surface.chipText} />
          </View>
        )}

        <View style={styles.body}>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: surface.chipBgStrong }]}>
              <ThemedText type="small" style={{ color: surface.chipText }}>
                {roleLabel}
              </ThemedText>
            </View>
          </View>

          <ThemedText type="smallBold" numberOfLines={1} style={{ color: surface.text }}>
            {entry.title}
          </ThemedText>
          <ThemedText type="small" numberOfLines={1} style={{ color: surface.textMuted }}>
            {[when, entry.location].filter(Boolean).join(' · ')}
          </ThemedText>

          {statusText ? (
            <ThemedText type="small" numberOfLines={1} style={{ color: surface.textMuted }}>
              {statusText}
            </ThemedText>
          ) : null}
        </View>
      </GlassSurface>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  inactive: {
    opacity: 0.75,
  },
  banner: {
    width: '100%',
    height: 120,
  },
  bannerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  badge: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
});
