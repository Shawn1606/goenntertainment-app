import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActivityPoster } from '@/components/feed/activity-poster';
import { StoryAvatar } from '@/components/story-avatar';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import { commentsLabel, formatCount, participantsSentence } from '@/domain/activity-social';
import { formatDistance } from '@/domain/distance';
import { formatEventWhen } from '@/domain/event-when';
import { urgencyFor } from '@/domain/urgency';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';

/**
 * Eine Aktivität als Beitrag im Feed.
 *
 *   ┌ Kopf:    Bild · Name · „Für dich · Passt zu Sport"            …
 *   ├ Bild:    4:5 mit abgerundeten Ecken; oben die Lage („in 40 Min"),
 *   │          unten Datum und Entfernung auf einem Schatten
 *   ├ Leiste:  Herz 12 · Sprechblase 4 · Teilen            Merken
 *   ├ Text:    Titel · wann · wo · wer ist dabei · Kommentare
 *   └ Knopf:   [        Mitmachen        ]  über die ganze Breite
 *
 * ## Warum das Mitmachen jetzt unten über die ganze Breite geht
 *
 * Vorher stand es als kleine Pille in der Symbolleiste, zwischen Chat und Teilen –
 * gleich groß wie ein Symbol, obwohl es die EINE Handlung ist, um die es hier
 * geht. Jetzt steht es dort, wo der Daumen nach dem Lesen ohnehin landet, mit
 * genug Fläche, um es nicht zu verfehlen. Die Symbolleiste gehört den Neben-
 * handlungen, die man von Instagram kennt: Herz, Kommentar, Teilen, Merken.
 *
 * ## Warum Datum und Ort doppelt stehen
 *
 * Auf dem Bild stehen sie als Abzeichen, damit man beim schnellen Scrollen die
 * Frage „wann?" beantwortet bekommt, ohne anzuhalten. Unten im Text stehen sie
 * vollständig (Straße, Uhrzeit) für den, der angehalten hat.
 */

type Props = {
  activity: Activity;
  now: Date;
  distanceKm?: number | null;
  /** Ist das die eigene Aktivität? Dann gibt es kein „Mitmachen". */
  isOwn: boolean;
  busy?: boolean;
  /** Warum der Feed das vorschlägt („Passt zu Sport") – nur im „Für dich"-Reiter. */
  reason?: string | null;
  onOpen: (activity: Activity) => void;
  onOpenComments: (activity: Activity) => void;
  onToggleJoin: (activity: Activity) => void;
  onToggleSave: (activity: Activity) => void;
  onToggleLike: (activity: Activity) => void;
  onShare: (activity: Activity) => void;
  onChat: (activity: Activity) => void;
  onMore: (activity: Activity) => void;
  onOpenHost?: (activity: Activity) => void;
};

function ActivityPostImpl({
  activity,
  now,
  distanceKm,
  isOwn,
  busy,
  reason,
  onOpen,
  onOpenComments,
  onToggleJoin,
  onToggleSave,
  onToggleLike,
  onShare,
  onChat,
  onMore,
  onOpenHost,
}: Props) {
  const colors = useTheme();
  const urgency = urgencyFor(activity, now);
  const when = formatEventWhen(activity.starts_at, now, { permanent: activity.is_permanent });
  const distance = formatDistance(distanceKm ?? null);
  const hostName = activity.host?.name ?? 'Unbekannt';
  const saved = !!activity.is_saved;
  const liked = !!activity.liked_by_me;
  const joined = activity.is_joined;
  const full = urgency.full && !joined;
  const likes = activity.likes_count ?? 0;
  const comments = activity.comments_count ?? 0;

  // Oben links nur, was drängt (läuft, gleich, vorbei). „Heute, 18:00" oder
  // „Morgen" stehen ohnehin unten im Datums-Abzeichen – doppelt wäre Lärm.
  const timeBadge = activity.is_permanent
    ? null
    : urgency.tone === 'live'
      ? 'Läuft gerade'
      : urgency.tone === 'past'
        ? 'Vorbei'
        : urgency.tone === 'soon'
          ? urgency.label
          : null;

  const people = activity.participants.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar_url ?? null }));
  const who = participantsSentence(
    activity.participants.map((p) => p.name),
    activity.participants_count,
  );

  return (
    <View style={styles.post}>
      {/* Kopf */}
      <View style={styles.head}>
        <Pressable
          onPress={onOpenHost ? () => onOpenHost(activity) : undefined}
          disabled={!onOpenHost}
          style={styles.hostTap}
          accessibilityRole={onOpenHost ? 'link' : undefined}
          accessibilityLabel={onOpenHost ? `Profil von ${hostName}` : undefined}>
          <StoryAvatar size={38} avatar={activity.host?.avatar_url} name={hostName} />
          <View style={styles.headText}>
            <Text style={[styles.hostName, { color: colors.text }]} numberOfLines={1}>
              {isOwn ? 'Du' : hostName}
            </Text>
            <View style={styles.headSubRow}>
              {reason ? (
                <>
                  <Icon name="sparkles" size={12} color={colors.tint} />
                  <Text style={[styles.headSub, { color: colors.tint }]} numberOfLines={1}>
                    Für dich · {reason}
                  </Text>
                </>
              ) : (
                <Text style={[styles.headSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {activity.is_permanent ? 'Dauerangebot · jederzeit' : when}
                </Text>
              )}
            </View>
          </View>
        </Pressable>
        <IconButton icon="more" label="Weitere Optionen" variant="plain" size={36} onPress={() => onMore(activity)} />
      </View>

      {/* Bild */}
      <Pressable
        onPress={() => onOpen(activity)}
        accessibilityRole="button"
        accessibilityLabel={`${activity.title} öffnen`}
        style={styles.mediaWrap}>
        <View style={[styles.media, { backgroundColor: colors.backgroundElement }]}>
          <ActivityPoster activity={activity} />

          {timeBadge || urgency.seatsLabel ? (
            <View style={styles.badges} pointerEvents="none">
              {timeBadge ? (
                <View style={[styles.badge, urgency.glow && { backgroundColor: colors.tint }]}>
                  {urgency.tone === 'live' ? <View style={styles.liveDot} /> : null}
                  <Text style={styles.badgeText}>{timeBadge}</Text>
                </View>
              ) : null}
              {urgency.seatsLabel ? (
                <View style={[styles.badge, urgency.scarce && { backgroundColor: colors.tint }]}>
                  <Text style={styles.badgeText}>{urgency.seatsLabel}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Unten: wann und wie weit – auf einem Schatten, damit es auch über
              einem hellen Foto lesbar bleibt. */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            style={styles.mediaShade}
            pointerEvents="none">
            <View style={styles.mediaChip}>
              <Icon name={activity.is_permanent ? 'sparkles' : 'calendar'} size={13} color="#ffffff" />
              <Text style={styles.mediaChipText} numberOfLines={1}>
                {when}
              </Text>
            </View>
            {distance ? (
              <View style={styles.mediaChip}>
                <Icon name="map-pin" size={13} color="#ffffff" />
                <Text style={styles.mediaChipText}>{distance}</Text>
              </View>
            ) : null}
          </LinearGradient>
        </View>
      </Pressable>

      {/* Symbolleiste */}
      <View style={styles.actions}>
        <ActionIcon
          icon={liked ? 'heart-filled' : 'heart'}
          color={liked ? colors.tint : colors.text}
          count={likes}
          label={liked ? 'Gefällt mir nicht mehr' : 'Gefällt mir'}
          selected={liked}
          onPress={() => onToggleLike(activity)}
        />
        <ActionIcon
          icon="chat"
          color={colors.text}
          count={comments}
          label="Kommentare"
          onPress={() => onOpenComments(activity)}
        />
        <ActionIcon icon="send" color={colors.text} label="Teilen" onPress={() => onShare(activity)} />
        <View style={styles.spacer} />
        <ActionIcon
          icon={saved ? 'bookmark-filled' : 'bookmark'}
          color={colors.text}
          label={saved ? 'Nicht mehr merken' : 'Merken'}
          selected={saved}
          onPress={() => onToggleSave(activity)}
        />
      </View>

      {/* Text */}
      <Pressable onPress={() => onOpen(activity)} style={styles.body} accessibilityRole="button">
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
        {activity.description ? (
          <Text style={[styles.description, { color: colors.text }]} numberOfLines={2}>
            {activity.description}
          </Text>
        ) : null}

        <View style={styles.peopleRow}>
          <AvatarStack people={people} total={activity.participants_count} size={24} />
          <Text style={[styles.people, { color: colors.textSecondary }]} numberOfLines={1}>
            {who ?? 'Noch niemand dabei – sei die:der Erste'}
            {urgency.seatsFree != null && !urgency.full ? ` · ${urgency.seatsFree} frei` : ''}
          </Text>
        </View>
      </Pressable>

      {commentsLabel(comments) ? (
        <Pressable onPress={() => onOpenComments(activity)} accessibilityRole="button" style={styles.commentsLink}>
          <Text style={[styles.commentsText, { color: colors.textSecondary }]}>{commentsLabel(comments)}</Text>
        </Pressable>
      ) : null}

      {/* Die eine Handlung */}
      <View style={styles.cta}>
        {isOwn ? (
          <PressableScale
            onPress={() => onChat(activity)}
            haptic="tap"
            scaleTo={0.98}
            accessibilityRole="button"
            accessibilityLabel="Event-Chat öffnen"
            style={[styles.ctaButton, { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected }]}>
            <Icon name="chat" size={18} color={colors.text} />
            <Text style={[styles.ctaLabel, { color: colors.text }]}>Deine Aktivität · Chat öffnen</Text>
          </PressableScale>
        ) : joined ? (
          <View style={styles.ctaRow}>
            {/* Die Hülle trägt das `flex`: PressableScale legt `style` auf die
                innere Fläche, der äußere Druckbereich würde sonst nicht wachsen. */}
            <View style={styles.flex}>
              <PressableScale
                onPress={() => onToggleJoin(activity)}
                disabled={busy}
                haptic="tap"
                scaleTo={0.98}
                accessibilityRole="button"
                accessibilityLabel="Du bist dabei – antippen zum Austreten"
                accessibilityState={{ selected: true, busy: !!busy }}
                style={[styles.ctaButton, { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected }]}>
                <Icon name="check" size={18} color={colors.tint} />
                <Text style={[styles.ctaLabel, { color: colors.text }]}>Du bist dabei</Text>
              </PressableScale>
            </View>
            <PressableScale
              onPress={() => onChat(activity)}
              haptic="tap"
              scaleTo={0.96}
              accessibilityRole="button"
              accessibilityLabel="Event-Chat öffnen"
              style={[styles.ctaButton, styles.ctaSquare, { backgroundColor: colors.backgroundElement, borderColor: colors.backgroundSelected }]}>
              <Icon name="chat" size={20} color={colors.text} />
            </PressableScale>
          </View>
        ) : full ? (
          <View style={[styles.ctaButton, { backgroundColor: colors.backgroundSelected, borderColor: 'transparent' }]}>
            <Text style={[styles.ctaLabel, { color: colors.textSecondary }]}>Ausgebucht</Text>
          </View>
        ) : (
          <PressableScale
            onPress={() => onToggleJoin(activity)}
            disabled={busy}
            haptic="press"
            scaleTo={0.98}
            accessibilityRole="button"
            accessibilityLabel={`Bei ${activity.title} mitmachen`}
            accessibilityState={{ busy: !!busy }}
            style={styles.ctaPrimaryWrap}>
            <LinearGradient
              colors={[...BrandGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.ctaButton, styles.ctaPrimary]}>
              <Icon name="plus" size={18} color="#ffffff" />
              <Text style={[styles.ctaLabel, { color: '#ffffff' }]}>{busy ? 'Einen Moment …' : 'Mitmachen'}</Text>
            </LinearGradient>
          </PressableScale>
        )}
      </View>
    </View>
  );
}

function ActionIcon({
  icon,
  label,
  color,
  count,
  selected,
  onPress,
}: {
  icon: 'heart' | 'heart-filled' | 'chat' | 'send' | 'bookmark' | 'bookmark-filled';
  label: string;
  color: string;
  count?: number;
  selected?: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      scaleTo={0.86}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      accessibilityState={{ selected: !!selected }}
      style={styles.actionIcon}>
      <Icon name={icon} size={26} color={color} />
      {count ? <Text style={[styles.actionCount, { color: colors.text }]}>{formatCount(count)}</Text> : null}
    </PressableScale>
  );
}

export const ActivityPost = memo(ActivityPostImpl);

const styles = StyleSheet.create({
  post: {
    paddingBottom: Spacing.four,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two + 2,
  },
  hostTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  headText: { flexShrink: 1, gap: 1 },
  headSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hostName: { fontFamily: FontFamily.bold, fontSize: 14 },
  headSub: { fontFamily: FontFamily.medium, fontSize: 12, flexShrink: 1 },
  mediaWrap: { paddingHorizontal: Spacing.two + 2 },
  media: {
    width: '100%',
    aspectRatio: 4 / 5,
    maxHeight: 620,
    overflow: 'hidden',
    borderRadius: Radius.panel + 2,
  },
  badges: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ffffff' },
  badgeText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 12 },
  mediaShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.three,
  },
  mediaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 5,
  },
  mediaChipText: { color: '#ffffff', fontFamily: FontFamily.semibold, fontSize: 12 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three + 2,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + 2,
  },
  actionIcon: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 },
  actionCount: { fontFamily: FontFamily.semibold, fontSize: 14 },
  spacer: { flex: 1 },
  body: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two + 2, gap: 5 },
  title: { fontFamily: FontFamily.bold, fontSize: 17, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontFamily: FontFamily.medium, fontSize: 13, flexShrink: 1 },
  description: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 19 },
  peopleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
  people: { fontFamily: FontFamily.medium, fontSize: 13, flexShrink: 1 },
  commentsLink: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  commentsText: { fontFamily: FontFamily.medium, fontSize: 13 },
  cta: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  ctaRow: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 46,
    borderRadius: Radius.card + 2,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  ctaSquare: { width: 46, paddingHorizontal: 0 },
  ctaPrimaryWrap: { borderRadius: Radius.card + 2, overflow: 'hidden' },
  ctaPrimary: { borderWidth: 0 },
  ctaLabel: { fontFamily: FontFamily.bold, fontSize: 15 },
});
