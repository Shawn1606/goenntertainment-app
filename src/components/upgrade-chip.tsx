import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandGradient, FontFamily, Spacing } from '@/constants/theme';
import { nextTier } from '@/domain/account';
import { useAuth } from '@/lib/auth-context';

/**
 * Das kleine Feld oben links: „Upgrade".
 *
 * Es ist der EINE Weg, auf dem die Kontostufen angeboten werden – erst in der
 * App, nicht bei der Anmeldung. Wer die höchste Stufe hat, sieht es nicht: ein
 * Angebot ohne Ziel ist nur Zierde.
 *
 * Bewusst ein Verlauf und kein Glas: Alles andere in der Kopfzeile ist Glas,
 * das Feld soll sich als Angebot davon abheben. Es öffnet den Bildschirm
 * `/upgrade` (statt eines Blattes), weil vier Stufen mit ihren Vorzügen mehr
 * Platz brauchen, als ein Blatt hergibt.
 */
export function UpgradeChip() {
  const router = useRouter();
  const { user } = useAuth();
  const target = nextTier(user?.account_type);

  if (!target) return null;

  return (
    <Pressable
      onPress={() => router.push('/upgrade')}
      accessibilityRole="button"
      accessibilityLabel={`Upgrade auf ${target.label}`}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}>
      <LinearGradient
        colors={[...BrandGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.chip}>
        <ThemedText style={styles.text}>Upgrade</ThemedText>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
  },
  text: {
    // Auf dem Verlauf steht die Schrift immer weiß – in beiden Farbschemata.
    color: '#ffffff',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    fontFamily: FontFamily.bold,
    letterSpacing: 0.2,
  },
  pressed: { opacity: 0.8 },
});
