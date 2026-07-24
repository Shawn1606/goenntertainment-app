import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/ui/primary-button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.hero}>
        <ThemedText type="small" themeColor="textSecondary">
          Willkommen bei
        </ThemedText>
        <ThemedText type="subtitle" style={{ color: theme.tint }}>
          Gönntertainment
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.tagline}>
          Lege direkt los!
        </ThemedText>

        <ThemedText style={styles.mascot}>🎉</ThemedText>
      </View>

      <View style={styles.actions}>
        <Link href="/login" asChild>
          <PrimaryButton title="Anmelden" />
        </Link>
        <Link href="/register" asChild>
          <PrimaryButton title="Konto erstellen" variant="secondary" />
        </Link>
      </View>
    </ThemedView>
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
    gap: Spacing.half,
  },
  tagline: {
    marginTop: Spacing.two,
  },
  mascot: {
    fontSize: 96,
    marginTop: Spacing.five,
  },
  actions: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
});
