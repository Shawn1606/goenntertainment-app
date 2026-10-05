/**
 * Die Kopfzeile der drei Tabs: Logo links, Credits in der Mitte, du rechts.
 *
 * Die Credits stehen MITTIG, weil sie das sind, worauf man in dieser App achtet:
 * Wie viel habe ich, was kann ich mir holen? Antippen öffnet das Kauf-Blatt.
 * Das Profilbild rechts trägt einen Ring in der Farbe der Club-Stufe – Gold und
 * Platinum sieht man so auf jedem Bildschirm.
 */
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLogo } from '@/components/brand-logo';
import { useCreditsSheet } from '@/components/credits-sheet';
import { CountUp } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, PlanLook, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, planFor } from '@/domain/club';
import { initialsOf } from '@/domain/initials';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';

export function TopBar({ below }: { below?: ReactNode }) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const credits = useCreditsSheet();

  const plan = planFor(CLUB_RULES, user?.club_plan);
  const look = PlanLook[plan.key];

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + Spacing.one, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          <BrandLogo size="small" />
        </View>

        <PressableScale
          onPress={() => credits.open()}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={`${user?.credits_balance ?? 0} Credits. Antippen zum Aufladen.`}
          style={[styles.pill, { borderColor: '#f0c44c', backgroundColor: colors.background }]}>
          <View style={styles.coin}>
            <Icon name="coin" size={18} color="#b27b00" />
          </View>
          <CountUp value={user?.credits_balance ?? 0} format={formatCredits} style={[styles.pillValue, { color: colors.text }]} />
          <View style={[styles.plus, { backgroundColor: colors.tint }]}>
            <Icon name="plus" size={12} color="#ffffff" />
          </View>
        </PressableScale>

        <View style={[styles.side, styles.sideRight]}>
          <PressableScale
            onPress={() => router.push('/account')}
            accessibilityRole="button"
            accessibilityLabel={`Dein Konto, ${plan.name}`}
            style={[styles.avatarRing, { borderColor: look.ring }]}>
            <View style={[styles.avatar, { backgroundColor: colors.backgroundSelected }]}>
              {user?.avatar ? (
                <Image source={{ uri: user.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" accessible={false} />
              ) : (
                <Text style={[styles.initials, { color: colors.text }]}>{initialsOf(user?.name ?? '')}</Text>
              )}
            </View>
            {plan.key !== 'free' ? (
              <View style={[styles.crown, { backgroundColor: look.ring, borderColor: colors.background }]}>
                <Icon name="crown" size={9} color="#ffffff" />
              </View>
            ) : null}
          </PressableScale>
        </View>
      </View>
      {below}
    </View>
  );
}


const AVATAR = 34;

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: Stroke, zIndex: 5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    minHeight: 52,
  },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderRadius: 999,
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 3,
  },
  coin: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#ffe9a3', alignItems: 'center', justifyContent: 'center' },
  pillValue: { fontFamily: FontFamily.bold, fontSize: 16, minWidth: 28, textAlign: 'center' },
  plus: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { width: AVATAR + 8, height: AVATAR + 8, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FontFamily.bold, fontSize: 13 },
  crown: { position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
