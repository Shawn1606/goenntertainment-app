import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthIllustration } from '@/components/auth-illustration';
import { BrandLogo } from '@/components/brand-logo';
import { GoennBackground } from '@/components/goenn-background';
import { LoginPanel } from '@/components/login-panel';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';

type Mode = 'welcome' | 'login';

// Auf dem Handy nativer Treiber (flüssig, 60fps); im Web JS-Treiber.
const NATIVE = Platform.OS !== 'web';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('welcome');

  // progress: 0 = Start-Screen sichtbar, 1 = Login sichtbar.
  // Start- und Login-Ebene sind gekoppelt: Start wird nach oben weggeschoben,
  // während der Login von unten hochkommt – beide bewegen sich gleichzeitig.
  const progress = useRef(new Animated.Value(0)).current;
  const progressVal = useRef(0);
  const startProg = useRef(0);

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressVal.current = value;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  const welcomeTranslate = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [0, -height] }),
    [progress, height],
  );
  const loginTranslate = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
    [progress, height],
  );

  function animateTo(target: number, next: Mode) {
    setMode(next);
    Animated.spring(progress, {
      toValue: target,
      useNativeDriver: NATIVE,
      bounciness: 4,
      speed: 12,
    }).start();
  }

  const openLogin = () => animateTo(1, 'login');
  const backToWelcome = () => animateTo(0, 'welcome');

  // Hochwischen auf dem Start-Screen zieht Start + Login gemeinsam nach oben.
  // Nur echte vertikale Drags (ab 14px) übernehmen die Geste – Taps bleiben unberührt.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 14 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        startProg.current = progressVal.current;
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dy) < 14) return;
        const p = Math.min(1, Math.max(0, startProg.current + -g.dy / height));
        progress.setValue(p);
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dy) < 14) return;
        const p = Math.min(1, Math.max(0, startProg.current + -g.dy / height));
        const goOpen = p > 0.35 || g.vy < -0.4;
        animateTo(goOpen ? 1 : 0, goOpen ? 'login' : 'welcome');
      },
    }),
  ).current;

  return (
    <GoennBackground>
      {/* Start-Ebene */}
      <Animated.View
        {...pan.panHandlers}
        pointerEvents={mode === 'login' ? 'none' : 'auto'}
        style={[
          StyleSheet.absoluteFill,
          styles.layer,
          { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.four, transform: [{ translateY: welcomeTranslate }] },
        ]}>
        <View style={styles.inner}>
          <View style={styles.top}>
            <Text style={styles.welcome}>Willkommen bei</Text>
            <BrandLogo size="large" />
            <Text style={styles.tagline}>Lege direkt los!</Text>
          </View>

          <View style={styles.spacer} />

          <View style={styles.mascot}>
            <AuthIllustration size="large" />
          </View>

          <Pressable onPress={openLogin} hitSlop={12} style={styles.hint}>
            <Text style={styles.hintArrow}>↑</Text>
            <Text style={styles.hintText}>Nach oben wischen zum Anmelden</Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* Login-Ebene – kommt von unten hoch, gekoppelt an die Start-Ebene */}
      <Animated.View
        pointerEvents={mode === 'login' ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, { transform: [{ translateY: loginTranslate }] }]}>
        <LoginPanel active={mode === 'login'} onBack={backToWelcome} />
      </Animated.View>
    </GoennBackground>
  );
}

const styles = StyleSheet.create({
  layer: {
    width: '100%',
  },
  inner: {
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
