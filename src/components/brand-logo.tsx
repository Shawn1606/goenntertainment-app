import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { BrandGradientText } from '@/components/brand-gradient-text';
import { Brand, BrandGradient } from '@/constants/theme';

type Props = {
  size?: 'large' | 'small';
};

const SIZES = {
  large: { goe: 66, fun: 48, badge: 44, badgeFont: 27, gap: 3 },
  small: { goe: 24, fun: 18, badge: 20, badgeFont: 13, gap: 2 },
} as const;

/**
 * Logo-Wortmarke: GÖ (Verlauf) · die 4 als runde Badge · Fun (dunkel, kräftig).
 * So wirkt „GÖ4Fun" wie ein echtes Logo statt wie einfacher Text.
 */
export function BrandLogo({ size = 'large' }: Props) {
  const s = SIZES[size];

  return (
    <View style={styles.row}>
      <BrandGradientText style={{ fontSize: s.goe, fontWeight: '800', lineHeight: s.goe * 1.02 }}>
        GÖ
      </BrandGradientText>

      <LinearGradient
        colors={BrandGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.badge,
          { width: s.badge, height: s.badge, borderRadius: s.badge / 2, marginHorizontal: s.gap },
        ]}>
        <Text style={[styles.badgeText, { fontSize: s.badgeFont }]}>4</Text>
      </LinearGradient>

      <Text style={{ fontSize: s.fun, fontWeight: '800', color: Brand.text, letterSpacing: -0.5 }}>Fun</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontWeight: '800',
  },
});
