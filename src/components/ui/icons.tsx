import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect, type SvgProps } from 'react-native-svg';

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
export function MailIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
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
export function LockIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
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
export function DotIcon({ size = 16, color = '#a5b4fc', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Person für das Namensfeld. */
export function UserIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Circle cx={12} cy={8} r={3.5} stroke={color} strokeWidth={1.7} />
      <Path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

/** Karten-Pin – öffnet die Ortsauswahl auf der Karte. */
export function MapPinIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
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
export function AtIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
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

/** Pfeil nach rechts – Hinweis, dass eine Reihe weiterscrollbar ist. */
export function ChevronRightIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path d="m9 6 6 6-6 6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Gegenstück nach links – erscheint, sobald eine Reihe angeschoben ist. */
export function ChevronLeftIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Ab hier: das erweiterte Chrome-Icon-Set, das die früheren Deko-Emojis in
 * Menüs, Einstellungszeilen, Kacheln und Status ablöst. Gemeinsame Stroke-Werte
 * liegen in einer `<G>`-Hülle, damit jede Zeichnung knapp bleibt; gefüllte
 * Punkte setzen `fill`/`stroke` selbst und überschreiben die Gruppe.
 */
function Stroke({ color, children }: { color: string; children: ReactNode }) {
  return (
    <G stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {children}
    </G>
  );
}

/** Uhr – Zeit, Verlauf, „wann". */
export function ClockIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={12} r={8.4} />
        <Path d="M12 7.2v5l3.4 2" />
      </Stroke>
    </Svg>
  );
}

/** Kalender – Termin/Datum. */
export function CalendarIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={4} y={5.5} width={16} height={14.5} rx={2} />
        <Path d="M4 9.5h16M8.5 3v4M15.5 3v4" />
      </Stroke>
    </Svg>
  );
}

/** Glocke – Benachrichtigungen. */
export function BellIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 2 5.5 2 5.5H4s2-1 2-5.5ZM10 18.5a2 2 0 0 0 4 0" />
      </Stroke>
    </Svg>
  );
}

/** Sprechblase – Feedback/Kontakt. */
export function ChatIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </Stroke>
    </Svg>
  );
}

/** Kompass – „in deiner Nähe". */
export function CompassIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={12} r={8.4} />
        <Path d="M15.6 8.4 13 13l-4.6 2.6L11 11z" />
      </Stroke>
    </Svg>
  );
}

/** Stern – Empfehlung/„für dich". */
export function StarIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 4l2.3 4.9 5.2.6-3.8 3.6 1 5.2L12 16.3 7.3 18.9l1-5.2L4.5 9.5l5.2-.6z" />
      </Stroke>
    </Svg>
  );
}

/** Blitz – schnelle Aktion. */
export function BoltIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M13 3 5 13.5h5l-1 7.5 8-11.5h-5z" />
      </Stroke>
    </Svg>
  );
}

/** Funkeln – Upgrade/Neu. */
export function SparklesIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M11 4l1.6 4.4L17 10l-4.4 1.6L11 16l-1.6-4.4L5 10l4.4-1.6zM18 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
      </Stroke>
    </Svg>
  );
}

/** Ausweis – Profil. */
export function IdCardIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={3} y={6} width={18} height={12} rx={2} />
        <Circle cx={8.5} cy={12} r={2.2} />
        <Path d="M13 10.5h5M13 13.5h4M6 15.4c.4-1.1 1.4-1.7 2.5-1.7s2.1.6 2.5 1.7" />
      </Stroke>
    </Svg>
  );
}

/** Medaille – Fortschritt/Abzeichen. */
export function MedalIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={14} r={5.2} />
        <Path d="M8.6 9.4 6.5 3.5M15.4 9.4l2.1-5.9M12 11.6l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" />
      </Stroke>
    </Svg>
  );
}

/** Ticket – meine Aktivitäten. */
export function TicketIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 9V7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4Z" />
        <Path d="M14 6.5v11" strokeDasharray="1.5 2" />
      </Stroke>
    </Svg>
  );
}

/** Zahnrad – Einstellungen. */
export function GearIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={12} r={3.2} />
        <Path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.85 1.85M16.55 16.55 18.4 18.4M18.4 5.6l-1.85 1.85M7.45 16.55 5.6 18.4" />
      </Stroke>
    </Svg>
  );
}

/** Balkendiagramm – Dashboard/Kennzahlen. */
export function ChartIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 20V4M4 20h16M8.5 20v-6M12.5 20v-9M16.5 20v-4" />
      </Stroke>
    </Svg>
  );
}

/** Steigende Linie – Reichweite/Wachstum. */
export function TrendUpIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 16.5l4.5-4.5 3 3 6.5-7M14 7.5h5v5" />
      </Stroke>
    </Svg>
  );
}

/** Roboter – KI-Verifizierung. */
export function RobotIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={5} y={8} width={14} height={10} rx={2.5} />
        <Path d="M12 4.5V8M4 12.5v3M20 12.5v3M9.5 16h5" />
        <Circle cx={9.2} cy={12.2} r={1} fill={color} stroke="none" />
        <Circle cx={14.8} cy={12.2} r={1} fill={color} stroke="none" />
      </Stroke>
    </Svg>
  );
}

/** Ordner – Beweise/Belege. */
export function FolderIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      </Stroke>
    </Svg>
  );
}

/** Schild – Sicherheit/Datenschutz. */
export function ShieldIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 3 5 6v5c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V6z" />
        <Path d="M9 11.6l2 2 4-4" />
      </Stroke>
    </Svg>
  );
}

/** Schlüssel – Passwort/Zugang. */
export function KeyIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={8} cy={12} r={3.5} />
        <Path d="M11.5 12H20M17 12v3M20 12v2.5" />
      </Stroke>
    </Svg>
  );
}

/** Fragezeichen im Kreis – Hilfe. */
export function HelpIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={12} r={8.4} />
        <Path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.9.4-1.2 1-1.2 1.8" />
        <Circle cx={12} cy={16.4} r={0.9} fill={color} stroke="none" />
      </Stroke>
    </Svg>
  );
}

/** Fahne – melden/markieren. */
export function FlagIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M6 21V4M6 4h11l-2 3.5 2 3.5H6" />
      </Stroke>
    </Svg>
  );
}

/** Dokument – Nutzungsbedingungen. */
export function DocumentIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M7 3h7l4 4v14H7zM14 3v4h4M9 12.5h6M9 16h5" />
      </Stroke>
    </Svg>
  );
}

/** Säulen-Gebäude – Impressum. */
export function BuildingIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 9 12 4l8 5M5 9v9M19 9v9M4 21h16M9.5 21v-6M14.5 21v-6" />
      </Stroke>
    </Svg>
  );
}

/** Etikett – Kontotyp. */
export function TagIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 12 12 4h6a2 2 0 0 1 2 2v6l-8 8-8-8Z" />
        <Circle cx={16} cy={8} r={1.3} fill={color} stroke="none" />
      </Stroke>
    </Svg>
  );
}

/** Sonne – Tag/Hell. */
export function SunIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={12} r={4} />
        <Path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
      </Stroke>
    </Svg>
  );
}

/** Mond – Nacht/Dunkel. */
export function MoonIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z" />
      </Stroke>
    </Svg>
  );
}

/** Halb gefüllter Kreis – Design „wie das System". */
export function ContrastIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Circle cx={12} cy={12} r={8.4} stroke={color} strokeWidth={1.7} fill="none" />
      <Path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill={color} />
    </Svg>
  );
}

/** Telefon mit Wellen – Vibration. */
export function VibrateIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={9} y={5} width={6} height={14} rx={1.5} />
        <Path d="M5.5 8.5v7M3 10.5v3M18.5 8.5v7M21 10.5v3" />
      </Stroke>
    </Svg>
  );
}

/** Lautsprecher – Töne. */
export function SpeakerIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 9.5h3l4-3v11l-4-3H4zM15 9.7a3 3 0 0 1 0 4.6M17.4 7.5a6 6 0 0 1 0 9" />
      </Stroke>
    </Svg>
  );
}

/** Herz – Zuneigung (sparsam). */
export function HeartIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z" />
      </Stroke>
    </Svg>
  );
}

/**
 * Gefülltes Herz – „gefällt mir" ist gesetzt.
 *
 * Eigene Zeichnung und nicht bloß `fill` am Umriss: Der Umriss hat eine Kerbe
 * oben, die bei gefüllter Fläche als heller Spalt stehen bleibt. Gleiches Muster
 * wie bei `StarFilledIcon` – Kontur und Füllung in derselben Farbe, damit die
 * Form geschlossen wirkt.
 */
export function HeartFilledIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z"
        fill={color}
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Büroklammer – Anhang. */
export function PaperclipIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M8.5 12.5l6-6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7-7l7.5-7.5" />
      </Stroke>
    </Svg>
  );
}

/** Sanduhr – Timeout/läuft ab. */
export function HourglassIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M6 4h12M6 20h12M7 4c0 5 5 5 5 8s-5 3-5 8M17 4c0 5-5 5-5 8s5 3 5 8" />
      </Stroke>
    </Svg>
  );
}

/** Verbotskreis – gesperrt/abgelehnt. */
export function BanIcon({ size = 20, color = '#ef4444', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={12} r={8.4} />
        <Path d="M6.1 6.1 17.9 17.9" />
      </Stroke>
    </Svg>
  );
}

/** Warndreieck – Achtung. */
export function WarningIcon({ size = 20, color = '#f59e0b', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 4 21 19H3zM12 10v4" />
        <Circle cx={12} cy={16.6} r={0.9} fill={color} stroke="none" />
      </Stroke>
    </Svg>
  );
}

/** Pluszeichen – erstellen. */
export function PlusIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 5v14M5 12h14" />
      </Stroke>
    </Svg>
  );
}

/** Pfeil nach oben – „nach oben wischen". */
export function ArrowUpIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 20V5M6 11l6-6 6 6" />
      </Stroke>
    </Svg>
  );
}

/** Zwei Personen – Nutzerverwaltung. */
export function UsersIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={9} cy={9} r={3} />
        <Path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5M16 6.2a3 3 0 0 1 0 5.6M17 14.2c2.4.4 4 2 4 4.8" />
      </Stroke>
    </Svg>
  );
}

/** Stift – bearbeiten/umbenennen. */
export function EditIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 20h4L18.6 9.4a2 2 0 0 0-2.8-2.8L5 17.2V20zM14.4 7.8l2.8 2.8" />
      </Stroke>
    </Svg>
  );
}

/** „i" im Kreis – Information/Version. */
export function InfoIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={12} cy={12} r={8.4} />
        <Path d="M12 11v5" />
        <Circle cx={12} cy={7.9} r={0.9} fill={color} stroke="none" />
      </Stroke>
    </Svg>
  );
}

/**
 * Ab hier: der Rest, der die letzten Emojis ablöst – Zustände der Serie,
 * Kacheln, Rangzeichen, Leerzustände. Gleiches Muster wie oben: `<Stroke>`
 * trägt die gemeinsamen Werte, die Zeichnung bleibt eine Zeile.
 */

/** Flamme – laufende Serie. */
export function FlameIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 3s5 4.4 5 8.6a5 5 0 0 1-10 0C7 8.6 9.5 6.2 12 3Z" />
        <Path d="M12 13.4c1.3 1 1.9 1.9 1.9 2.9a1.9 1.9 0 0 1-3.8 0c0-1 .6-1.9 1.9-2.9Z" />
      </Stroke>
    </Svg>
  );
}

/** Keimling – eine Serie, die neu anfängt. */
export function SproutIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 21v-6.6" />
        <Path d="M12 14.4C12 11.3 9.8 8.9 6.5 8.9c0 3.1 2.2 5.5 5.5 5.5Z" />
        <Path d="M12 14.4C12 11.9 13.8 9.9 16.5 9.9c0 2.5-1.8 4.5-4.5 4.5Z" />
      </Stroke>
    </Svg>
  );
}

/** Festzelt – selbst veranstaltet. */
export function TentIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 2.6v2.2" />
        <Path d="M12 4.8 3.6 12.4h16.8z" />
        <Path d="M5.2 12.4V20h13.6v-7.6" />
        <Path d="M9.4 20c0-2.5 1.2-4.6 2.6-4.6s2.6 2.1 2.6 4.6" />
      </Stroke>
    </Svg>
  );
}

/** Person mit Häkchen – „ich bin dabei". */
export function UserCheckIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={10} cy={8} r={3.4} />
        <Path d="M3.5 19.6c0-3.2 2.9-5.1 6.5-5.1.9 0 1.8.1 2.6.4" />
        <Path d="M14.4 17.9l2 2 4.1-4.4" />
      </Stroke>
    </Svg>
  );
}

/** Pokal – höchstes Abzeichen. */
export function TrophyIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M7.5 4h9v4.8a4.5 4.5 0 0 1-9 0z" />
        <Path d="M7.5 5.6H5a2.6 2.6 0 0 0 2.5 3.4M16.5 5.6H19a2.6 2.6 0 0 1-2.5 3.4" />
        <Path d="M12 13.3V17M9.5 17h5l.7 3.2H8.8z" />
      </Stroke>
    </Svg>
  );
}

/** Rakete – Abzeichen fürs Veranstalten. */
export function RocketIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 2.8c2.7 2.4 4.2 5.4 4.2 8.9L14 14.6h-4L7.8 11.7c0-3.5 1.5-6.5 4.2-8.9Z" />
        <Circle cx={12} cy={9.6} r={1.6} />
        <Path d="M10 14.6 8.4 19l3.6-2 3.6 2-1.6-4.4" />
        <Path d="M7.8 11.4 5.2 13v3.2M16.2 11.4l2.6 1.6v3.2" />
      </Stroke>
    </Svg>
  );
}

/** Knallbonbon – „geschafft". */
export function PartyIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M3.5 20.5 9 8l7 7-12.5 5.5Z" />
        <Path d="M13.5 4v2.2M17.8 2.9l-1.1 1.9M21.1 7.2l-1.9 1.1M19.6 12.2l-2-.6" />
      </Stroke>
    </Svg>
  );
}

/** Luftballon – Platzhalter, wo ein Bild fehlt. */
export function BalloonIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 3.4a5.2 5.2 0 0 1 5.2 5.2c0 3.1-2.3 5.6-5.2 5.6S6.8 11.7 6.8 8.6A5.2 5.2 0 0 1 12 3.4Z" />
        <Path d="M11 14l1 1.9 1-1.9" />
        <Path d="M12 15.9v1.5c0 1.5-1.7 1.5-1.7 3" />
      </Stroke>
    </Svg>
  );
}

/** Sonne über dem Horizont, Pfeil nach oben – Morgen. */
export function SunriseIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M3 18.5h18M7 18.5a5 5 0 0 1 10 0" />
        <Path d="M5 9.6l1.7 1.7M19 9.6l-1.7 1.7" />
        <Path d="M12 3.2v4.2M9.6 5.6 12 3.2l2.4 2.4" />
      </Stroke>
    </Svg>
  );
}

/** Sonne über dem Horizont, Pfeil nach unten – Abend. */
export function SunsetIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M3 18.5h18M7 18.5a5 5 0 0 1 10 0" />
        <Path d="M5 9.6l1.7 1.7M19 9.6l-1.7 1.7" />
        <Path d="M12 7.4V3.2M9.6 5 12 7.4 14.4 5" />
      </Stroke>
    </Svg>
  );
}

/** Lupe – Suchfeld. */
export function SearchIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={10.5} cy={10.5} r={6} />
        <Path d="M15 15l5 5" />
      </Stroke>
    </Svg>
  );
}

/** Kreuz – schließen und Eingaben leeren. */
export function CloseIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
      </Stroke>
    </Svg>
  );
}

/** Fotoapparat – Bild wählen. */
export function CameraIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M3.5 9h3l1.4-2.3h8.2L17.5 9h3a.8.8 0 0 1 .8.8v7.6a.8.8 0 0 1-.8.8H3.5a.8.8 0 0 1-.8-.8V9.8A.8.8 0 0 1 3.5 9Z" />
        <Circle cx={12} cy={13.6} r={3.3} />
      </Stroke>
    </Svg>
  );
}

/** Hut und Brille – Profil ist privat. */
export function IncognitoIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M3.5 12h17M7.6 12c.6-3.5 1.5-5.2 4.4-5.2s3.8 1.7 4.4 5.2" />
        <Circle cx={8.3} cy={15.9} r={2.6} />
        <Circle cx={15.7} cy={15.9} r={2.6} />
        <Path d="M10.9 15.5c.7-.5 1.5-.5 2.2 0" />
      </Stroke>
    </Svg>
  );
}

/** Kettenglieder – ein Link ohne eigene Marke. */
export function LinkIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M10.6 13.4a3.6 3.6 0 0 0 5.1 0l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
        <Path d="M13.4 10.6a3.6 3.6 0 0 0-5.1 0L5.9 13a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
      </Stroke>
    </Svg>
  );
}

/** Papierflieger – „ist raus". */
export function SendIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M21 4 3.5 11.2l6.3 2.5L12.3 20 21 4Z" />
        <Path d="M9.8 13.7 21 4" />
      </Stroke>
    </Svg>
  );
}

/**
 * Teilen – drei verbundene Punkte.
 *
 * Bewusst nicht das eckige „Kästchen mit Pfeil nach oben" von iOS: Das ist dort
 * ein System-Zeichen mit fester Bedeutung, und auf Android versteht es niemand.
 * Die drei Punkte lesen alle als „weitergeben".
 */
export function ShareIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={17.5} cy={5.5} r={2.6} />
        <Circle cx={6.5} cy={12} r={2.6} />
        <Circle cx={17.5} cy={18.5} r={2.6} />
        <Path d="m8.9 10.7 6.2-3.9" />
        <Path d="m8.9 13.3 6.2 3.9" />
      </Stroke>
    </Svg>
  );
}

/** Gefüllter Stern – hervorgehoben. */
export function StarFilledIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M12 4l2.3 4.9 5.2.6-3.8 3.6 1 5.2L12 16.3 7.3 18.9l1-5.2L4.5 9.5l5.2-.6z"
        fill={color}
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------------
 * Navigation und Feed im Instagram-/TikTok-Stil
 * --------------------------------------------------------------------- */

/** Haus – Home/Feed. */
export function HomeIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" />
      </Stroke>
    </Svg>
  );
}

/** Gefaltete Karte – die Kartenansicht. */
export function MapIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M9 5 3.5 7v12L9 17l6 2 5.5-2V5L15 7 9 5Z" />
        <Path d="M9 5v12M15 7v12" />
      </Stroke>
    </Svg>
  );
}

/** Kästchen mit Plus – „Erstellen" (das ＋ von Instagram). */
export function PlusSquareIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={3.5} y={3.5} width={17} height={17} rx={5} />
        <Path d="M12 8v8M8 12h8" />
      </Stroke>
    </Svg>
  );
}

/** Lesezeichen – „merken". */
export function BookmarkIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M6.5 4h11a.5.5 0 0 1 .5.5V20l-6-4.2L6 20V4.5a.5.5 0 0 1 .5-.5Z" />
      </Stroke>
    </Svg>
  );
}

/** Gefülltes Lesezeichen – gemerkt. */
export function BookmarkFilledIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Path
        d="M6.5 4h11a.5.5 0 0 1 .5.5V20l-6-4.2L6 20V4.5a.5.5 0 0 1 .5-.5Z"
        fill={color}
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Raster – Profil-Kacheln („Erstellt"). */
export function GridIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={4} y={4} width={16} height={16} rx={2} />
        <Path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16" />
      </Stroke>
    </Svg>
  );
}

/** Drei Striche – Menü (Einstellungen auf dem Profil, wie bei Instagram). */
export function MenuIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M4 7h16M4 12h16M4 17h16" />
      </Stroke>
    </Svg>
  );
}

/** Person mit Plus – Freund:in hinzufügen. */
export function UserPlusIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Circle cx={9.5} cy={8} r={3.5} />
        <Path d="M3.5 19.5c.6-3.3 3-5.3 6-5.3s5.4 2 6 5.3" />
        <Path d="M18.5 8v6M15.5 11h6" />
      </Stroke>
    </Svg>
  );
}

/** Tür mit Pfeil – abmelden. */
export function LogoutIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
        <Path d="M14 8l4 4-4 4M18 12H9.5" />
      </Stroke>
    </Svg>
  );
}

/** Handy – Authenticator-App. */
export function PhoneIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={6.5} y={3} width={11} height={18} rx={2.5} />
        <Path d="M10.5 17.5h3" />
      </Stroke>
    </Svg>
  );
}

/** Zwei Blätter – kopieren. */
export function CopyIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Rect x={8.5} y={8.5} width={11} height={11} rx={2} />
        <Path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
      </Stroke>
    </Svg>
  );
}

/** Schild mit Haken – Zwei-Faktor-Schutz aktiv. */
export function ShieldCheckIcon({ size = 20, color = '#6366f1', ...rest }: IconProps) {
  return (
    <Svg {...base(size)} fill="none" {...rest}>
      <Stroke color={color}>
        <Path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6l-7-2.5Z" />
        <Path d="m9 12 2.2 2.2L15.5 10" />
      </Stroke>
    </Svg>
  );
}
