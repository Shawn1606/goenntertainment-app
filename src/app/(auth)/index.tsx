import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthIllustration } from '@/components/auth-illustration';
import { BrandGradientText } from '@/components/brand-gradient-text';
import { GoennBackground } from '@/components/goenn-background';
import { LoginSheet } from '@/components/login-sheet';
import { BrandButton } from '@/components/ui/brand-button';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <GoennBackground>
      <View style={[styles.container, { paddingTop: insets.top + Spacing.five, paddingBottom: insets.bottom }]}>
        <View style={styles.hero}>
          <Text style={styles.welcome}>Willkommen bei</Text>
          <BrandGradientText style={styles.brand}>Gönntertainment</BrandGradientText>

          <Text style={styles.tagline}>Lege direkt los!</Text>

          <View style={styles.illustration}>
            <AuthIllustration />
          </View>

          <View style={styles.cta}>
            <BrandButton title="Anmelden" onPress={() => setSheetOpen(true)} />
            <Pressable onPress={() => setSheetOpen(true)} hitSlop={8}>
              <Text style={styles.hint}>oder nach oben wischen</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => setSheetOpen(true)} hitSlop={12} style={styles.bottomHandle}>
          <View style={styles.handle} />
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
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcome: {
    fontSize: 22,
    fontWeight: '500',
    color: '#4b5563',
    marginBottom: Spacing.one,
  },
  brand: {
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.five,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '500',
    color: '#4b5563',
    marginBottom: Spacing.four,
  },
  illustration: {
    marginBottom: Spacing.five,
    width: '100%',
    alignItems: 'center',
  },
  cta: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: Spacing.two,
  },
  hint: {
    fontSize: 13,
    color: Brand.textMuted,
  },
  bottomHandle: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: Brand.handle,
  },
});
