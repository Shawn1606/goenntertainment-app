import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect, type SvgProps } from 'react-native-svg';

import { categoryIcon, type CategoryIconName } from '@/domain/category-icon';

/**
 * Kategorie-Icons im Marken-Look (Stroke-SVG, kein Icon-Paket) – der einfarbige
 * Ersatz für die früheren Kategorie-Emojis. Welcher Name zu welcher Kategorie
 * gehört, entscheidet die reine Logik in `src/domain/category-icon.ts`; hier
 * liegt nur die Zeichnung. Jeder dort deklarierte Name hat genau einen Eintrag
 * (ein Test in der Domäne wacht über die Vollständigkeit).
 */

type InterestLike = { name?: string | null; icon?: string | null };

type CategoryIconProps = SvgProps & {
  /** Entweder direkt ein Name … */
  name?: CategoryIconName;
  /** … oder eine Kategorie, aus der der Name abgeleitet wird. */
  interest?: InterestLike | null;
  size?: number;
  color?: string;
  /** Vorgelesener Name; ohne Label gilt das Icon als reine Deko. */
  label?: string;
};

/**
 * Nur die Innenzeichnung je Name. Stroke/Farbe/Größe kommen von der Hülle,
 * damit jede Zeichnung knapp bleibt. Gefüllte Punkte setzen `fill`/`stroke`
 * selbst und überschreiben die Gruppe.
 */
function shapeFor(name: CategoryIconName, color: string): ReactNode {
  const dot = (cx: number, cy: number, r = 1.1) => (
    <Circle cx={cx} cy={cy} r={r} fill={color} stroke="none" />
  );
  switch (name) {
    case 'bike':
      return (
        <>
          <Circle cx={5.6} cy={17} r={3.3} />
          <Circle cx={18.4} cy={17} r={3.3} />
          <Path d="M5.6 17 10 9h4.5l3.9 8M10 9l2.4 8M8.2 9H11M14.5 9l1.6-2.4" />
        </>
      );
    case 'ball':
      return (
        <>
          <Circle cx={12} cy={12} r={8} />
          <Path d="M12 5.2l3.2 2.4-1.2 3.9h-4L8.8 7.6zM4.4 10.6l3.4 1.2M19.6 10.6l-3.4 1.2M8.6 18.4l1.6-3.2M15.4 18.4l-1.6-3.2" />
        </>
      );
    case 'run':
      return (
        <>
          <Circle cx={14.5} cy={5.5} r={1.9} />
          <Path d="M14 8.4l-3 2.6 2.3 2.2.6 4.8M11 11l-3.4 1.1M13.3 15.2l3.2 1.4M7.8 20l3.2-3.8" />
        </>
      );
    case 'dumbbell':
      return <Path d="M4 9v6M7 6.5v11M17 6.5v11M20 9v6M7 12h10" />;
    case 'yoga':
      return (
        <>
          <Circle cx={12} cy={5.6} r={2} />
          <Path d="M12 7.8v4.4M6 18.5c0-2.6 2.7-4.5 6-4.5s6 1.9 6 4.5zM7.5 12.2 12 14.4l4.5-2.2" />
        </>
      );
    case 'hike':
      return (
        <>
          <Circle cx={17} cy={6.6} r={1.5} />
          <Path d="M3 19h18M6 19l4.6-8.2 3 5.2 2.1-3.2L19 19" />
        </>
      );
    case 'wave':
      return (
        <Path d="M3 8.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 17.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      );
    case 'camera':
      return (
        <>
          <Path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
          <Circle cx={12} cy={13} r={3.1} />
        </>
      );
    case 'film':
      return <Path d="M4 8h16v11H4zM4 12h16M6.5 5 5 8M11 4.5 9.5 8M15.5 5 14 8M19 5.5 17.5 8" />;
    case 'music':
      return (
        <>
          <Circle cx={7.5} cy={17} r={2.4} fill={color} stroke="none" />
          <Circle cx={16} cy={15} r={2.4} fill={color} stroke="none" />
          <Path d="M9.9 17V6.2l8.5-2v10.8" />
        </>
      );
    case 'mic':
      return <Path d="M12 3.5a3 3 0 0 1 3 3v4.5a3 3 0 0 1-6 0V6.5a3 3 0 0 1 3-3ZM6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9 20h6" />;
    case 'gamepad':
      return (
        <>
          <Path d="M7.5 9h9a4 4 0 0 1 3.9 3.1l.8 3.6a2.3 2.3 0 0 1-4.2 1.7L15.5 16h-7l-1.3 1.4a2.3 2.3 0 0 1-4.2-1.7l.8-3.6A4 4 0 0 1 7.5 9ZM7 12v3M5.5 13.5h3" />
          {dot(15.8, 12.6)}
          {dot(17.6, 14.4)}
        </>
      );
    case 'dice':
      return (
        <>
          <Rect x={5} y={5} width={14} height={14} rx={3} />
          {dot(9, 9, 1.05)}
          {dot(15, 15, 1.05)}
          {dot(12, 12, 1.05)}
        </>
      );
    case 'plane':
      return <Path d="M21 3 2.6 10.4 10 13l2.6 7.4L21 3ZM10 13l5.6-6.6" />;
    case 'cooking':
      return <Path d="M4 11h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-3ZM7 11V9a5 5 0 0 1 10 0v2M3 13.5h1M20 13.5h1" />;
    case 'cake':
      return (
        <>
          <Path d="M4 20h16M5.5 20v-6h13v6M5.5 14.5c1.4-2 3-2 4.3 0s3 2 4.3 0 3-2 4.4 0M12 8.5v3" />
          {dot(12, 6.6, 1)}
        </>
      );
    case 'food':
      return <Path d="M7 3v7.2a1.8 1.8 0 0 0 1.8 1.8H9v9M7 3v4.2M9 3v4.2M16.8 3c-1.4 0-2.3 2-2.3 5s.9 4 2.3 4v9" />;
    case 'coffee':
      return <Path d="M5 9h12v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9ZM17 10.2h1.8a2 2 0 0 1 0 4H17M8.5 3.2c-.5 1 .5 1.6 0 2.6M11.5 3.2c-.5 1 .5 1.6 0 2.6" />;
    case 'party':
      return (
        <>
          <Path d="M4 20 9 8.4l6.6 6.6L4 20ZM9 8.4l6.6 6.6" />
          <Path d="M14 4l.7 2M18.4 8.2l2-.8M16.4 12.6l2.4-.3M13 3.2l.4 1.8" />
        </>
      );
    case 'art':
      return (
        <>
          <Path d="M12 4a8 8 0 0 0 0 16 1.9 1.9 0 0 0 1.9-1.9c0-.5-.2-.9-.2-1.3a1.9 1.9 0 0 1 1.9-1.9H17a3 3 0 0 0 3-3c0-4.1-3.6-7.9-8-7.9Z" />
          {dot(8, 10.5, 1.05)}
          {dot(8.6, 14.5, 1.05)}
          {dot(12, 8, 1.05)}
        </>
      );
    case 'book':
      return <Path d="M12 6C10 4.6 6.7 4.4 4 5v13c2.7-.6 6-.4 8 1 2-1.4 5.3-1.6 8-1V5c-2.7-.6-6-.4-8 1ZM12 6v14" />;
    case 'tech':
      return <Path d="M6 6h12a1 1 0 0 1 1 1v8H5V7a1 1 0 0 1 1-1ZM3 18h18M10 9.5 8.3 11.5 10 13.5M14 9.5l1.7 2-1.7 2" />;
    case 'nature':
      return <Path d="M5.5 19c-.4-8 5-13.5 13.5-14.5.8 8.5-4.5 14.5-11.5 14.5a5.5 5.5 0 0 1-2 0ZM7.5 17c2.8-4 5.6-6 8.5-7" />;
    case 'animal':
      return (
        <>
          <Path d="M12 13.2c-2.4 0-4 1.9-4 3.4S9.6 19 12 19s4-.9 4-2.4-1.6-3.4-4-3.4Z" />
          {dot(7.4, 10.2, 1.4)}
          {dot(16.6, 10.2, 1.4)}
          {dot(9.8, 7.2, 1.3)}
          {dot(14.2, 7.2, 1.3)}
        </>
      );
    case 'people':
      return (
        <>
          <Circle cx={9} cy={8} r={2.6} />
          <Path d="M4 19c0-3 2.2-5 5-5s5 2 5 5" />
          <Circle cx={16.4} cy={8.6} r={2.2} />
          <Path d="M14.8 14.1c3 .2 5.2 2.2 5.2 4.9" />
        </>
      );
    case 'tag':
    default:
      return (
        <>
          <Path d="M4 12 12 4h6a2 2 0 0 1 2 2v6l-8 8-8-8Z" />
          {dot(16, 8, 1.3)}
        </>
      );
  }
}

export function CategoryIcon({
  name,
  interest,
  size = 24,
  color = '#4f46e5',
  label,
  ...rest
}: CategoryIconProps) {
  const resolved = name ?? categoryIcon(interest);
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
        {shapeFor(resolved, color)}
      </G>
    </Svg>
  );
}
