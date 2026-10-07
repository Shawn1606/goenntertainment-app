import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHeaderBackFallback } from '@/components/ui/header-back';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { FontFamily, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Gerüst der Sicherheits-Bildschirme (Passwort, Zwei-Faktor, Konto löschen):
 * Kopf mit Zurück, eine Überschrift, ein erklärender Satz, darunter der Inhalt.
 *
 * Alle drei sind Stack-Routen über der Tab-Leiste – ohne Zurück-Knopf wären sie
 * Sackgassen. Der Kopf kommt deshalb hier einmal fest mit.
 */
export function SecurityScreen({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const backFallback = useHeaderBackFallback('/settings');
  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      {/* Zurück-Knopf: der des App-Kopfes – ohne Verlauf (direkt geöffnet) führt er in die Einstellungen. */}
      <Stack.Screen options={{ headerShown: true, title, headerLeft: backFallback }} />
      <View style={styles.flex}>
        <KeyboardForm contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
          {intro ? <Text style={[styles.intro, { color: colors.textSecondary }]}>{intro}</Text> : null}
          {children}
        </KeyboardForm>
      </View>
    </View>
  );
}

export function SecurityNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' | 'good' }) {
  const colors = useTheme();
  const accent = tone === 'danger' ? '#ed4956' : tone === 'good' ? '#16a34a' : colors.textSecondary;
  return (
    <View style={[styles.note, { backgroundColor: colors.backgroundElement, borderLeftColor: accent }]}>
      <Text style={[styles.noteText, { color: colors.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  intro: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21 },
  note: { borderLeftWidth: 3, borderRadius: 8, padding: Spacing.three },
  noteText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20 },
});
