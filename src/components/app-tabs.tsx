import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs, TabList, TabSlot, TabTrigger, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { initialsOf } from '@/components/story-avatar';
import { Icon } from '@/components/ui/icon';
import { BrandGradient, FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';

/**
 * Untere Leiste im Instagram-/TikTok-Muster:
 *
 *   Home · Karte · ＋ Erstellen · Freunde · (dein Profilbild)
 *
 * ## Warum eine eigene Leiste statt der nativen
 *
 * Rechts außen steht das eigene Profilbild – rund, in Farbe, mit Ring, wenn der
 * Tab aktiv ist. Genau das kann die native Leiste nicht: iOS färbt jedes Bild
 * darin als Schablone einfarbig ein, Android ebenso, und rund zuschneiden kann
 * keine von beiden. Ein Foto würde dort zum grauen Quadrat. Instagram und TikTok
 * zeichnen ihre Leiste aus demselben Grund selbst.
 *
 * Nebeneffekt, der ohnehin richtig ist: iOS, Android und Web sehen jetzt gleich
 * aus – vorher gab es für das Web eine zweite, nachgebaute Leiste.
 *
 * ## Warum genau diese fünf
 *
 * Links das Stöbern, in der Mitte das Erstellen, rechts außen das eigene Profil –
 * die Reihenfolge, die man aus Instagram und TikTok kennt, und genau deshalb
 * braucht sie keine Erklärung. Beschriftungen bleiben stehen: Sie kosten kaum
 * Platz und nehmen jedes Rätselraten, wofür ein Symbol steht.
 *
 * ## Fünf ist die Grenze
 *
 * Mehr Ziele passen auf ein schmales Handy nicht, ohne dass die Treffer zu klein
 * werden. Alles Weitere (Chats, Einstellungen, Admin) liegt als Stack-Route hinter
 * einem Knopf im jeweiligen Kopf.
 *
 * ## `backBehavior: 'history'`
 *
 * Die Zurück-Taste auf Android geht dorthin, wo man herkam – unabhängig davon,
 * welcher Tab zuerst deklariert ist.
 */
type TabDef = {
  name: string;
  href: '/' | '/map' | '/create' | '/friends' | '/me';
  label: string;
  icon: UiIconName;
};

const TABS: TabDef[] = [
  { name: 'index', href: '/', label: 'Home', icon: 'home' },
  { name: 'map', href: '/map', label: 'Karte', icon: 'map' },
  { name: 'create', href: '/create', label: 'Erstellen', icon: 'plus' },
  { name: 'friends', href: '/friends', label: 'Freunde', icon: 'users' },
  { name: 'me', href: '/me', label: 'Profil', icon: 'user' },
];

export default function AppTabs() {
  return (
    <Tabs style={styles.root} options={{ backBehavior: 'history' }}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <BottomBar>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton tab={tab} />
            </TabTrigger>
          ))}
        </BottomBar>
      </TabList>
    </Tabs>
  );
}

function TabButton({ tab, isFocused, onPress, ...props }: TabTriggerSlotProps & { tab: TabDef }) {
  const colors = useTheme();
  const color = isFocused ? colors.text : colors.textSecondary;

  return (
    <Pressable
      {...props}
      onPress={(event) => {
        if (!isFocused) feedback.selected();
        onPress?.(event);
      }}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <View style={styles.iconSlot}>
        {tab.name === 'create' ? (
          <CreateGlyph />
        ) : tab.name === 'me' ? (
          <ProfileGlyph focused={!!isFocused} />
        ) : (
          <Icon name={tab.icon} size={26} color={color} />
        )}
      </View>
      <Text
        style={[
          styles.label,
          { color, fontFamily: isFocused ? FontFamily.bold : FontFamily.medium },
        ]}
        numberOfLines={1}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

/**
 * Das ＋ in der Mitte – als kleine Verlaufs-Kachel.
 *
 * Es ist die eine Handlung, zu der die Leiste einlädt, also trägt sie als einzige
 * Farbe, auch im Ruhezustand. Die Kachel statt eines Kreises ist das TikTok-Zitat:
 * Man erkennt den Knopf sofort als „hier entsteht etwas".
 */
function CreateGlyph() {
  return (
    <LinearGradient
      colors={[...BrandGradient]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.create}>
      <Icon name="plus" size={20} color="#ffffff" />
    </LinearGradient>
  );
}

/**
 * Das eigene Profilbild – oder die Initialen, solange es keins gibt.
 *
 * Aktiv bekommt es einen Ring in Schriftfarbe, mit etwas Luft dazwischen: So
 * liest sich „hier bist du gerade", ohne dass das Foto selbst kleiner wird.
 */
function ProfileGlyph({ focused }: { focused: boolean }) {
  const colors = useTheme();
  const { user } = useAuth();
  const name = user?.name ?? '';

  return (
    <View style={[styles.avatarRing, { borderColor: focused ? colors.text : 'transparent' }]}>
      <View style={[styles.avatar, { backgroundColor: colors.backgroundSelected }]}>
        {user?.avatar ? (
          <Image
            source={{ uri: user.avatar }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessible={false}
          />
        ) : name ? (
          <Text style={[styles.initials, { color: colors.text }]}>{initialsOf(name)}</Text>
        ) : (
          <Icon name="user" size={16} color={colors.textSecondary} />
        )}
      </View>
    </View>
  );
}

function BottomBar(props: TabListProps) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      style={[
        styles.bar,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.backgroundSelected,
          paddingBottom: Math.max(insets.bottom, Spacing.two),
        },
      ]}>
      <View style={styles.inner}>{props.children}</View>
    </View>
  );
}

const AVATAR = 26;
const RING = 2;
const RING_GAP = 1.5;

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { flex: 1 },
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.one + 2,
    alignItems: 'center',
  },
  inner: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: Spacing.one,
  },
  /** Gleiche Höhe für alle Symbole – sonst tanzen die Beschriftungen. */
  iconSlot: { height: 32, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  label: { fontSize: 11 },
  create: {
    width: 42,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: AVATAR + (RING + RING_GAP) * 2,
    height: AVATAR + (RING + RING_GAP) * 2,
    borderRadius: 999,
    borderWidth: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: FontFamily.bold, fontSize: 11 },
});
