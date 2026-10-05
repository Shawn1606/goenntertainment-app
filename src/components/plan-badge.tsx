import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { FontFamily, PlanLook } from '@/constants/theme';
import { planFor, type PlanKey } from '@/domain/club';
import { CLUB_RULES } from '@/lib/club-rules';

/**
 * Die Club-Stufe als kleine Plakette: „Free Plan", „Gold Plan", „Platinum Plan".
 *
 * Gold und Platinum als Metall-Verlauf, Free als zurückhaltende Pille – damit
 * man die bezahlten Stufen sofort erkennt, ohne dass Free wie „zweite Klasse"
 * aussieht.
 */
export function PlanBadge({
  plan,
  size = 'normal',
  tone = 'plain',
}: {
  plan: PlanKey | string | null | undefined;
  size?: 'normal' | 'small';
  /** `night` = auf dem Club-Lila: Free als helle Pille, sonst verschwindet das Pink im Lila. */
  tone?: 'plain' | 'night';
}) {
  const info = planFor(CLUB_RULES, plan);
  const look = PlanLook[info.key];
  const small = size === 'small';

  if (info.key === 'free') {
    const bg = tone === 'night' ? 'rgba(255,255,255,0.16)' : look.badgeBg;
    const ink = tone === 'night' ? '#ffffff' : look.badgeText;
    return (
      <View style={[styles.pill, small && styles.pillSmall, { backgroundColor: bg }]}>
        <Icon name="sparkles" size={small ? 11 : 13} color={ink} />
        <Text style={[styles.text, small && styles.textSmall, { color: ink }]}>{info.name}</Text>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[...look.gradient]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.pill, small && styles.pillSmall, styles.metal, { borderColor: look.ring }]}>
      <Icon name="crown" size={small ? 11 : 13} color={look.ink} />
      <Text style={[styles.text, small && styles.textSmall, { color: look.ink }]}>{info.name}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  pillSmall: { paddingHorizontal: 7, paddingVertical: 2 },
  metal: { borderWidth: 1 },
  text: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 0.2 },
  textSmall: { fontSize: 10.5 },
});
