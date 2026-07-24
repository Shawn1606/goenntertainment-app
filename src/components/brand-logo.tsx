import { StyleSheet, Text, View } from 'react-native';

import { BrandGradientText } from '@/components/brand-gradient-text';

type Props = {
  size?: 'large' | 'small';
};

const FONT = { large: 46, small: 20 } as const;

/**
 * Weiche Wortmarke wie in der Referenz: „GÖ" im Verlauf (Lila→Pink),
 * „4Fun" in ruhigem Grau daneben – fließend, ohne harte Elemente.
 */
export function BrandLogo({ size = 'large' }: Props) {
  const fontSize = FONT[size];

  return (
    <View style={styles.row}>
      <BrandGradientText style={{ fontSize, fontWeight: '800', letterSpacing: -0.5 }}>GÖ</BrandGradientText>
      <Text style={{ fontSize, fontWeight: '600', letterSpacing: -0.5, color: '#a8a2b5' }}>4Fun</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
