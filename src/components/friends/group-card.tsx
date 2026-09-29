/**
 * Eine Gruppe als Karte: Name, Mitglieder, Chat – und die Verwaltung.
 *
 * Stand vorher als 100-Zeilen-Block mitten in `src/app/(app)/friends.tsx`,
 * inklusive eines `api.addGroupMember`-Aufrufs direkt im `onPress` einer Pille.
 * Das war der eigentliche Grund für die Trennung: Eine Karte, die selbst mit dem
 * Netz redet, lässt sich nicht ansehen, ohne ein Backend zu haben – und der
 * Screen konnte den Fehlerfall nicht mehr an einer Stelle behandeln.
 *
 * Jetzt meldet die Karte nur, was jemand tun will (`onOpenChat`, `onAddMember`,
 * …). Was daraus folgt, entscheidet der Screen.
 *
 * ## Der Chat-Knopf ist der Hauptweg
 *
 * Seit es Gruppen-Chats gibt, ist „schreiben" die häufigste Absicht bei einer
 * Gruppe – häufiger als Aufnehmen oder Löschen. Deshalb steht er als voller Knopf
 * da und nicht als Symbol in einer Reihe von vier gleich aussehenden.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassCard, GlassChip } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { unreadBadge } from '@/domain/unread-badge';
import { useBrandSurface } from '@/hooks/use-theme';
import type { FriendGroup, PersonCard } from '@/lib/api';

export function GroupCard({
  group,
  friends,
  onOpenChat,
  onOpenProfile,
  onAddMember,
  onRename,
  onLeaveOrDelete,
}: {
  group: FriendGroup;
  /** Eigene Freunde – daraus entsteht die „Aufnehmen"-Liste. */
  friends: PersonCard[];
  onOpenChat: () => void;
  onOpenProfile: (person: PersonCard) => void;
  onAddMember: (person: PersonCard) => void;
  onRename: () => void;
  onLeaveOrDelete: () => void;
}) {
  const surface = useBrandSurface();
  const badge = unreadBadge(group.unread ?? 0);

  /** Freunde, die noch nicht drin sind. Leer = niemand mehr aufzunehmen. */
  const addable = friends.filter(
    (friend) => !group.members.some((member) => member.id === friend.id),
  );

  return (
    <GlassCard tone="card" style={styles.group}>
      <View style={styles.groupHead}>
        <Icon name="users" size={22} color={surface.accent} />
        <View style={styles.groupText}>
          <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
            {group.name}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {group.members.length === 1 ? 'Nur du' : `${group.members.length} Leute`}
            {group.is_owner ? ' · von dir angelegt' : ''}
          </ThemedText>
        </View>

        {group.is_owner ? (
          <Pressable
            onPress={onRename}
            accessibilityRole="button"
            accessibilityLabel={`Gruppe ${group.name} umbenennen`}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}>
            <Icon name="edit" size={18} color={surface.textMuted} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={onLeaveOrDelete}
          accessibilityRole="button"
          accessibilityLabel={
            group.is_owner ? `Gruppe ${group.name} löschen` : `Gruppe ${group.name} verlassen`
          }
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          <Icon name={group.is_owner ? 'trash' : 'close'} size={18} color={surface.textMuted} />
        </Pressable>
      </View>

      {/* Chat – der Hauptweg zur Gruppe. */}
      <Pressable
        onPress={onOpenChat}
        accessibilityRole="button"
        accessibilityLabel={
          badge ? `Chat von ${group.name}, ${group.unread} ungelesen` : `Chat von ${group.name}`
        }
        style={({ pressed }) => [
          styles.chatButton,
          { borderColor: surface.chipBorder, backgroundColor: surface.chipBg },
          pressed && styles.pressed,
        ]}>
        <Icon name="chat" size={18} color={surface.accent} />
        <ThemedText type="smallBold" style={{ color: surface.accent }}>
          {badge ? 'Neue Nachrichten' : 'Chat öffnen'}
        </ThemedText>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: surface.accent }]}>
            <ThemedText style={[styles.badgeText, { color: surface.accentText }]}>
              {badge}
            </ThemedText>
          </View>
        ) : null}
      </Pressable>

      <View style={styles.memberChips}>
        {group.members.map((member) => (
          <Pressable
            key={member.id}
            onPress={() => onOpenProfile(member)}
            accessibilityRole="button"
            accessibilityLabel={`Profil von ${member.name}`}
            style={({ pressed }) => pressed && styles.pressed}>
            <View
              style={[
                styles.memberChip,
                { backgroundColor: surface.chipBg, borderColor: surface.chipBorder },
              ]}>
              <ThemedText type="small" style={{ color: surface.chipText }}>
                {member.name}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </View>

      {group.is_owner && addable.length > 0 ? (
        <View style={styles.addWrap}>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            Aufnehmen:
          </ThemedText>
          <View style={styles.memberChips}>
            {addable.map((friend) => (
              <GlassChip
                key={friend.id}
                label={`+ ${friend.name}`}
                onPress={() => onAddMember(friend)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.three },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  groupText: { flex: 1, gap: 1 },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    paddingVertical: Spacing.three,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '800', fontFamily: FontFamily.bold },
  memberChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  memberChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  addWrap: { gap: Spacing.two },
  pressed: { opacity: 0.7 },
});
