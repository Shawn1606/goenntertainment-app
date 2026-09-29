import { Image, StyleSheet, View } from 'react-native';

import { HostBanner } from '@/components/host-banner';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Spacing } from '@/constants/theme';
import { formatDayTimeShort } from '@/domain/date-format';
import type { GroupableHost } from '@/domain/host-group';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';
import { useResolvedScheme } from '@/lib/theme-preference';

type Props = {
  host: GroupableHost;
  activities: readonly Activity[];
  onPress: () => void;
};

/** Wie viele Termine als Vorschau auf der Karte stehen. */
const PREVIEW = 3;

/**
 * Eine Karte für einen Veranstalter mit mehreren Terminen.
 *
 * ## Warum es diese Karte gibt
 *
 * Ein Kino spielt zwanzig Vorstellungen. Als zwanzig Banner im Regal steht
 * zwanzigmal dasselbe Logo, und die Events von Freund:innen verschwinden
 * dahinter. Diese Karte nimmt den Platz von einer und führt in die Liste.
 *
 * ## Warum sie wie eine Event-Kachel aussieht, aber nicht wie eine
 *
 * Sie trägt dieselbe Fläche und dieselben Maße – sie steht in derselben Reihe,
 * ein Fremdkörper würde das Regal zerreißen. Aber statt einem Datum steht die
 * ANZAHL oben und darunter die nächsten Termine als Zeilen. Sähe sie genau wie
 * eine Event-Kachel aus, würde man sie antippen und ein Detail erwarten – und
 * stattdessen eine Liste bekommen.
 *
 * Das Banner kommt vom nächsten Termin: Es ist das Bild, das am ehesten noch
 * aktuell ist, und der Grund, warum jemand hinschaut.
 */
export function HostGroupCard({ host, activities, onPress }: Props) {
  const surface = useBrandSurface();
  const glass = useGlass();
  const isDark = useResolvedScheme() === 'dark';

  const banner = activities.find((activity) => activity.banner_url)?.banner_url ?? null;
  const preview = activities.slice(0, PREVIEW);
  const rest = activities.length - preview.length;

  /**
   * Der Host MIT Bild – aus einem Termin, nicht aus der `host`-Prop.
   *
   * `GroupableHost` ist die Form, die `host-group.ts` braucht, und die
   * Domänen-Schicht kennt `avatar_url` nicht. An den Terminen hängt dagegen der
   * volle Host aus der API. Denselben Wert von dort zu nehmen ist ehrlicher, als
   * den Domänen-Typ um ein Feld zu erweitern, das er nie benutzt.
   */
  const hostForBanner = activities.find((activity) => activity.host)?.host ?? null;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${host.name}, ${activities.length} Termine anzeigen`}
      scaleTo={0.975}>
      <View
        style={[
          styles.tile,
          { backgroundColor: isDark ? '#1d1f30' : '#e8e8f9', borderColor: glass.border },
        ]}>
        {banner ? (
          <Image source={{ uri: banner }} style={styles.banner} resizeMode="cover" />
        ) : (
          // Kein Termin hat ein Bild: Grund und Zeichen des Hauses – dieselbe
          // Fläche, die auch die Event-Kacheln benutzen (siehe `host-banner.tsx`).
          // Auf dieser Karte ist das besonders passend: Sie IST das Haus.
          <HostBanner host={hostForBanner} variant="banner" />
        )}

        {/* Die Anzahl an derselben Stelle, an der eine Event-Kachel ihre Zeit
            zeigt: oben links. Beim Wischen scannt man Formen an festen Plätzen,
            nicht Zeilen. */}
        <View style={[styles.overlay, !banner && styles.overlayNoBanner]}>
          <View style={[styles.countBadge, { backgroundColor: surface.accent }]}>
            <Icon name="balloon" size={13} color={surface.accentText} />
            <ThemedText type="small" style={{ color: surface.accentText }}>
              {activities.length} Termine
            </ThemedText>
          </View>
        </View>

        <View style={styles.body}>
          <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
            {host.name}
          </ThemedText>

          {/* Die nächsten Termine als Zeilen – das ist die Aussage der Karte.
              Ohne sie wäre sie ein Deckel, den man erst öffnen muss, um zu sehen,
              ob überhaupt etwas Passendes drin ist. */}
          <View style={styles.list}>
            {preview.map((activity) => (
              <View key={activity.id} style={styles.line}>
                <ThemedText type="small" style={[styles.when, { color: surface.accent }]}>
                  {formatDayTimeShort(activity.starts_at)}
                </ThemedText>
                <ThemedText
                  type="small"
                  style={[styles.lineTitle, { color: surface.textMuted }]}
                  numberOfLines={1}>
                  {activity.title}
                </ThemedText>
              </View>
            ))}
          </View>

          <ThemedText type="small" style={{ color: surface.accent }}>
            {rest > 0 ? `+ ${rest} weitere · alle ansehen` : 'Alle ansehen'}
          </ThemedText>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Maße wie in `activity-card.tsx`: Die Karte steht in derselben Reihe.
  tile: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
  },
  banner: {
    width: '100%',
    height: 130,
  },
  overlay: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  /** Ohne Banner sitzt das Abzeichen im Fluss und nicht über dem Text. */
  overlayNoBanner: {
    position: 'relative',
    top: 0,
    left: 0,
    margin: Spacing.three,
    marginBottom: 0,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  list: {
    gap: 2,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  /** Feste Breite, damit die Titel darunter auf einer Kante beginnen. */
  when: {
    width: 92,
    fontWeight: '700',
  },
  lineTitle: {
    flexShrink: 1,
  },
});
