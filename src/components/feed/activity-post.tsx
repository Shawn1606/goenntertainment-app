import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StoryAvatar } from '@/components/story-avatar';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { formatDistance } from '@/domain/distance';
import { formatEventWhen } from '@/domain/event-when';
import { urgencyFor } from '@/domain/urgency';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';

/**
 * Eine Aktivität als Beitrag im Feed – gebaut wie ein Instagram-Post.
 *
 *   ┌ Kopf:   Bild · Name der Veranstalter:in · wann
 *   ├ Bild:   quadratisch, darauf das Zeit- und Platz-Abzeichen
 *   ├ Aktion: [Mitmachen]  Chat  Teilen            Merken
 *   └ Text:   Titel, Ort mit Entfernung, #Kategorien
 *
 * ## Warum dieses Muster
 *
 * Jede Handlung hat ein festes Symbol an einer festen Stelle – genau wie bei
 * Instagram (Herz, Sprechblase, Papierflieger, Lesezeichen). Man muss nichts
 * suchen und nichts lesen, um zu wissen, wo man tippt. Der eine Knopf mit Text
 * ist „Mitmachen": Er ist die wichtigste Handlung und bekommt als einziger die
 * Akzentfarbe, damit er im Feed sofort auffällt.
 *
 * Ein Tipp auf Bild oder Text öffnet das Detail-Fenster mit allem Weiteren
 * (Teilnehmer:innen, Beschreibung, Route).
 */

type Props = {
  activity: Activity;
  now: Date;
  distanceKm?: number | null;
  /** Ist das die eigene Aktivität? Dann gibt es kein „Mitmachen". */
  isOwn: boolean;
  busy?: boolean;
  onOpen: (activity: Activity) => void;
  onToggleJoin: (activity: Activity) => void;
  onToggleSave: (activity: Activity) => void;
  onShare: (activity: Activity) => void;
  onChat: (activity: Activity) => void;
  onOpenHost?: (activity: Activity) => void;
};

/**
 * Hintergründe für Aktivitäten ohne Foto. Aus der ersten Kategorie gewählt, damit
 * dieselbe Sorte Event immer gleich aussieht – ein Feed aus lauter identischen
 * Verläufen wäre eine Wand.
 */
const POSTER_GRADIENTS = [
  ['#fe2c55', '#dd2a7b', '#8134af'],
  ['#25f4ee', '#3b82f6', '#8134af'],
  ['#f58529', '#fe2c55', '#dd2a7b'],
  ['#10b981', '#06b6d4', '#3b82f6'],
  ['#8134af', '#515bd4', '#25f4ee'],
  ['#f59e0b', '#f97316', '#fe2c55'],
] as const;

function posterGradient(activity: Activity) {
  const seed = activity.interests[0]?.id ?? activity.id;
  return POSTER_GRADIENTS[Math.abs(seed) % POSTER_GRADIENTS.length];
}

function ActivityPostImpl({
  activity,
  now,
  distanceKm,
  isOwn,
  busy,
  onOpen,
  onToggleJoin,
  onToggleSave,
  onShare,
  onChat,
  onOpenHost,
}: Props) {
  const colors = useTheme();
  const urgency = urgencyFor(activity, now);
  const when = formatEventWhen(activity.starts_at, now, { permanent: activity.is_permanent });
  const distance = formatDistance(distanceKm ?? null);
  const hostName = activity.host?.name ?? 'Unbekannt';
  const saved = !!activity.is_saved;
  const joined = activity.is_joined;
  const full = urgency.full && !joined;

  const badge = urgency.tone === 'live' ? 'Läuft gerade' : urgency.tone === 'past' ? 'Vorbei' : urgency.label;

  return (
    <View style={[styles.post, { borderBottomColor: colors.backgroundSelected }]}>
      {/* Kopf */}
      <View style={styles.head}>
        <Pressable
          onPress={onOpenHost ? () => onOpenHost(activity) : undefined}
          disabled={!onOpenHost}
          style={styles.hostTap}
          accessibilityRole={onOpenHost ? 'link' : undefined}
          accessibilityLabel={onOpenHost ? `Profil von ${hostName}` : undefined}>
          <StoryAvatar size={34} avatar={activity.host?.avatar_url} name={hostName} />
          <View style={styles.headText}>
            <Text style={[styles.hostName, { color: colors.text }]} numberOfLines={1}>
              {isOwn ? 'Du' : hostName}
            </Text>
            <Text style={[styles.headSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {when}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* Bild */}
      <Pressable
        onPress={() => onOpen(activity)}
        accessibilityRole="button"
        accessibilityLabel={`${activity.title} öffnen`}>
        <View style={[styles.media, { backgroundColor: colors.backgroundElement }]}>
          {activity.banner_url ? (
            <Image
              source={{ uri: activity.banner_url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              accessible={false}
            />
          ) : (
            <LinearGradient
              colors={posterGradient(activity)}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, styles.poster]}>
              <CategoryIcon interest={activity.interests[0]} size={56} color="rgba(255,255,255,0.95)" />
              <Text style={styles.posterTitle} numberOfLines={3}>
                {activity.title}
              </Text>
            </LinearGradient>
          )}

          {badge || urgency.seatsLabel ? (
            <View style={styles.badges} pointerEvents="none">
              {badge ? (
                <View style={[styles.badge, urgency.glow && { backgroundColor: colors.tint }]}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
              {urgency.seatsLabel ? (
                <View style={[styles.badge, urgency.scarce && { backgroundColor: colors.tint }]}>
                  <Text style={styles.badgeText}>{urgency.seatsLabel}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* Aktionen */}
      <View style={styles.actions}>
        {!isOwn ? (
          <Pressable
            onPress={() => onToggleJoin(activity)}
            disabled={busy || full}
            accessibilityRole="button"
            accessibilityState={{ selected: joined, disabled: busy || full }}
            style={({ pressed }) => [
              styles.joinButton,
              joined
                ? { backgroundColor: colors.backgroundElement }
                : { backgroundColor: full ? colors.backgroundSelected : colors.tint },
              pressed && styles.pressed,
            ]}>
            {joined ? <Icon name="check" size={16} color={colors.text} /> : null}
            <Text
              style={[
                styles.joinLabel,
                { color: joined ? colors.text : full ? colors.textSecondary : colors.tintText },
              ]}>
              {joined ? 'Dabei' : full ? 'Ausgebucht' : 'Mitmachen'}
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.ownPill, { borderColor: colors.backgroundSelected }]}>
            <Text style={[styles.ownLabel, { color: colors.textSecondary }]}>Deine Aktivität</Text>
          </View>
        )}

        <ActionIcon
          icon="chat"
          label={joined || isOwn ? 'Chat öffnen' : 'Chat – erst nach dem Mitmachen'}
          color={joined || isOwn ? colors.text : colors.textSecondary}
          onPress={() => onChat(activity)}
        />
        <ActionIcon icon="send" label="Teilen" color={colors.text} onPress={() => onShare(activity)} />

        <View style={styles.spacer} />

        <ActionIcon
          icon={saved ? 'bookmark-filled' : 'bookmark'}
          label={saved ? 'Nicht mehr merken' : 'Merken'}
          color={colors.text}
          onPress={() => onToggleSave(activity)}
        />
      </View>

      {/* Text */}
      <Pressable onPress={() => onOpen(activity)} style={styles.body}>
        <Text style={[styles.count, { color: colors.text }]}>
          {activity.participants_count === 1
            ? '1 Person dabei'
            : `${activity.participants_count} Personen dabei`}
          {urgency.seatsFree != null && !urgency.full ? ` · ${urgency.seatsFree} frei` : ''}
        </Text>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {activity.title}
        </Text>
        <View style={styles.metaRow}>
          <Icon name="map-pin" size={14} color={colors.textSecondary} />
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {activity.location}
            {distance ? ` · ${distance}` : ''}
          </Text>
        </View>
        {activity.interests.length > 0 ? (
          <Text style={[styles.tags, { color: colors.tint }]} numberOfLines={1}>
            {activity.interests.map((i) => `#${i.name.replace(/\s+/g, '')}`).join(' ')}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function ActionIcon({
  icon,
  label,
  color,
  onPress,
}: {
  icon: 'chat' | 'send' | 'bookmark' | 'bookmark-filled';
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.actionIcon, pressed && styles.pressed]}>
      <Icon name={icon} size={26} color={color} />
    </Pressable>
  );
}

export const ActivityPost = memo(ActivityPostImpl);

const styles = StyleSheet.create({
  post: {
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  hostTap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, flexShrink: 1 },
  headText: { flexShrink: 1 },
  hostName: { fontFamily: FontFamily.bold, fontSize: 14 },
  headSub: { fontFamily: FontFamily.regular, fontSize: 12 },
  media: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
  },
  poster: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.three,
  },
  posterTitle: {
    color: '#ffffff',
    fontFamily: FontFamily.bold,
    fontSize: 26,
    lineHeight: 32,
    textAlign: 'center',
  },
  badges: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + 2,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 36,
  },
  joinLabel: { fontFamily: FontFamily.bold, fontSize: 14 },
  ownPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.field,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  ownLabel: { fontFamily: FontFamily.semibold, fontSize: 13 },
  actionIcon: { padding: 2 },
  spacer: { flex: 1 },
  pressed: { opacity: 0.6 },
  body: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two + 2, gap: 3 },
  count: { fontFamily: FontFamily.bold, fontSize: 13 },
  title: { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontFamily: FontFamily.regular, fontSize: 13, flexShrink: 1 },
  tags: { fontFamily: FontFamily.medium, fontSize: 13 },
});
