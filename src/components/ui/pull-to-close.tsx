/**
 * Eine Detailseite nach unten wegziehen (Nutzerwunsch Okt. 2026: „runter
 * scrollen, damit es verschwindet").
 *
 * `PullToCloseScroll` ersetzt die `ScrollView` einer Seite, die über den Tabs
 * liegt (Angebot, Partner, Ticket, Club …). Steht die Seite ganz oben und man
 * zieht weiter nach unten, wandert der Inhalt gedämpft mit, oben erscheint ein
 * runder Knopf mit Pfeil nach unten. Ab `PULL_TO_CLOSE` wird er farbig, das
 * Handy tickt einmal – Loslassen schließt die Seite (mit Schwung reicht weniger,
 * siehe `shouldClosePull` in src/domain/gestures.ts). Sonst federt alles zurück.
 *
 * Geschlossen wird mit „von unten ausblenden", damit die Seite die Bewegung des
 * Fingers fortsetzt, statt plötzlich nach rechts wegzugleiten.
 *
 * Nicht für Seiten mit „Ziehen zum Aktualisieren" (beides an derselben Stelle
 * wäre ein Ratespiel) und nicht für Formulare (wer tippt, soll nichts verlieren).
 *
 * Gebaut wie die Blätter (use-sheet-drag.ts): Die Geste läuft auf dem UI-Thread
 * GLEICHZEITIG mit der Liste und zieht nur, wenn die Liste beim Aufsetzen oben
 * stand. Darum hier kein Federn der Liste selbst (`bounces`, `overScrollMode`) –
 * das Mitwandern übernimmt die Geste.
 */
import { useNavigation } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/ui/icon';
import { PULL_TO_CLOSE, pullOffset, shouldClosePull } from '@/domain/gestures';
import { useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/go-back';
import * as haptics from '@/lib/haptics';

/** Senkrechter Weg nach unten, ab dem das Ziehen startet. */
const PULL_START = 12;
/** Waagerechter Weg, nach dem es aufgibt (Zurückwischen, waagerechte Reihen). */
const SIDEWAYS = 18;
const SPRING_BACK = { damping: 20, stiffness: 240, mass: 0.7 } as const;
/** Pause zwischen „Animation umstellen" und „zurück" – ein Durchlauf von React dazwischen. */
const CLOSE_DELAY_MS = 32;
/** Größe des Knopfs, der beim Ziehen oben erscheint. */
const KNOB = 38;

type Props = Omit<ScrollViewProps, 'onScroll' | 'scrollEventThrottle' | 'bounces' | 'overScrollMode'> & {
  children: ReactNode;
  /** Statt „zurück": was beim Wegziehen passieren soll. */
  onClose?: () => void;
  /**
   * Wo der Knopf erscheint (Abstand von oben). Seiten mit durchsichtigem Kopf über
   * einem Bild (Angebot, Partner) setzen ihn unter den Kopf, sonst läge er unter
   * dem Zurück-Knopf.
   */
  knobTop?: number;
};

export function PullToCloseScroll({ children, onClose, knobTop = 0, style, ...rest }: Props) {
  const colors = useTheme();
  const navigation = useNavigation();
  const scrollY = useSharedValue(0);
  const pull = useSharedValue(0);
  const allowed = useSharedValue(false);
  const armed = useSharedValue(false);

  const close = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    // Die Seite setzt die Bewegung nach unten fort, statt nach rechts wegzugleiten.
    // Erst die Animation umstellen, einen Augenblick später zurück – so gilt sie
    // schon für genau diesen Abgang.
    navigation.setOptions({ animation: 'fade_from_bottom' });
    setTimeout(goBack, CLOSE_DELAY_MS);
  }, [onClose, navigation]);

  const native = useMemo(() => Gesture.Native(), []);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(PULL_START)
        .failOffsetX([-SIDEWAYS, SIDEWAYS])
        .simultaneousWithExternalGesture(native)
        .onStart(() => {
          allowed.set(scrollY.get() <= 1);
          armed.set(false);
        })
        .onUpdate((event) => {
          if (!allowed.get()) return;
          const next = pullOffset(event.translationY);
          pull.set(next);
          const nowArmed = next >= PULL_TO_CLOSE;
          if (nowArmed !== armed.get()) {
            armed.set(nowArmed);
            if (nowArmed) scheduleOnRN(haptics.tap);
          }
        })
        .onEnd((event, success) => {
          if (!allowed.get()) return;
          allowed.set(false);
          if (success && shouldClosePull(pull.get(), event.velocityY)) {
            pull.set(withTiming(pull.get() + 40, { duration: 160 }));
            scheduleOnRN(close);
          } else {
            pull.set(withSpring(0, SPRING_BACK));
          }
        }),
    [native, allowed, armed, pull, scrollY, close],
  );

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  const contentStyle = useAnimatedStyle<ViewStyle>(() => ({ transform: [{ translateY: pull.value }] }));
  const knobStyle = useAnimatedStyle<ViewStyle>(() => ({
    opacity: interpolate(pull.value, [8, PULL_TO_CLOSE * 0.6], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(pull.value, [0, PULL_TO_CLOSE], [-KNOB, 14], 'clamp') }, { scale: interpolate(pull.value, [0, PULL_TO_CLOSE], [0.6, 1], 'clamp') }],
  }));
  const filledStyle = useAnimatedStyle<ViewStyle>(() => ({ opacity: interpolate(pull.value, [PULL_TO_CLOSE - 2, PULL_TO_CLOSE], [0, 1], 'clamp') }));

  return (
    <GestureDetector gesture={pan} userSelect="auto">
      <View style={[styles.fill, style]} collapsable={false}>
        <Animated.View style={[styles.fill, contentStyle]}>
          <GestureDetector gesture={native} userSelect="auto">
            <Animated.ScrollView {...rest} style={styles.fill} onScroll={onScroll} scrollEventThrottle={16} bounces={false} overScrollMode="never">
              {children}
            </Animated.ScrollView>
          </GestureDetector>
        </Animated.View>
        {/* Der Knopf erscheint nur beim Ziehen – oben in der Lücke, die der Inhalt freigibt. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.knobSlot, { top: knobTop }, knobStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <View style={[styles.knob, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.down}>
              <Icon name="chevron-right" size={20} color={colors.textSecondary} />
            </View>
          </View>
          <Animated.View style={[styles.knob, styles.knobFilled, { backgroundColor: colors.tint, borderColor: colors.tint }, filledStyle]}>
            <Icon name="close" size={18} color="#ffffff" />
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  knobSlot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  knobFilled: { position: 'absolute', top: 0 },
  /** Es gibt kein „Pfeil nach unten" – der nach rechts, um 90° gedreht. */
  down: { transform: [{ rotate: '90deg' }] },
});
