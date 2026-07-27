import Svg, { Circle, Path, type SvgProps } from 'react-native-svg';

/**
 * Kleine Strich-Icons im Marken-Look (react-native-svg, keine Icon-Pakete).
 * `color` und `size` steuern Farbe und Größe; sonst wie ein normales SVG.
 */
type IconProps = SvgProps & {
  size?: number;
  color?: string;
};

function base(size: number) {
  return { width: size, height: size, viewBox: '0 0 24 24' };
}

/** Briefumschlag für das E-Mail-Feld. */
export function MailIcon({ size = 20, color = '#9b6dff', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path d="m4 7 8 6 8-6" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Schloss für das Passwort-Feld. */
export function LockIcon({ size = 20, color = '#9b6dff', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M6 10h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path d="M8 10V7a4 4 0 0 1 8 0v3" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={12} cy={15} r={1.4} fill={color} />
    </Svg>
  );
}

/** Auge – Passwort sichtbar. */
export function EyeIcon({ size = 20, color = '#6b7280', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

/** Durchgestrichenes Auge – Passwort verborgen. */
export function EyeOffIcon({ size = 20, color = '#6b7280', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.8 3.6M6.3 6.9A17 17 0 0 0 2 12s3.5 7 10 7a9.4 9.4 0 0 0 3.8-.8"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path d="m4 4 16 16" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

/** Häkchen für erfüllte Anforderungen. */
export function CheckIcon({ size = 16, color = '#22c55e', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path d="m5 12 4 4 10-10" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Kleiner Kreis für noch offene Anforderungen. */
export function DotIcon({ size = 16, color = '#c4b5fd', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Person für das Namensfeld. */
export function UserIcon({ size = 20, color = '#9b6dff', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Circle cx={12} cy={8} r={3.5} stroke={color} strokeWidth={1.7} />
      <Path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

/** Karten-Pin – öffnet die Ortsauswahl auf der Karte. */
export function MapPinIcon({ size = 20, color = '#9b6dff', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={2.6} stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

/** Papierkorb – Event löschen (Admin). */
export function TrashIcon({ size = 20, color = '#ef4444', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path d="M4 7h16" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path
        d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 7h12l-.8 11.2A2 2 0 0 1 15.2 20H8.8a2 2 0 0 1-2-1.8L6 7Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path d="M10 11v5M14 11v5" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

/** @-Zeichen für das Benutzernamen-Feld. */
export function AtIcon({ size = 20, color = '#9b6dff', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Circle cx={12} cy={12} r={3.2} stroke={color} strokeWidth={1.7} />
      <Path
        d="M15.2 9v4a2.3 2.3 0 0 0 4.3 1.1A8 8 0 1 0 16 19.4"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}
