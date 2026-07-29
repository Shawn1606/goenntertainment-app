import { BrandGradientText } from '@/components/brand-gradient-text';

type Props = {
  size?: 'large' | 'small';
};

const FONT = { large: 54, small: 24 } as const;

/**
 * Fließende Wortmarke „GÖ4Fun" in geschwungener Script-Schrift (Pacifico) mit
 * Marken-Verlauf – der flowy Look wie in der Referenz. Das große „GÖ" sticht
 * durch die Großbuchstaben natürlich heraus.
 *
 * Pacifico ist eine Schreibschrift: Der Schwung des „G" ragt nach links über
 * die Laufweite hinaus, die Umlautpunkte des „Ö" über die Versalhöhe. Ohne
 * Innenabstand schneidet die Textbox beides ab (auf Android zusätzlich der
 * enge `lineHeight`). Darum ringsum bewusst Luft – die Maske des Verlaufs
 * bekommt denselben Stil und bleibt deckungsgleich.
 */
export function BrandLogo({ size = 'large' }: Props) {
  const fontSize = FONT[size];

  return (
    <BrandGradientText
      style={{
        fontFamily: 'Pacifico_400Regular',
        fontSize,
        // 1,8 × Schriftgröße: Pacificos natürliche Zeilenbox braucht bei dieser
        // Größe rund 1,75 × – darunter kappt Android die Umlautpunkte.
        lineHeight: Math.round(fontSize * 1.8),
        paddingHorizontal: Math.round(fontSize * 0.18),
        paddingVertical: Math.round(fontSize * 0.12),
        includeFontPadding: true,
        textAlignVertical: 'center',
      }}>
      GÖ4Fun
    </BrandGradientText>
  );
}
