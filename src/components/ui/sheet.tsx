import type { ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { useSheetDrag } from '@/components/ui/use-sheet-drag';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Ein Blatt von unten – für kurze Entscheidungen (Credits kaufen, Zahlart,
 * Gruppe wählen). Schließen geht auf drei Wegen: der Knopf oben rechts (immer
 * sichtbar – Wischen allein findet nicht jeder), nach unten wischen am Griff,
 * oder daneben tippen. Der Inhalt scrollt, wenn er höher ist als das Blatt.
 *
 * Bewusst OHNE Texteingabe darin: Tastatur in einem Modal ist auf Android mit
 * edge-to-edge unzuverlässig (siehe KeyboardForm). Wer tippen muss, bekommt
 * einen eigenen Bildschirm.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const drag = useSheetDrag({ onDismiss: onClose, open: visible });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Schließen" />
        <Animated.View
          onLayout={drag.onSheetLayout}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: insets.bottom + Spacing.three,
              transform: [{ translateY: drag.dragY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' }) }],
            },
          ]}>
          <View {...drag.headPan.panHandlers} style={styles.head}>
            <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
            {/* Position an einer Hülle: PressableScale legt `style` auf die innere Fläche. */}
            <View style={styles.close}>
              <IconButton icon="close" label="Schließen" onPress={onClose} size={36} />
            </View>
            {title ? (
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
          </View>
          <ScrollView bounces={false} style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(12,4,24,0.55)' },
  sheet: {
    borderTopLeftRadius: Radius.panel + 4,
    borderTopRightRadius: Radius.panel + 4,
    borderWidth: Stroke,
    borderBottomWidth: 0,
    width: '100%',
    maxWidth: MaxContentWidth,
    maxHeight: '88%',
    alignSelf: 'center',
  },
  head: { paddingTop: Spacing.two, paddingHorizontal: Spacing.six, paddingBottom: Spacing.two, alignItems: 'center', gap: 4 },
  close: { position: 'absolute', top: Spacing.three, right: Spacing.three },
  handle: { width: 44, height: 5, borderRadius: 3, marginBottom: Spacing.two },
  title: { fontFamily: FontFamily.bold, fontSize: 20, textAlign: 'center' },
  subtitle: { fontFamily: FontFamily.regular, fontSize: 14, textAlign: 'center' },
  // flexShrink: Ohne darf die Liste höher werden als das Blatt – dann scrollt nichts.
  scroll: { flexShrink: 1 },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.three },
});
