import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthIllustration } from '@/components/auth-illustration';
import { BrandLogo } from '@/components/brand-logo';
import { GoennBackground } from '@/components/goenn-background';
import { LoginPanel } from '@/components/login-panel';
import { Brand, MaxContentWidth, Spacing, FontFamily } from '@/constants/theme';

type Mode = 'welcome' | 'login';

// Auf dem Handy nativer Treiber (flüssig, 60fps); im Web JS-Treiber.
const NATIVE = Platform.OS !== 'web';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  /**
   * Höhe EINMALIG beim Einhängen lesen, nicht über `useWindowDimensions()`.
   *
   * Unter dem ab SDK 54 erzwungenen edge-to-edge schrumpft das Fenster, sobald
   * die Tastatur aufgeht. Hing die Schiebe-Strecke daran, wurden bei jedem
   * Tastendruck im Login beide `interpolate`-Knoten neu gebaut und dem
   * Animated.View untergeschoben – das Panel zuckte unter den Fingern weg.
   * Die App ist auf Hochformat festgelegt, also ist dieses Maß ohnehin fest.
   */
  const [{ height }] = useState(() => Dimensions.get('window'));
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
          </View>

          {/* Bewusst mit Abstand unter der Wortmarke: das Logo bekommt Luft,
              der Aufruf steht für sich statt direkt darunter zu kleben. */}
          <View style={styles.taglineWrap}>
            <Text style={styles.tagline}>Lege direkt los!</Text>
          </View>

          <View style={styles.spacer} />

          <View style={styles.mascot}>
            <AuthIllustration size={height >= 720 ? 'large' : 'normal'} />
          </View>

          <View style={styles.spacer} />

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
    fontFamily: FontFamily.medium,
  },
  taglineWrap: {
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  tagline: {
    fontSize: 17,
    fontWeight: '600',
    color: Brand.purple,
    fontFamily: FontFamily.semibold,
    backgroundColor: 'rgba(99,102,241,0.10)',
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    overflow: 'hidden',
  },
  spacer: {
    flex: 1,
  },
  mascot: {
    width: '100%',
    alignItems: 'center',
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
    fontFamily: FontFamily.bold,
  },
  hintText: {
    fontSize: 15,
    fontWeight: '600',
    color: Brand.textMuted,
    fontFamily: FontFamily.semibold,
  },
});
