/**
 * Zeichen für die Social-Plattformen eines Profils.
 *
 * Warum ein eigenes Set und nicht das UI-Icon-Set: Das hier sind **Marken**,
 * keine Bedeutungen. „Zahnrad" heißt überall Einstellungen; „Instagram" heißt
 * nur Instagram. Deshalb liegen sie getrennt – und deshalb hängt die Zuordnung
 * am `key` aus `src/domain/social-links.ts` statt an einem zweiten Feld, das
 * dasselbe nochmal sagt.
 *
 * Gezeichnet als vereinfachte Linien-Marken im Stil des restlichen Sets. Das
 * ist Absicht: Bunte Original-Logos würden in einer Liste aus einfarbigen
 * Strich-Icons wie Aufkleber wirken, und sie ließen sich nicht in Akzent- oder
 * Graufarbe einfärben – dieselbe Falle wie bei den Emojis vorher.
 */
import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect, type SvgProps } from 'react-native-svg';

import type { SocialPlatform } from '@/domain/social-links';

type SocialIconProps = SvgProps & {
  platform: SocialPlatform | string;
  size?: number;
  color?: string;
  /** Vorgelesener Name (meist das `label` der Plattform). Ohne Label: Deko. */
  label?: string;
};

/** Nur die Innenzeichnung. Strichbreite und Farbe kommen von der Hülle. */
function shapeFor(platform: string, color: string): ReactNode {
  switch (platform) {
    case 'instagram':
      return (
        <>
          <Rect x={3.5} y={3.5} width={17} height={17} rx={4.6} />
          <Circle cx={12} cy={12} r={4} />
          <Circle cx={16.7} cy={7.3} r={1} fill={color} stroke="none" />
        </>
      );
    case 'tiktok':
      // Die Note mit dem Haken oben rechts – das ist die erkennbare Form.
      return (
        <>
          <Path d="M14.2 3.6v9.9a3.6 3.6 0 1 1-3.6-3.6c.4 0 .77.06 1.12.18" />
          <Path d="M14.2 3.6c.32 2.44 1.94 4.06 4.36 4.24" />
        </>
      );
    case 'youtube':
      return (
        <>
          <Rect x={2.6} y={6} width={18.8} height={12} rx={3.4} />
          <Path d="M10.4 9.6l4.8 2.4-4.8 2.4z" />
        </>
      );
    case 'x':
      // Zwei gekreuzte Striche. Daneben steht immer „X" als Text – zusammen
      // ist es eindeutig, und die Marke ist nun einmal genau das.
      return <Path d="M5 5l14 14M19 5 5 19" />;
    case 'facebook':
      return (
        <>
          <Rect x={3.5} y={3.5} width={17} height={17} rx={4.6} />
          <Path d="M14.8 8.4h-1.6a1.9 1.9 0 0 0-1.9 1.9v6.9M9.6 12.6h4.4" />
        </>
      );
    case 'twitch':
      return (
        <>
          <Path d="M4.5 4.2h15v9.9l-3.6 3.6h-3l-2.8 2.6v-2.6H4.5z" />
          <Path d="M10.4 8v4M14.6 8v4" />
        </>
      );
    case 'linkedin':
      return (
        <>
          <Rect x={3.5} y={3.5} width={17} height={17} rx={4} />
          <Circle cx={8} cy={7.9} r={0.95} fill={color} stroke="none" />
          <Path d="M8 10.8v5.8M12 16.6v-5.8M12 13c0-1.3 1-2.2 2.3-2.2s2.2.9 2.2 2.2v3.6" />
        </>
      );
    case 'website':
    default:
      // Weltkugel – auch der Rückfall für alles, was wir (noch) nicht kennen.
      return (
        <>
          <Circle cx={12} cy={12} r={8.4} />
          <Path d="M3.6 12h16.8" />
          <Path d="M12 3.6c2.2 2.3 3.4 5.2 3.4 8.4S14.2 18.1 12 20.4c-2.2-2.3-3.4-5.2-3.4-8.4S9.8 5.9 12 3.6Z" />
        </>
      );
  }
}

export function SocialIcon({
  platform,
  size = 20,
  color = '#6366f1',
  label,
  ...rest
}: SocialIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      {...rest}>
      <G stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {shapeFor(platform, color)}
      </G>
    </Svg>
  );
}
