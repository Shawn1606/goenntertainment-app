import { useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthIllustration } from '@/components/auth-illustration';
import { BrandLogo } from '@/components/brand-logo';
import { GoennBackground } from '@/components/goenn-background';
import { LoginSheet } from '@/components/login-sheet';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Hochwischen öffnet das Login-Sheet.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -40) setSheetOpen(true);
      },
    }),
  ).current;

  return (
    <GoennBackground>
      <View
        {...pan.panHandlers}
        style={[styles.container, { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.top}>
          <Text style={styles.welcome}>Willkommen bei</Text>
          <BrandLogo size="large" />
          <Text style={styles.tagline}>Lege direkt los!</Text>
        </View>

        <View style={styles.spacer} />

        <View style={styles.mascot}>
          <AuthIllustration size="large" />
        </View>

        <Pressable onPress={() => setSheetOpen(true)} hitSlop={12} style={styles.hint}>
          <Text style={styles.hintArrow}>↑</Text>
          <Text style={styles.hintText}>Nach oben wischen zum Anmelden</Text>
        </Pressable>
      </View>

      <LoginSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </GoennBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  top: {
    alignItems: 'center',
  },
  welcome: {
    fontSize: 22,
    fontWeight: '500',
    color: '#4b5563',
    marginBottom: Spacing.two,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '500',
    color: '#4b5563',
    marginTop: Spacing.three,
  },
  spacer: {
    flex: 1,
  },
  mascot: {
    width: '100%',
    alignItems: 'center',
    marginBottom: Spacing.five,
  },
  hint: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  hintArrow: {
    fontSize: 26,
    lineHeight: 28,
    color: Brand.purple,
    fontWeight: '700',
  },
  hintText: {
    fontSize: 15,
    fontWeight: '600',
    color: Brand.textMuted,
  },
});
