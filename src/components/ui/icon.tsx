/**
 * Ein Symbol über seinen Namen holen.
 *
 * Die einzelnen Zeichnungen liegen weiter in `icons.tsx` – dort sind sie
 * einzeln importierbar, was in Formularen und Knöpfen bequemer ist. Diese Datei
 * ist die **Tabelle** dazu: Sie bildet jeden in `src/domain/ui-icon.ts`
 * deklarierten Namen auf genau eine Zeichnung ab.
 *
 * Wozu der Umweg über Namen? Damit Regeln (Abzeichen, Menüs, Zustände) ein
 * Symbol *benennen* können, ohne React oder SVG zu kennen. Eine Regel sagt
 * „trophy", die Anzeige entscheidet, wie ein Pokal aussieht. Neues Symbol =
 * eine Zeichnung in `icons.tsx`, ein Name in der Domäne, eine Zeile hier.
 *
 * Barrierefreiheit folgt derselben Regel wie bei `CategoryIcon`: **mit** `label`
 * ist das Symbol ein Bild mit Beschreibung, **ohne** `label` ist es Dekoration
 * und wird übersprungen. Das ist genau die Trennung, die bei Emojis nicht
 * möglich war – die wurden immer vorgelesen, auch als reine Deko.
 */
import type { SvgProps } from 'react-native-svg';

import {
  AtIcon,
  BalloonIcon,
  BanIcon,
  BellIcon,
  BoltIcon,
  BookmarkFilledIcon,
  BookmarkIcon,
  BuildingIcon,
  CalendarIcon,
  CameraIcon,
  ChartIcon,
  ChatIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  CompassIcon,
  ContrastIcon,
  CopyIcon,
  DocumentIcon,
  EditIcon,
  EyeIcon,
  FlagIcon,
  FlameIcon,
  FolderIcon,
  GearIcon,
  GridIcon,
  HeartFilledIcon,
  HeartIcon,
  HelpIcon,
  HomeIcon,
  HourglassIcon,
  IdCardIcon,
  IncognitoIcon,
  InfoIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  LogoutIcon,
  MailIcon,
  MapIcon,
  MapPinIcon,
  MedalIcon,
  MenuIcon,
  MoonIcon,
  PaperclipIcon,
  PartyIcon,
  PhoneIcon,
  PlusIcon,
  PlusSquareIcon,
  RobotIcon,
  RocketIcon,
  SearchIcon,
  SendIcon,
  ShareIcon,
  ShieldCheckIcon,
  SlidersIcon,
  MoreIcon,
  HistoryIcon,
  ArrowUpIcon,
  ShieldIcon,
  SparklesIcon,
  SpeakerIcon,
  SproutIcon,
  StarFilledIcon,
  StarIcon,
  SunIcon,
  SunriseIcon,
  SunsetIcon,
  TagIcon,
  TentIcon,
  TicketIcon,
  TrashIcon,
  TrendUpIcon,
  TrophyIcon,
  UserCheckIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  VibrateIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { UI_ICON_NAMES, type UiIconName } from '@/domain/ui-icon';

type IconComponent = (props: SvgProps & { size?: number; color?: string }) => React.JSX.Element;

/**
 * Name → Zeichnung. `Record<UiIconName, …>` ist hier die eigentliche Sicherung:
 * Fehlt ein Name, meckert TypeScript beim Übersetzen – nicht erst der Nutzer.
 */
const REGISTRY: Record<UiIconName, IconComponent> = {
  // Serie und Fortschritt
  flame: FlameIcon,
  sprout: SproutIcon,
  hourglass: HourglassIcon,
  medal: MedalIcon,
  trophy: TrophyIcon,
  party: PartyIcon,
  rocket: RocketIcon,
  compass: CompassIcon,
  tent: TentIcon,
  'user-check': UserCheckIcon,
  // Zeit und Ort
  clock: ClockIcon,
  calendar: CalendarIcon,
  'map-pin': MapPinIcon,
  sunrise: SunriseIcon,
  sun: SunIcon,
  sunset: SunsetIcon,
  moon: MoonIcon,
  // Navigation und Konto
  'id-card': IdCardIcon,
  ticket: TicketIcon,
  gear: GearIcon,
  chart: ChartIcon,
  users: UsersIcon,
  user: UserIcon,
  incognito: IncognitoIcon,
  'trend-up': TrendUpIcon,
  // Inhalt und Aktion
  plus: PlusIcon,
  edit: EditIcon,
  trash: TrashIcon,
  camera: CameraIcon,
  paperclip: PaperclipIcon,
  search: SearchIcon,
  close: CloseIcon,
  check: CheckIcon,
  send: SendIcon,
  share: ShareIcon,
  link: LinkIcon,
  mail: MailIcon,
  eye: EyeIcon,
  // Hinweise und Zustände
  bell: BellIcon,
  chat: ChatIcon,
  help: HelpIcon,
  flag: FlagIcon,
  document: DocumentIcon,
  building: BuildingIcon,
  shield: ShieldIcon,
  key: KeyIcon,
  lock: LockIcon,
  info: InfoIcon,
  warning: WarningIcon,
  ban: BanIcon,
  robot: RobotIcon,
  folder: FolderIcon,
  tag: TagIcon,
  // Akzente
  star: StarIcon,
  'star-filled': StarFilledIcon,
  sparkles: SparklesIcon,
  bolt: BoltIcon,
  heart: HeartIcon,
  balloon: BalloonIcon,
  // Einstellungen
  contrast: ContrastIcon,
  vibrate: VibrateIcon,
  speaker: SpeakerIcon,
  // Navigation und Feed
  home: HomeIcon,
  map: MapIcon,
  'plus-square': PlusSquareIcon,
  bookmark: BookmarkIcon,
  'bookmark-filled': BookmarkFilledIcon,
  grid: GridIcon,
  menu: MenuIcon,
  'heart-filled': HeartFilledIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-left': ChevronLeftIcon,
  'user-plus': UserPlusIcon,
  logout: LogoutIcon,
  phone: PhoneIcon,
  copy: CopyIcon,
  'shield-check': ShieldCheckIcon,
  sliders: SlidersIcon,
  more: MoreIcon,
  history: HistoryIcon,
  'arrow-up': ArrowUpIcon,
};

/**
 * Zur Laufzeit prüfbar, damit ein Test die Tabelle gegen die Namensliste halten
 * kann, ohne React zu rendern.
 */
export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

/** Alle Namen, für die es hier eine Zeichnung gibt. */
export function registeredIconNames(): string[] {
  return Object.keys(REGISTRY);
}

export type IconProps = SvgProps & {
  name: UiIconName;
  size?: number;
  color?: string;
  /**
   * Was vorgelesen wird. Weglassen, wenn direkt daneben schon Text steht, der
   * dasselbe sagt – ein Symbol, das den Text nur wiederholt, ist Lärm.
   */
  label?: string;
};

export function Icon({ name, size = 20, color = '#6366f1', label, ...rest }: IconProps) {
  // Unbekannter Name kann durch TypeScript nicht passieren, wohl aber durch
  // Daten von außen. Dann lieber ein neutrales Etikett als ein Absturz.
  const Drawing = REGISTRY[name] ?? TagIcon;
  return (
    <Drawing
      size={size}
      color={color}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      {...rest}
    />
  );
}

/** Ein „@" ist kein Symbol im Namensraum, wird aber gelegentlich gebraucht. */
export { AtIcon };

/** Für Tests: die Namensliste, gegen die die Tabelle geprüft wird. */
export { UI_ICON_NAMES };
