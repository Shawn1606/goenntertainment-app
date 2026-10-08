/**
 * Saison-Deko: Anhänger passend zur Jahreszeit.
 *
 * Im Oktober Kürbisse, Gespenster, Fledermäuse und Spinnen, im Advent
 * Christbaumkugeln, Zuckerstangen und Lebkuchen, im Winter Schneemänner – welche,
 * entscheidet `seasonFor()` (src/domain/season.ts).
 *
 * Drei Formen:
 *  - **`SeasonGarland`** – eine Girlande, die direkt an der Unterkante der
 *    Kopfzeile hängt (die Perlen sitzen auf der Kante). Die Anhänger hängen
 *    gleichmäßig verteilt an den Tiefpunkten der Schnur über dem Inhalt, der
 *    darunter wegscrollt – kein eigener Streifen, der wie ein abgeschnittenes
 *    Banner wirkte. Bildschirme lassen oben etwas mehr Platz (`useGarlandSpace`),
 *    damit beim Öffnen keine Überschrift verdeckt ist.
 *  - **`DecorCorner`** – ein kleines Grüppchen in der Ecke einer Karte, das wippt.
 *  - **`Ornament`** – ein einzelnes Symbol.
 *
 * Deko liegt immer UNTER dem Finger (`pointerEvents="none"`) und ist für
 * Vorleser unsichtbar: Sie trägt keine Information. Bei „Bewegung reduzieren"
 * hängt sie still; in den Einstellungen lässt sie sich abschalten.
 */
import { useEffect, useId, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useBeat, useStill } from '@/components/ui/motion-pause';
import { seasonByKey, seasonFor, type Season, type SeasonOrnament } from '@/domain/season';
import { useTheme } from '@/hooks/use-theme';
import { useAppSettings } from '@/lib/app-settings';
import { useFeatures } from '@/lib/features-context';

/**
 * Die Saison von heute – oder das Thema, das ein Admin festgelegt hat (für alle
 * oder als Vorschau nur für sich; src/lib/features-context.tsx). Das Datum ist
 * fest für die Lebensdauer der Komponente – um Mitternacht muss nichts umspringen.
 */
export function useSeason(): Season {
  const [byDate] = useState(() => seasonFor(new Date()));
  const { features } = useFeatures();
  return features.season ? seasonByKey(features.season) : byDate;
}

/** Hellere bzw. dunklere Stufe einer Hex-Farbe. */
function shade(hex: string, amount: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Dunkle Figuren bekommen eine helle Kante – sonst verschwinden sie im Dunkelmodus. */
const EDGE = 'rgba(255,255,255,0.85)';
const INK = '#2a0c47';

/** Ein Anhänger als Zeichnung (24er-Box). `color` färbt, wo es Sinn ergibt. */
export function Ornament({ kind, size, color }: { kind: SeasonOrnament; size: number; color: string }) {
  // Im Web teilen sich alle SVGs einer Seite die IDs – je Anhänger eine eigene.
  const id = `orn-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const dark = shade(color, -0.35);
  const light = shade(color, 0.45);

  const body = (() => {
    switch (kind) {
      /* ---------------------------------------------------------- Halloween */
      case 'pumpkin':
        return (
          <>
            <Path d="M12.2 7.4c-.2-1.6.4-3 1.8-3.8" stroke="#4d7c0f" strokeWidth={1.8} strokeLinecap="round" fill="none" />
            <Path d="M13.4 5.2c1.4-.9 3-.6 3.6.2-1 .9-2.4 1-3.6-.2z" fill="#65a30d" />
            <Ellipse cx={7.6} cy={14.6} rx={5} ry={6.2} fill="#c2410c" />
            <Ellipse cx={16.4} cy={14.6} rx={5} ry={6.2} fill="#c2410c" />
            <Ellipse cx={12} cy={14.6} rx={5.4} ry={6.8} fill="#f97316" />
            <Ellipse cx={9.6} cy={11.4} rx={1.6} ry={2.6} fill="#ffffff" opacity={0.28} />
            <Path d="M8.4 13.6l1.6-2.2 1.2 2.4zM15.6 13.6l-1.6-2.2-1.2 2.4z" fill="#7c2d12" />
            <Path d="M8.2 16.2c1 .9 1.6.1 2.2.9.6-.8 1.6.1 1.6.1s1-.9 1.6-.1c.6-.8 1.2 0 2.2-.9-.6 2.4-2.2 3.2-3.8 3.2s-3.2-.8-3.8-3.2z" fill="#7c2d12" />
          </>
        );
      case 'ghost':
        return (
          <>
            <Path
              d="M12 3c-4 0-6.6 3-6.6 7.2V20c.9.9 1.8.9 2.7 0 .9.9 1.8.9 2.6 0 .9.9 1.8.9 2.6 0 .9.9 1.8.9 2.7 0 .9.9 1.8.9 2.6 0v-9.8C18.6 6 16 3 12 3z"
              fill="#ffffff"
              stroke="#3d1263"
              strokeWidth={1.1}
              strokeLinejoin="round"
            />
            <Ellipse cx={9.8} cy={10.4} rx={1.1} ry={1.5} fill="#3d1263" />
            <Ellipse cx={14.2} cy={10.4} rx={1.1} ry={1.5} fill="#3d1263" />
            <Ellipse cx={12} cy={14} rx={1.2} ry={1.5} fill="#3d1263" opacity={0.85} />
            <Ellipse cx={8} cy={12.6} rx={1} ry={0.6} fill="#fda4af" opacity={0.8} />
            <Ellipse cx={16} cy={12.6} rx={1} ry={0.6} fill="#fda4af" opacity={0.8} />
          </>
        );
      case 'bat':
        return (
          <>
            <Path
              d="M12 9.4c-.9 0-1.6.5-1.9 1.3-.7-1-2-1.9-3.7-2.1-1.6-.2-3.2.3-4.5 1.1 1.2.5 2 1.4 2.2 2.6.9-.5 2-.6 2.9-.1-.1 1 .4 2 1.2 2.6.6-1 1.6-1.6 2.7-1.7l1.1 2.4 1.1-2.4c1.1.1 2.1.7 2.7 1.7.8-.6 1.3-1.6 1.2-2.6.9-.5 2-.4 2.9.1.2-1.2 1-2.1 2.2-2.6-1.3-.8-2.9-1.3-4.5-1.1-1.7.2-3 1.1-3.7 2.1-.3-.8-1-1.3-1.9-1.3z"
              fill={INK}
              stroke={EDGE}
              strokeWidth={0.6}
              strokeLinejoin="round"
            />
            <Path d="M10.8 9.8l.3-1.9 1 1.3 1-1.3.3 1.9z" fill={INK} stroke={EDGE} strokeWidth={0.5} strokeLinejoin="round" />
            <Circle cx={11.2} cy={11} r={0.5} fill="#fde047" />
            <Circle cx={12.8} cy={11} r={0.5} fill="#fde047" />
          </>
        );
      case 'spider':
        return (
          <>
            <G stroke={INK} strokeWidth={1.1} strokeLinecap="round" fill="none">
              <Path d="M9.4 12.6L5 10.2 3.6 7.4M9.2 14.2L4.4 14 2.8 12M9.4 15.8L5.2 17.8 4.4 20.4M10.2 17L7.6 20.6 7.6 22.6" />
              <Path d="M14.6 12.6L19 10.2 20.4 7.4M14.8 14.2L19.6 14 21.2 12M14.6 15.8L18.8 17.8 19.6 20.4M13.8 17L16.4 20.6 16.4 22.6" />
            </G>
            <Ellipse cx={12} cy={15} rx={3.6} ry={4.1} fill={INK} stroke={EDGE} strokeWidth={0.6} />
            <Circle cx={12} cy={10.6} r={2.4} fill={INK} stroke={EDGE} strokeWidth={0.6} />
            <Circle cx={11.1} cy={10.4} r={0.7} fill="#ffffff" />
            <Circle cx={12.9} cy={10.4} r={0.7} fill="#ffffff" />
            <Circle cx={11.2} cy={10.6} r={0.3} fill={INK} />
            <Circle cx={13} cy={10.6} r={0.3} fill={INK} />
          </>
        );
      case 'candy':
        return (
          <>
            <Path d="M8 12L3.2 8.6 4.2 12 3.2 15.4zM16 12l4.8-3.4-1 3.4 1 3.4z" fill={dark} />
            <Ellipse cx={12} cy={12} rx={4.8} ry={3.8} fill={color} />
            <Path d="M9.4 9.4l3.6 5.4M11.6 8.6l3 4.4" stroke="#ffffff" strokeWidth={1.1} strokeLinecap="round" opacity={0.75} />
            <Ellipse cx={10.4} cy={10.4} rx={1.2} ry={0.7} fill="#ffffff" opacity={0.5} />
          </>
        );
      case 'witch-hat':
        return (
          <>
            <Ellipse cx={12} cy={19.4} rx={9.6} ry={2.4} fill={INK} stroke={EDGE} strokeWidth={0.6} />
            <Path d="M6.8 19L12.6 4.2c.4-1.2 1.8-1.6 2.6-.6l-.9 1.4L17.2 19z" fill="#3d1263" stroke={EDGE} strokeWidth={0.6} strokeLinejoin="round" />
            <Path d="M7.6 16.4h9l.6 2.6H6.8z" fill="#f97316" />
            <Rect x={10.6} y={16} width={2.8} height={2.8} rx={0.4} fill="none" stroke="#fde047" strokeWidth={0.9} />
          </>
        );
      case 'moon':
        return (
          <>
            <Path d="M15.6 3.2a9 9 0 1 0 5.6 15.6 7.4 7.4 0 1 1-5.6-15.6z" fill="#fde68a" stroke="#ca8a04" strokeWidth={0.7} />
            <Circle cx={9.4} cy={15.2} r={1} fill="#fbbf24" opacity={0.6} />
            <Circle cx={8} cy={10.4} r={0.7} fill="#fbbf24" opacity={0.6} />
            <Path d="M19 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="#fde68a" />
          </>
        );

      /* ------------------------------------------------- Advent, Weihnachten */
      case 'bauble':
        return (
          <>
            <Defs>
              <RadialGradient id={id} cx="0.38" cy="0.36" r="0.7">
                <Stop offset="0" stopColor={light} />
                <Stop offset="0.55" stopColor={color} />
                <Stop offset="1" stopColor={dark} />
              </RadialGradient>
            </Defs>
            <Circle cx={12} cy={2.4} r={1.4} fill="none" stroke="#b08d1a" strokeWidth={0.9} />
            <Rect x={9.6} y={3.4} width={4.8} height={2.8} rx={0.8} fill="#d4af37" />
            <Circle cx={12} cy={14} r={8.4} fill={`url(#${id})`} />
            <Path d="M4.4 13.2c2.4 1.6 4.9 1.6 7.6 0s5.2-1.6 7.6 0" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={1.1} fill="none" />
            <Path d="M5.6 17.4l1.4-1 1.4 1 1.4-1 1.4 1 1.4-1 1.4 1 1.4-1 1.4 1" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={0.8} fill="none" />
            <Ellipse cx={9.2} cy={10.6} rx={2} ry={1.3} transform="rotate(-30 9.2 10.6)" fill="#ffffff" opacity={0.65} />
          </>
        );
      case 'star':
        return (
          <>
            <Path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="#f5c542" stroke="#b45309" strokeWidth={0.8} strokeLinejoin="round" />
            <Path d="M12 5.6l1.4 3" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={1.1} strokeLinecap="round" />
          </>
        );
      case 'candy-cane':
        return (
          <>
            <Path d="M9.4 21.4V9a4.2 4.2 0 0 1 8.4 0v1" stroke="rgba(0,0,0,0.28)" strokeWidth={4.6} strokeLinecap="round" fill="none" />
            <Path d="M9.4 21.4V9a4.2 4.2 0 0 1 8.4 0v1" stroke="#ffffff" strokeWidth={3.4} strokeLinecap="round" fill="none" />
            <Path d="M9.4 21.4V9a4.2 4.2 0 0 1 8.4 0v1" stroke="#e11d48" strokeWidth={3.4} strokeDasharray="2 2.2" fill="none" />
          </>
        );
      case 'gingerbread':
        return (
          <>
            <Path
              d="M12 2.6a3.4 3.4 0 0 0-1.6 6.4H8.6c-1.4 0-3.6.8-4.4 1.8-.7.9.3 2.2 1.4 1.8l2.6-1v3.2l-2.6 4.6c-.6 1.1.8 2.2 1.8 1.4L12 17.4l4.6 3.4c1 .8 2.4-.3 1.8-1.4l-2.6-4.6v-3.2l2.6 1c1.1.4 2.1-.9 1.4-1.8-.8-1-3-1.8-4.4-1.8h-1.8A3.4 3.4 0 0 0 12 2.6z"
              fill="#b45309"
              stroke="#78350f"
              strokeWidth={0.6}
              strokeLinejoin="round"
            />
            <Path d="M5.8 11.4l1 .4M17.2 11.8l1-.4M7.2 19l.8.6M16 19.6l.8-.6" stroke="#ffffff" strokeWidth={0.9} strokeLinecap="round" />
            <Circle cx={10.9} cy={5.6} r={0.55} fill="#ffffff" />
            <Circle cx={13.1} cy={5.6} r={0.55} fill="#ffffff" />
            <Path d="M10.8 7.2c.7.6 1.7.6 2.4 0" stroke="#ffffff" strokeWidth={0.7} strokeLinecap="round" fill="none" />
            <Circle cx={12} cy={11.6} r={0.75} fill="#e11d48" />
            <Circle cx={12} cy={14} r={0.75} fill="#16a34a" />
          </>
        );
      case 'present':
        return (
          <>
            <Rect x={4.2} y={10.2} width={15.6} height={10.8} rx={1.4} fill={color} />
            <Rect x={3.2} y={7.6} width={17.6} height={3.6} rx={1} fill={dark} />
            <Rect x={10.8} y={7.6} width={2.4} height={13.4} fill="#f5c542" />
            <Path d="M12 7.6c-1.2-2.6-4.8-3.6-5.2-1.6-.3 1.6 2.6 1.8 5.2 1.6zM12 7.6c1.2-2.6 4.8-3.6 5.2-1.6.3 1.6-2.6 1.8-5.2 1.6z" fill="#f5c542" stroke="#b45309" strokeWidth={0.5} />
          </>
        );
      case 'bell':
        return (
          <>
            <Path d="M12 3.6c-3.6 0-5.6 2.9-5.6 6.4v3.8L4.4 16.8h15.2l-2-3V10c0-3.5-2-6.4-5.6-6.4z" fill="#f5c542" stroke="#b45309" strokeWidth={0.8} strokeLinejoin="round" />
            <Circle cx={12} cy={18.6} r={1.8} fill="#b45309" />
            <Path d="M9.6 6.4c-.9.8-1.4 2-1.5 3.4" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1} strokeLinecap="round" fill="none" />
            <Path d="M12 3.6c-1.4-1.6-3.6-1.4-3.6-.2 0 .9 2 1 3.6.2zm0 0c1.4-1.6 3.6-1.4 3.6-.2 0 .9-2 1-3.6.2z" fill="#e11d48" />
          </>
        );
      case 'holly':
        return (
          <>
            <Path d="M12 12.4C10.4 8.6 6.8 6.8 2.8 7.6c1 1 .9 1.9 0 2.8 1.4 0 2.1.7 1.7 2 1.5-.4 2.5.1 2.6 1.5 1.5-.7 3.2-1 4.9-1.5z" fill="#16a34a" stroke="#14532d" strokeWidth={0.5} />
            <Path d="M12 12.4c1.6-3.8 5.2-5.6 9.2-4.8-1 1-.9 1.9 0 2.8-1.4 0-2.1.7-1.7 2-1.5-.4-2.5.1-2.6 1.5-1.5-.7-3.2-1-4.9-1.5z" fill="#22c55e" stroke="#14532d" strokeWidth={0.5} />
            <Circle cx={10.8} cy={13.6} r={1.8} fill="#e11d48" />
            <Circle cx={13.4} cy={13.6} r={1.8} fill="#dc2626" />
            <Circle cx={12.1} cy={15.8} r={1.8} fill="#be123c" />
            <Circle cx={10.3} cy={13} r={0.5} fill="#ffffff" opacity={0.8} />
          </>
        );

      /* ------------------------------------------------------------ Silvester */
      case 'firework':
        return (
          <>
            <G stroke={color} strokeWidth={1.7} strokeLinecap="round">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                <Line key={a} x1={12} y1={5} x2={12} y2={2} transform={`rotate(${a} 12 12)`} />
              ))}
            </G>
            <G stroke={light} strokeWidth={1.2} strokeLinecap="round">
              {[22, 112, 202, 292].map((a) => (
                <Line key={a} x1={12} y1={6.6} x2={12} y2={5.2} transform={`rotate(${a} 12 12)`} />
              ))}
            </G>
            <Circle cx={12} cy={12} r={3} fill={color} />
            <Circle cx={12} cy={12} r={1.2} fill="#ffffff" />
          </>
        );
      case 'confetti':
        return (
          <>
            <Rect x={4} y={5} width={4} height={2} rx={0.6} fill="#fe2c55" transform="rotate(-25 6 6)" />
            <Rect x={14} y={4} width={4.4} height={2} rx={0.6} fill="#25f4ee" transform="rotate(30 16 5)" />
            <Rect x={9} y={11} width={4} height={2} rx={0.6} fill="#f5c542" transform="rotate(15 11 12)" />
            <Rect x={15} y={15} width={4} height={2} rx={0.6} fill="#a855f7" transform="rotate(-40 17 16)" />
            <Rect x={4} y={16} width={4} height={2} rx={0.6} fill="#22c55e" transform="rotate(50 6 17)" />
            <Circle cx={12} cy={6} r={1.2} fill="#f5c542" />
            <Circle cx={19} cy={10.6} r={1.1} fill="#fe2c55" />
            <Circle cx={6} cy={11.6} r={1.1} fill="#a855f7" />
            <Circle cx={12} cy={19.4} r={1.2} fill="#25f4ee" />
          </>
        );
      case 'party-hat':
        return (
          <>
            <Path d="M12 3.4L18.6 20H5.4z" fill={color} stroke={dark} strokeWidth={0.6} strokeLinejoin="round" />
            <Path d="M9.6 9.4l5.2 3M7.8 14l8.4 4.4" stroke="#ffffff" strokeWidth={1.3} strokeLinecap="round" opacity={0.85} />
            <Path d="M5 20l1.6-1.4 1.6 1.4 1.6-1.4 1.6 1.4 1.6-1.4 1.6 1.4 1.6-1.4 1.6 1.4" stroke="#25f4ee" strokeWidth={1.2} fill="none" strokeLinejoin="round" />
            <Circle cx={12} cy={3.2} r={2} fill="#fe2c55" />
          </>
        );

      /* --------------------------------------------------------------- Winter */
      case 'snowflake':
        return (
          <>
            <G stroke={color} strokeWidth={1.6} strokeLinecap="round">
              {[0, 60, 120].map((a) => (
                <G key={a} transform={`rotate(${a} 12 12)`}>
                  <Line x1={12} y1={2.5} x2={12} y2={21.5} />
                  <Path d="M9.6 4.6L12 6.8l2.4-2.2M9.6 19.4L12 17.2l2.4 2.2" fill="none" />
                </G>
              ))}
            </G>
            <Circle cx={12} cy={12} r={1.6} fill={color} />
          </>
        );
      case 'snowman':
        return (
          <>
            <Circle cx={12} cy={17} r={5.2} fill="#ffffff" stroke="#94a3b8" strokeWidth={0.8} />
            <Circle cx={12} cy={8.8} r={3.8} fill="#ffffff" stroke="#94a3b8" strokeWidth={0.8} />
            <Rect x={8.6} y={3.4} width={6.8} height={1.2} rx={0.5} fill={INK} />
            <Rect x={9.8} y={0.6} width={4.4} height={3.2} rx={0.6} fill={INK} />
            <Circle cx={10.7} cy={8.2} r={0.55} fill={INK} />
            <Circle cx={13.3} cy={8.2} r={0.55} fill={INK} />
            <Path d="M12 9.2l3 .8-3 .6z" fill="#f97316" />
            <Path d="M8.6 12.2c2.2 1.1 4.6 1.1 6.8 0l.6 1.4-1.8.4.4 2.6-1.6.2-.4-2.6c-1.2.2-2.4.1-3.6-.2z" fill="#e11d48" />
            <Circle cx={12} cy={16.2} r={0.6} fill={INK} />
            <Circle cx={12} cy={18.6} r={0.6} fill={INK} />
          </>
        );
      case 'mitten':
        return (
          <>
            <Path d="M8 20.6V11.4C8 7.4 9.8 4 13.1 4S18 6.6 18 10.2v10.4z" fill={color} stroke={dark} strokeWidth={0.6} />
            <Path d="M8.4 12.4C6.2 11.2 4.4 12.2 4.8 14.2c.4 1.8 2.3 2.7 3.6 2.4" fill={color} stroke={dark} strokeWidth={0.6} />
            <Rect x={7.4} y={17.4} width={11.2} height={3.8} rx={1.2} fill="#ffffff" stroke="#cbd5e1" strokeWidth={0.6} />
            <Path d="M10.6 9.4l1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4" stroke="#ffffff" strokeWidth={1} fill="none" strokeLinejoin="round" />
          </>
        );

      /* ---------------------------------------------------------- Valentinstag */
      case 'heart':
        return (
          <>
            <Path d="M12 20.4s-8-4.8-8-10.6C4 6.8 6.1 5 8.4 5c1.6 0 2.9.9 3.6 2.2C12.7 5.9 14 5 15.6 5 17.9 5 20 6.8 20 9.8c0 5.8-8 10.6-8 10.6z" fill={color} />
            <Ellipse cx={8.4} cy={8.8} rx={1.6} ry={1.1} transform="rotate(-30 8.4 8.8)" fill="#ffffff" opacity={0.5} />
          </>
        );
      case 'letter':
        return (
          <>
            <Rect x={3} y={6.4} width={18} height={12.4} rx={1.6} fill="#ffffff" stroke="#fb7185" strokeWidth={1} />
            <Path d="M3.6 7.4L12 13.4l8.4-6" stroke="#fb7185" strokeWidth={1} fill="none" strokeLinejoin="round" />
            <Path d="M12 15.8s-2.6-1.6-2.6-3.4c0-.9.7-1.5 1.4-1.5.5 0 .9.3 1.2.7.3-.4.7-.7 1.2-.7.7 0 1.4.6 1.4 1.5 0 1.8-2.6 3.4-2.6 3.4z" fill="#fe2c55" />
          </>
        );

      /* ------------------------------------------------------ Ostern, Frühling */
      case 'egg':
        return (
          <>
            <Path d="M12 2.8c3.8 0 6.6 6 6.6 10.6 0 4.4-2.9 7.8-6.6 7.8s-6.6-3.4-6.6-7.8C5.4 8.8 8.2 2.8 12 2.8z" fill={color} />
            <Path d="M5.9 12.4l2-1.6 2 1.6 2.1-1.6 2 1.6 2.1-1.6 2 1.6" stroke="#ffffff" strokeWidth={1.2} fill="none" strokeLinejoin="round" />
            <Circle cx={9.6} cy={16.2} r={0.9} fill="#ffffff" />
            <Circle cx={14.4} cy={16.2} r={0.9} fill="#ffffff" />
            <Circle cx={12} cy={7.6} r={0.9} fill="#ffffff" />
          </>
        );
      case 'bunny':
        return (
          <>
            <Ellipse cx={9} cy={6.4} rx={2} ry={5} fill="#ffffff" stroke="#cbd5e1" strokeWidth={0.7} transform="rotate(-10 9 6.4)" />
            <Ellipse cx={15} cy={6.4} rx={2} ry={5} fill="#ffffff" stroke="#cbd5e1" strokeWidth={0.7} transform="rotate(10 15 6.4)" />
            <Ellipse cx={9} cy={6.6} rx={0.9} ry={3.4} fill="#f9a8d4" transform="rotate(-10 9 6.6)" />
            <Ellipse cx={15} cy={6.6} rx={0.9} ry={3.4} fill="#f9a8d4" transform="rotate(10 15 6.6)" />
            <Circle cx={12} cy={15} r={6} fill="#ffffff" stroke="#cbd5e1" strokeWidth={0.7} />
            <Circle cx={9.8} cy={14} r={0.7} fill={INK} />
            <Circle cx={14.2} cy={14} r={0.7} fill={INK} />
            <Path d="M11.2 15.8h1.6L12 16.8z" fill="#f472b6" />
            <Ellipse cx={8.6} cy={16.4} rx={1} ry={0.6} fill="#f9a8d4" opacity={0.8} />
            <Ellipse cx={15.4} cy={16.4} rx={1} ry={0.6} fill="#f9a8d4" opacity={0.8} />
          </>
        );
      case 'chick':
        return (
          <>
            <Circle cx={12} cy={12} r={6.4} fill="#fde047" stroke="#ca8a04" strokeWidth={0.6} />
            <Path d="M11 5.8c.2-1.4 1-2.2 1.8-2.2-.2.8.2 1.4.8 1.8" stroke="#ca8a04" strokeWidth={0.8} fill="none" strokeLinecap="round" />
            <Circle cx={10.2} cy={10.8} r={0.75} fill={INK} />
            <Circle cx={13.8} cy={10.8} r={0.75} fill={INK} />
            <Path d="M11 12.2h2L12 13.6z" fill="#f97316" />
            <Path d="M5 15.6l2.2-1.6 2.4 1.8 2.4-1.8 2.4 1.8 2.4-1.8L19 15.6c-.4 3.6-3.4 5.8-7 5.8s-6.6-2.2-7-5.8z" fill="#ffffff" stroke="#cbd5e1" strokeWidth={0.6} strokeLinejoin="round" />
          </>
        );
      case 'blossom':
        return (
          <>
            {[0, 72, 144, 216, 288].map((a) => (
              <Ellipse key={a} cx={12} cy={6.6} rx={3.4} ry={4.6} fill={color} stroke={dark} strokeWidth={0.4} transform={`rotate(${a} 12 12)`} />
            ))}
            <Circle cx={12} cy={12} r={2.8} fill="#fbbf24" />
          </>
        );
      case 'tulip':
        return (
          <>
            <Path d="M12 13.4v8.2" stroke="#16a34a" strokeWidth={1.4} strokeLinecap="round" />
            <Path d="M12 19c-1.8-2.6-4.2-3.2-5.6-2.6 1.2 2.4 3.4 3.4 5.6 2.6z" fill="#22c55e" />
            <Path d="M7.2 5.6c1.4 1.4 2.6 1.6 4.8.2 2.2 1.4 3.4 1.2 4.8-.2.6 4.8-1.2 8-4.8 8s-5.4-3.2-4.8-8z" fill={color} stroke={dark} strokeWidth={0.5} />
            <Path d="M12 5.8v6" stroke={dark} strokeWidth={0.6} opacity={0.6} />
          </>
        );
      case 'butterfly':
        return (
          <>
            <Ellipse cx={7.4} cy={9} rx={4.4} ry={4.8} fill={color} stroke={dark} strokeWidth={0.5} transform="rotate(-20 7.4 9)" />
            <Ellipse cx={16.6} cy={9} rx={4.4} ry={4.8} fill={color} stroke={dark} strokeWidth={0.5} transform="rotate(20 16.6 9)" />
            <Ellipse cx={8.4} cy={16} rx={3} ry={3.4} fill={light} stroke={dark} strokeWidth={0.5} />
            <Ellipse cx={15.6} cy={16} rx={3} ry={3.4} fill={light} stroke={dark} strokeWidth={0.5} />
            <Circle cx={7.4} cy={9} r={1.4} fill="#ffffff" opacity={0.7} />
            <Circle cx={16.6} cy={9} r={1.4} fill="#ffffff" opacity={0.7} />
            <Ellipse cx={12} cy={12.6} rx={1.1} ry={6} fill={INK} />
            <Path d="M11.4 6.8c-.6-1.8-1.6-2.8-2.6-3M12.6 6.8c.6-1.8 1.6-2.8 2.6-3" stroke={INK} strokeWidth={0.7} strokeLinecap="round" fill="none" />
          </>
        );
      case 'ladybug':
        return (
          <>
            <Path d="M7.6 9.6a4.4 4.4 0 0 1 8.8 0z" fill={INK} />
            <Circle cx={12} cy={14} r={6.4} fill="#e11d48" stroke="#9f1239" strokeWidth={0.6} />
            <Path d="M12 7.8v12.6" stroke={INK} strokeWidth={0.9} />
            <Circle cx={9} cy={12} r={1.2} fill={INK} />
            <Circle cx={15} cy={12} r={1.2} fill={INK} />
            <Circle cx={9.4} cy={16.4} r={1.1} fill={INK} />
            <Circle cx={14.6} cy={16.4} r={1.1} fill={INK} />
            <Circle cx={10.4} cy={8.4} r={0.6} fill="#ffffff" />
            <Circle cx={13.6} cy={8.4} r={0.6} fill="#ffffff" />
          </>
        );

      /* --------------------------------------------------------------- Sommer */
      case 'sun':
        return (
          <>
            <G stroke="#f59e0b" strokeWidth={1.6} strokeLinecap="round">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                <Line key={a} x1={12} y1={2.6} x2={12} y2={5} transform={`rotate(${a} 12 12)`} />
              ))}
            </G>
            <Circle cx={12} cy={12} r={5.4} fill="#fbbf24" />
            <Circle cx={10.4} cy={11.2} r={0.6} fill="#92400e" />
            <Circle cx={13.6} cy={11.2} r={0.6} fill="#92400e" />
            <Path d="M10.2 13.2c1 1 2.6 1 3.6 0" stroke="#92400e" strokeWidth={0.8} strokeLinecap="round" fill="none" />
          </>
        );
      case 'ice-cream':
        return (
          <>
            <Path d="M7.4 11.6h9.2L12 22z" fill="#f2c27b" stroke="#b45309" strokeWidth={0.6} strokeLinejoin="round" />
            <Path d="M9 13.4l4.6 4.6M11.6 12l3.4 3.4M10.4 16.4l3.6-3.6M9 13.4l3.2-1.4" stroke="#b45309" strokeWidth={0.5} opacity={0.7} />
            <Circle cx={9.6} cy={10} r={3.2} fill="#f9a8d4" />
            <Circle cx={14.4} cy={10} r={3.2} fill="#86efac" />
            <Circle cx={12} cy={7} r={3.2} fill="#fde68a" />
            <Circle cx={12.6} cy={3.4} r={1.4} fill="#e11d48" />
          </>
        );
      case 'watermelon':
        return (
          <>
            <Path d="M2.6 9a9.4 9.4 0 0 0 18.8 0z" fill="#16a34a" />
            <Path d="M3.8 9a8.2 8.2 0 0 0 16.4 0z" fill="#ecfccb" />
            <Path d="M4.8 9a7.2 7.2 0 0 0 14.4 0z" fill="#f43f5e" />
            <Ellipse cx={8.6} cy={11.4} rx={0.5} ry={0.8} fill={INK} />
            <Ellipse cx={12} cy={13} rx={0.5} ry={0.8} fill={INK} />
            <Ellipse cx={15.4} cy={11.4} rx={0.5} ry={0.8} fill={INK} />
            <Ellipse cx={10.4} cy={10} rx={0.45} ry={0.7} fill={INK} />
            <Ellipse cx={13.6} cy={10} rx={0.45} ry={0.7} fill={INK} />
          </>
        );
      case 'beach-ball':
        return (
          <>
            <Circle cx={12} cy={12} r={8.6} fill="#ffffff" stroke="#94a3b8" strokeWidth={0.7} />
            <Path d="M12 3.4a8.6 8.6 0 0 0-8.4 6.8c3.2-1.4 6.2-1.4 8.4 1.8z" fill="#e11d48" />
            <Path d="M20.6 12A8.6 8.6 0 0 0 12 3.4c1.4 3.2.8 6.2 0 8.6z" fill="#fbbf24" />
            <Path d="M12 20.6a8.6 8.6 0 0 0 8.4-6.8c-3.2 1.4-6.2 1.4-8.4-1.8z" fill="#38bdf8" />
            <Path d="M3.4 12a8.6 8.6 0 0 0 8.6 8.6c-1.4-3.2-.8-6.2 0-8.6z" fill="#22c55e" />
            <Circle cx={12} cy={12} r={1.6} fill="#ffffff" stroke="#94a3b8" strokeWidth={0.5} />
            <Ellipse cx={8.4} cy={7.4} rx={1.6} ry={0.9} transform="rotate(-35 8.4 7.4)" fill="#ffffff" opacity={0.6} />
          </>
        );

      /* --------------------------------------------------------------- Herbst */
      case 'leaf':
        return (
          <>
            <Path
              d="M12 2.5l1.6 3.4 3-1.2-.6 3.6 3.6-.4-1.8 3.2 2.6 1.6-3.6 1.4.8 2.6-3.4-.8L12 19l-2.2-3.1-3.4.8.8-2.6-3.6-1.4 2.6-1.6-1.8-3.2 3.6.4-.6-3.6 3 1.2z"
              fill={color}
              stroke={dark}
              strokeWidth={0.5}
              strokeLinejoin="round"
            />
            <Path d="M12 7.4V22M12 12.6l-3-2.4M12 12.6l3-2.4" stroke={dark} strokeWidth={1} strokeLinecap="round" />
          </>
        );
      case 'acorn':
        return (
          <>
            <Path d="M12 3.4v2.2" stroke="#78350f" strokeWidth={1.4} strokeLinecap="round" />
            <Path d="M7.4 11c0 5 2.2 9.6 4.6 10.4 2.4-.8 4.6-5.4 4.6-10.4z" fill="#d97706" stroke="#92400e" strokeWidth={0.6} />
            <Path d="M5.4 11.2c0-3.2 3-5.6 6.6-5.6s6.6 2.4 6.6 5.6z" fill="#92400e" />
            <Path d="M7.4 9.4l2-2M10 10.4l3.4-3.4M13 10.6l3-3M7.6 7.6l2.8 2.8M11 6.6l3.6 3.6" stroke="#78350f" strokeWidth={0.6} opacity={0.8} />
            <Ellipse cx={10} cy={14} rx={0.9} ry={2} fill="#ffffff" opacity={0.35} />
          </>
        );
      case 'mushroom':
        return (
          <>
            <Path d="M9.4 12.4h5.2l.8 7.8c0 .8-1.6 1.4-3.4 1.4s-3.4-.6-3.4-1.4z" fill="#fef3c7" stroke="#d6a77a" strokeWidth={0.6} />
            <Path d="M3 12.6C3 7.4 7 3.6 12 3.6s9 3.8 9 9c0 .6-.6 1-1.2 1H4.2c-.6 0-1.2-.4-1.2-1z" fill="#dc2626" stroke="#991b1b" strokeWidth={0.6} />
            <Circle cx={8} cy={9} r={1.4} fill="#ffffff" />
            <Circle cx={13.2} cy={6.6} r={1.2} fill="#ffffff" />
            <Circle cx={16.4} cy={10.4} r={1.4} fill="#ffffff" />
            <Circle cx={11.4} cy={11} r={0.9} fill="#ffffff" />
          </>
        );
      case 'apple':
        return (
          <>
            <Path d="M12 7.2c-1.6-1.2-6.6-1.6-6.6 4.6 0 4.8 3 9.2 5 9.2.8 0 1-.4 1.6-.4s.8.4 1.6.4c2 0 5-4.4 5-9.2 0-6.2-5-5.8-6.6-4.6z" fill="#dc2626" stroke="#991b1b" strokeWidth={0.6} />
            <Path d="M12 7.4c0-1.8.4-3 1.4-3.8" stroke="#78350f" strokeWidth={1.2} strokeLinecap="round" fill="none" />
            <Path d="M12.8 5.4c1.2-1.4 3.4-1.6 4.4-.8-1 1.4-3 1.8-4.4.8z" fill="#22c55e" />
            <Ellipse cx={8.6} cy={11} rx={1.2} ry={2} transform="rotate(20 8.6 11)" fill="#ffffff" opacity={0.45} />
          </>
        );
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

/** Wie sich ein Anhänger bewegt: schaukeln (Standard), wippen am Faden (Spinne), flattern (Fledermaus, Schmetterling). */
function motionFor(kind: SeasonOrnament): 'swing' | 'bob' | 'flap' {
  if (kind === 'spider') return 'bob';
  if (kind === 'bat' || kind === 'butterfly') return 'flap';
  return 'swing';
}

/** Ruhe nach dem Ausschaukeln eines Anhängers (dazu je Anhänger ein Versatz bis zur selben Länge). */
const SWING_REST_MS = 12_000;

/** Ruhe nach dem Wippen eines Eck-Grüppchens. */
const BOB_REST_MS = 6000;

/** Ein Anhänger an einem Faden. Er hängt an seinem oberen Ende und bewegt sich von dort aus. */
function Hanging({
  kind,
  color,
  size,
  drop,
  delay,
  duration,
  swing,
  thread,
}: {
  kind: SeasonOrnament;
  color: string;
  size: number;
  /** Fadenlänge in px. */
  drop: number;
  delay: number;
  duration: number;
  swing: number;
  thread: string;
}) {
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const t = useSharedValue(0);
  const motion = motionFor(kind);

  // Einmal ausschaukeln (gedämpft), dann lange Ruhe, dann wieder – nie alle im
  // Dauerpendeln: Neun Anhänger, die ununterbrochen schwingen, kosteten auf dem
  // Handy jeden Frame Arbeit. Im Takt (`useBeat`) läuft in der Ruhe gar nichts.
  const rest = SWING_REST_MS + ((delay * 13 + duration * 7) % SWING_REST_MS);
  useBeat(
    () => {
      const ease = Easing.inOut(Easing.sin);
      t.set(
        withSequence(
          withTiming(1, { duration: duration * 0.5, easing: ease }),
          withTiming(-0.6, { duration: duration * 0.5, easing: ease }),
          withTiming(0.3, { duration: duration * 0.45, easing: ease }),
          withTiming(0, { duration: duration * 0.4, easing: ease }),
        ),
      );
    },
    Math.round(duration * 1.85) + rest,
    !reduced,
    delay,
  );
  useEffect(() => {
    if (!reduced) return;
    cancelAnimation(t);
    t.set(0);
  }, [reduced, t]);

  const style = useAnimatedStyle(() => {
    if (motion === 'bob') return { transform: [{ translateY: (t.value + 1) * 4 }] };
    if (motion === 'flap') return { transform: [{ translateY: t.value * 2 }, { rotate: `${t.value * swing * 0.6}deg` }, { scaleX: 1 - Math.abs(t.value) * 0.12 }] };
    return { transform: [{ rotate: `${t.value * swing}deg` }] };
  });

  return (
    <Animated.View style={[{ alignItems: 'center', width: size, transformOrigin: [size / 2, 0, 0] }, style]}>
      <View style={{ width: 1, height: drop, backgroundColor: thread }} />
      <Ornament kind={kind} size={size} color={color} />
    </Animated.View>
  );
}

/** So weit ragen die Anhänger höchstens unter die Kopfzeile. */
export const GARLAND_OVERHANG = 36;

/**
 * Zusätzlicher Abstand oben für Bildschirme unter der Kopfzeile: So verdeckt
 * die Girlande beim Öffnen keine Überschrift. 0, wenn die Deko aus ist.
 */
export function useGarlandSpace(): number {
  const { settings } = useAppSettings();
  return settings.seasonalDecor ? 18 : 0;
}

/** Wie tief die Schnur zwischen zwei Aufhängungen durchhängt. */
const SAG = 5;

/** Fadenlängen im Wechsel – so hängen die Anhänger nicht in einer starren Reihe. */
const DROPS = [1, 6, 3, 8, 2, 5];

/**
 * Die Girlande an der Kopfzeile: eine durchhängende Schnur über die ganze
 * Breite, an jedem Tiefpunkt ein Anhänger, die Perlen sitzen auf der Kante.
 * Liegt absolut unter der Kopfzeile (Eltern brauchen `zIndex`).
 */
export function SeasonGarland({ style }: { style?: StyleProp<ViewStyle> }) {
  const season = useSeason();
  const colors = useTheme();
  const { settings } = useAppSettings();
  const { width } = useWindowDimensions();
  if (!settings.seasonalDecor) return null;

  const count = Math.max(5, Math.min(12, Math.floor(width / 42)));
  const seg = width / count;
  // Schnur: je Abschnitt ein Bogen, der in der Mitte SAG tief hängt.
  let d = 'M0 0.5';
  for (let i = 0; i < count; i++) d += ` Q${(i + 0.5) * seg} ${SAG * 2} ${(i + 1) * seg} 0.5`;

  return (
    <View pointerEvents="none" style={[styles.garland, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={SAG + 4} style={styles.garlandString}>
        <Path d={d} stroke={colors.borderStrong} strokeWidth={1.2} fill="none" />
        {Array.from({ length: count + 1 }, (_, i) => (
          <Circle key={i} cx={Math.min(width - 3, Math.max(3, i * seg))} cy={1} r={2.6} fill={season.beads[i % season.beads.length]} />
        ))}
      </Svg>
      {Array.from({ length: count }, (_, i) => {
        const kind = season.ornaments[i % season.ornaments.length];
        // Fledermaus und Spinne sind in ihrer Box flach bzw. dünn – etwas größer, sonst wirken sie winzig.
        const size = kind === 'bat' || kind === 'spider' ? 24 : i % 3 === 1 ? 17 : 20;
        const drop = kind === 'spider' ? 6 : DROPS[i % DROPS.length];
        return (
          <View key={i} style={[styles.hangSlot, { left: (i + 0.5) * seg - size / 2, top: SAG - 0.5 }]}>
            <Hanging
              kind={kind}
              color={season.colors[i % season.colors.length]}
              size={size}
              drop={drop}
              delay={(i * 263) % 1200}
              duration={1500 + ((i * 397) % 900)}
              swing={6 + (i % 4)}
              thread={colors.borderStrong}
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * Ein kleines Grüppchen Anhänger, das in einer Kartenecke wippt. `corner` sagt,
 * welche; `inline` liegt im Fluss (z. B. in einer Kopfzeile). `offset` wählt,
 * mit welchem Symbol der Saison das Grüppchen beginnt – so sehen zwei Karten
 * auf einer Seite verschieden aus.
 */
export function DecorCorner({
  corner = 'topRight',
  size = 22,
  count = 3,
  offset = 0,
  style,
}: {
  corner?: 'topRight' | 'bottomRight' | 'topLeft' | 'inline';
  size?: number;
  count?: number;
  offset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const season = useSeason();
  // Steht still bei „Bewegung reduzieren" UND solange die Seite nicht vorn ist (motion-pause.tsx).
  const reduced = useStill();
  const bob = useSharedValue(0);
  const { settings } = useAppSettings();

  // Zweimal wippen, dann Ruhe – kein Dauerwippen (kostet sonst jeden Frame). Ohne
  // Saison-Deko gibt es nichts zu wippen.
  const bobbing = !reduced && settings.seasonalDecor;
  useBeat(
    () => {
      const ease = Easing.inOut(Easing.sin);
      bob.set(
        withSequence(
          withTiming(1, { duration: 800, easing: ease }),
          withTiming(0, { duration: 800, easing: ease }),
          withTiming(1, { duration: 800, easing: ease }),
          withTiming(0, { duration: 800, easing: ease }),
        ),
      );
    },
    3200 + BOB_REST_MS,
    bobbing,
    0,
  );
  useEffect(() => {
    if (bobbing) return;
    cancelAnimation(bob);
    bob.set(0);
  }, [bobbing, bob]);

  const even = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value * -2.5 }, { rotate: `${-10 + bob.value * 8}deg` }] }));
  const odd = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - bob.value) * -2 }, { rotate: `${12 - bob.value * 8}deg` }] }));

  if (!settings.seasonalDecor) return null;

  const place =
    corner === 'inline' ? styles.inline : corner === 'topRight' ? styles.cornerTopRight : corner === 'bottomRight' ? styles.cornerBottomRight : styles.cornerTopLeft;
  const items = Array.from({ length: count }, (_, i) => {
    const n = (offset + i) % season.ornaments.length;
    return { kind: season.ornaments[n], color: season.colors[n % season.colors.length] };
  });

  return (
    <View pointerEvents="none" style={[styles.corner, place, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((item, i) => (
        <Animated.View key={i} style={[i % 2 === 0 ? even : odd, i % 2 === 1 ? { marginTop: size * 0.35 } : null]}>
          <Ornament kind={item.kind} size={i % 2 === 1 ? size * 0.82 : size} color={item.color} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  garland: { position: 'absolute', left: 0, right: 0, top: '100%', height: GARLAND_OVERHANG, zIndex: 6 },
  garlandString: { position: 'absolute', left: 0, top: 0 },
  hangSlot: { position: 'absolute' },
  corner: { position: 'absolute', flexDirection: 'row', gap: 2 },
  cornerTopRight: { top: 6, right: 8 },
  cornerBottomRight: { bottom: 6, right: 8 },
  cornerTopLeft: { top: 6, left: 8 },
  inline: { position: 'relative' },
});
