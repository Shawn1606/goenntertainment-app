import { BrandGradientText } from '@/components/brand-gradient-text';

type Props = {
  size?: 'large' | 'small';
};

const FONT = { large: 54, small: 24 } as const;

/**
 * Fließende Wortmarke „GÖ4Fun" in geschwungener Script-Schrift (Pacifico) mit
 * Marken-Verlauf.
 *
 * Wichtig: Der Verlauf läuft auf dem Gerät über eine Maske (MaskedView), die
 * alles außerhalb der Text-Box abschneidet. Pacifico ragt oben (Ö-Punkte) und
 * an den Seiten (Schwünge) über die Box hinaus – deshalb rundum Innen-Padding,
 * damit nichts abgeschnitten wird.
 */
export function BrandLogo({ size = 'large' }: Props) {
  const fontSize = FONT[size];

  return (
    <BrandGradientText
      style={{
        fontFamily: 'Pacifico_400Regular',
        fontSize,
        lineHeight: fontSize * 1.2,
        paddingTop: fontSize * 0.42,
        paddingBottom: fontSize * 0.22,
        paddingHorizontal: fontSize * 0.22,
        textAlign: 'center',
      }}>
      GÖ4Fun
    </BrandGradientText>
  );
}
