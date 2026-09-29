import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Spacing } from '@/constants/theme';
import type { PasswordScore } from '@/domain/password-strength';
import { useTheme } from '@/hooks/use-theme';
import { passwordStrength } from '@/lib/password-strength';

/**
 * Stärke-Anzeige unter einem Passwortfeld: vier Balken, ein Wort, ein Tipp.
 *
 * Vier Balken statt Prozentzahl, weil man eine Ampel ohne Lesen versteht. Der
 * Tipp darunter ist der wichtigste EINE nächste Schritt – eine Liste mit fünf
 * Regeln liest niemand, einen Satz schon.
 *
 * `personal` sind Name, Benutzername und E-Mail: Ein Passwort, das den eigenen
 * Namen enthält, ist das Erste, was ein Angreifer probiert.
 */
const COLORS: Record<PasswordScore, string> = {
  0: '#ed4956',
  1: '#f97316',
  2: '#eab308',
  3: '#22c55e',
  4: '#16a34a',
};

export function PasswordMeter({
  password,
  personal = [],
}: {
  password: string;
  personal?: (string | null | undefined)[];
}) {
  const colors = useTheme();
  if (!password) return null;

  const result = passwordStrength(password, personal);
  const active = result.score === 0 ? 1 : result.score;
  const color = COLORS[result.score];
  const hint = result.hints[0];

  return (
    <View
      style={styles.root}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Passwortstärke: ${result.label}.${hint ? ` ${hint}` : ''}`}>
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={[styles.bar, { backgroundColor: i <= active ? color : colors.backgroundSelected }]}
          />
        ))}
      </View>
      <Text style={[styles.label, { color }]}>
        {result.label}
        {!result.meetsPolicy ? <Text style={{ color: colors.textSecondary }}> · noch nicht zulässig</Text> : null}
      </Text>
      {hint ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.one, marginTop: -Spacing.one, marginBottom: Spacing.two },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  label: { fontFamily: FontFamily.bold, fontSize: 12 },
  hint: { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 16 },
});
