import { BrandGradientText } from '@/components/brand-gradient-text';

type Props = {
  size?: 'large' | 'small';
};

const FONT = { large: 54, small: 24 } as const;

/**
 * Fließende Wortmarke „GÖ4Fun" in geschwungener Script-Schrift (Pacifico) mit
 * Marken-Verlauf – der flowy Look wie in der Referenz. Das große „GÖ" sticht
 * durch die Großbuchstaben natürlich heraus.
 */
export function BrandLogo({ size = 'large' }: Props) {
  const fontSize = FONT[size];

  return (
    <BrandGradientText
      style={{ fontFamily: 'Pacifico_400Regular', fontSize, lineHeight: fontSize * 1.45 }}>
      GÖ4Fun
    </BrandGradientText>
  );
}
