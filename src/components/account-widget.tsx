import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState, type RefObject } from 'react';
import {
  Animated,
  BackHandler,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { useSheetDrag } from '@/components/ui/use-sheet-drag';
import { Features } from '@/constants/features';
import { BottomTabInset, BrandGradient, FontFamily, Radius, Spacing } from '@/constants/theme';
import { accountAbilities, accountLabel } from '@/domain/account';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import { useResolvedScheme } from '@/lib/theme-preference';

/** Rundung der Blattkante – an einer Stelle, weil Blatt und Weichzeichner sie teilen. */
const SHEET_RADIUS = 28;

/**
 * Android braucht die ausdrückliche Erlaubnis zum Weichzeichnen; auf iOS und im
 * Web zeichnet `BlurView` von sich aus weich.
 */
const BLUR_METHOD = Platform.OS === 'android' ? ('dimezisBlurView' as const) : undefined;

/**
 * Die zwei Stellschrauben für den Look. Das Blatt bekommt den kräftigen Wert –
 * sein Hintergrund soll richtig verschwimmen. Der freie Teil darüber bleibt
 * bewusst knapp weichgezeichnet: gerade genug, dass die Startseite zurücktritt,
 * aber deutlich weniger als unter dem Blatt. Die Werte addieren sich, weil das
 * Blatt auf dem schon weichgezeichneten Hintergrund liegt.
 *
 * ACHTUNG, die Falle an dieser Zahl: `intensity` steuert bei `expo-blur` NICHT
 * nur den Weichzeichner, sondern auch die Deckkraft der Tönung, die das Paket
 * selbst aufträgt – bei `light`/`dark` sind das `intensity/100 × 0.78`. Mit 85
 * stand hier also allein aus der Tönung eine 66 % deckende Fläche, und genau
 * das sah aus wie eine schlichte Farbe statt wie Glas. Hoch drehen macht das
 * Blatt also nicht glasiger, sondern zunehmend blickdicht.
 */
const BACKDROP_BLUR = 18;
const SHEET_BLUR = 55;

/** Aus dieser Höhe steigt das Blatt beim Öffnen auf. */
const SHEET_RISE = 28;

/**
 * Wischen ist eine Geste mit Finger – die gibt es so nur am Gerät. Im Web setzen
 * wir darum den Endwert direkt, statt ihn anzufahren: `Animated`-Läufe rühren
 * sich im Web-Build dieser App nicht (auch die Scheine im Anmelde-Hintergrund
 * stehen dort still), `setValue` greift dagegen sofort.
 */
const NATIVE = Platform.OS !== 'web';

/** Erste Buchstaben des Namens – Rückfallbild, wenn kein Avatar gesetzt ist. */
function initialsOf(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

type Entry = {
  icon: UiIconName;
  title: string;
  hint?: string;
  onPress: () => void;
};

/**
 * Rundes Profilbild für die Kopfzeile der Startseite. Öffnet das Konto-Blatt,
 * das der Bildschirm daneben als `AccountSheet` hält.
 */
export function AccountWidget({ onPress }: { onPress: () => void }) {
  const surface = useBrandSurface();
  const { user } = useAuth();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Konto öffnen"
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}>
      <LinearGradient
        colors={[...BrandGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.avatarRing}>
        {/* Deckend, damit die Initialen scharf stehen – aber im selben Blau. */}
        <View style={[styles.avatarInner, { backgroundColor: surface.chipBgSolid }]}>
          {user?.avatar ? (
            <Image source={{ uri: user.avatar }} style={styles.avatarImage} resizeMode="cover" />
          ) : (
            <ThemedText style={[styles.initials, { color: surface.accent }]}>{initialsOf(user?.name)}</ThemedText>
          )}
        </View>
      </LinearGradient>

      {/* Kleiner Punkt statt Text: zeigt Admins, dass hier mehr wartet. */}
      {user?.is_admin ? <View style={[styles.adminDot, { borderColor: surface.card }]} /> : null}
    </Pressable>
  );
}

/**
 * Das Konto-Blatt: Profil, Konto-Einträge und – für Admins – der Admin-Bereich.
 *
 * Hier liegt auch der Admin-Zugang. Früher hingen „Admin" und „Beweise" als
 * eigene Tabs unten – bei sechs Einträgen faltet Android die letzten in einen
 * „More"-Tab, den normale Nutzer nie brauchen. Der Zugang gehört dorthin, wo
 * die Rolle sitzt: ans Konto.
 *
 * BEWUSST KEIN `Modal`. Ein `Modal` ist auf Android ein eigenes Fenster, und
 * `BlurView` zeichnet nur weich, was in SEINEM Fenster liegt – im Modal fand es
 * darum nichts vor und übrig blieb bloß seine Tönung als Farbfläche. Als Kind
 * des Bildschirms liegt es im selben Fenster wie die Startseite und kann sie
 * tatsächlich weichzeichnen. Der Preis: Zurück-Taste und Auf-/Zublenden müssen
 * wir selbst erledigen, siehe unten.
 *
 * Gehört als LETZTES Kind in den Bildschirm, damit es über allem liegt.
 */
export function AccountSheet({
  open,
  onClose,
  blurTarget,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Was hinter dem Blatt weichgezeichnet wird. Android braucht das seit Expo
   * SDK 55 ausdrücklich (`BlurTargetView`, siehe `HomeBackground`); iOS und
   * Web zeichnen auch ohne weich.
   */
  blurTarget?: RefObject<View | null>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const glass = useGlass();
  const { user, logout } = useAuth();
  const isDark = useResolvedScheme() === 'dark';

  /**
   * Bleibt noch kurz stehen, wenn `open` schon false ist – sonst verschwände das
   * Blatt hart, statt auszublenden. Ansonsten hängt es NICHT dauerhaft im Baum:
   * ein ständig laufender `BlurView` kostet auf Android jedes Bild Rechenzeit.
   */
  const [mounted, setMounted] = useState(false);

  /**
   * 0 = ganz weg, 1 = ganz da. Trägt Auf- und Zublenden.
   * On the web the sheet never fades (see NATIVE), so it starts at 1 there: the
   * first frame after mounting is then fully visible, as before.
   */
  const [appear] = useState(() => new Animated.Value(NATIVE ? 0 : 1));

  /**
   * Nach unten wischen. Steckt seit dem Detail-Blatt in einem eigenen Baustein –
   * beide Blätter sollen sich gleich anfassen, und das geht nur mit einer
   * Fassung der Geste (siehe `use-sheet-drag.ts`).
   */
  const drag = useSheetDrag({ onDismiss: onClose, open });

  const isAdmin = !!user?.is_admin;

  // Mount/unmount follows `open` while rendering, not in an effect
  // (react.dev: "Adjusting some state when a prop changes"). Opening mounts at
  // once; on the web there is no fade-out, so closing unmounts at once too.
  if (open && !mounted) setMounted(true);
  if (!open && mounted && !NATIVE) setMounted(false);

  // Hängt bewusst NUR an `open` (die übrigen Werte sind beständig). Stünde
  // `mounted` mit in der Liste, liefe der Effekt direkt nach dem `setMounted`
  // ein zweites Mal – und setzte die gerade begonnene Einblendung zurück auf 0.
  useEffect(() => {
    if (open) {
      if (!NATIVE) {
        appear.setValue(1);
        return;
      }
      appear.setValue(0);
      const rise = Animated.timing(appear, { toValue: 1, duration: 180, useNativeDriver: true });
      rise.start();
      return () => rise.stop();
    }

    if (!NATIVE) return;
    // Erst ausblenden, dann aus dem Baum nehmen. Wird das Blatt mittendrin
    // wieder geöffnet, hält `stop()` die Ausblendung an und `finished` ist
    // false – das Abräumen unterbleibt dann richtigerweise.
    const fade = Animated.timing(appear, { toValue: 0, duration: 160, useNativeDriver: true });
    fade.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => fade.stop();
  }, [open, appear]);

  // Ohne `Modal` gibt es kein `onRequestClose` mehr: Die Zurück-Taste müssen wir
  // selbst abfangen, sonst verließe sie den Bildschirm, während das Blatt offen ist.
  useEffect(() => {
    if (!open || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  /** Erst schließen, dann navigieren – sonst liegt das Blatt über dem Ziel. */
  function go(path: Href) {
    onClose();
    setTimeout(() => router.push(path), 180);
  }

  // Erst das Blatt schließen lassen: ein Alert über einem gerade schließenden
  // Blatt wird auf iOS verschluckt.
  async function onLogout() {
    onClose();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const ok = await confirmAction('Abmelden', 'Möchtest du dich wirklich abmelden?', 'Abmelden');
    if (ok) logout();
  }

  if (!mounted) return null;

  /**
   * Der Benutzername, unter dem das eigene Profil erreichbar ist – oder `null`.
   *
   * Als eigene Konstante und nicht direkt in der Bedingung unten: Innerhalb der
   * `onPress`-Funktion würde TypeScript die Einschränkung auf `user?.username`
   * wieder verwerfen (Eigenschaften gelten in Rückrufen als veränderlich). Der
   * feste Wert hier ist gleichzeitig richtiger – er ist genau der, für den die
   * Zeile gebaut wurde.
   */
  const publicProfileName =
    accountAbilities(user).hasPublicProfile && user?.username ? user.username : null;

  const account: Entry[] = [
    // Nur ab Creator: Darunter gibt es keine öffentliche Seite (siehe
    // src/domain/account.ts). Ohne Benutzernamen fehlt zudem die Adresse –
    // Google-Konten starten ohne einen.
    ...(publicProfileName && Features.posts
      ? ([
          {
            icon: 'id-card',
            title: 'Mein Profil',
            hint: 'Beiträge und Social-Links – so sehen dich andere',
            onPress: () =>
              go({ pathname: '/profile/[username]', params: { username: publicProfileName } }),
          },
        ] satisfies Entry[])
      : []),
    // Fortschritt und Prämien sind gerade ausgeblendet (src/constants/features.ts).
    ...(Features.progress
      ? ([
          {
            icon: 'medal',
            title: 'Fortschritt & Abzeichen',
            hint: 'Level, XP und Rangliste',
            onPress: () => go('/progress'),
          },
        ] satisfies Entry[])
      : []),
    ...(Features.rewards
      ? ([
          {
            icon: 'ticket',
            title: 'Prämien',
            hint: 'Punkte einlösen und deine Codes',
            onPress: () => go('/rewards'),
          },
        ] satisfies Entry[])
      : []),
    {
      icon: 'user',
      title: 'Mein Profil',
      hint: 'Erstellt, dabei und gemerkt',
      onPress: () => go('/me'),
    },
    // Nur ab Business. Der Bereich war einmal ein Tab; seit „Freunde" dazukam,
    // sind Androids fünf Ziele mit dem belegt, was ALLE Konten haben (siehe
    // src/components/app-tabs.tsx). Ein Bereich für eine Stufe gehört ans Konto.
    ...(Features.accountTiers && accountAbilities(user).hasBusinessArea
      ? ([
          {
            icon: 'trend-up',
            title: 'Business',
            hint: 'Umsatz, Buchungen und Reichweite',
            onPress: () => go('/business'),
          },
        ] satisfies Entry[])
      : []),
    {
      icon: 'gear',
      title: 'Einstellungen',
      hint: 'Konto, Benachrichtigungen, Privatsphäre',
      onPress: () => go('/settings'),
    },
  ];

  const admin: Entry[] = [
    { icon: 'chart', title: 'Dashboard', hint: 'Kennzahlen und alle Events', onPress: () => go('/admin-dashboard') },
    { icon: 'users', title: 'Nutzer verwalten', hint: 'Sperren, Timeouts, Rollen', onPress: () => go('/admin-users') },
    { icon: 'robot', title: 'KI-Verifizierung', hint: 'Geprüfte Inhalte', onPress: () => go('/admin-moderation') },
    { icon: 'folder', title: 'Beweise', hint: 'Belege zu Sperren', onPress: () => go('/admin-evidence') },
  ];

  /** Nach oben gibt das Blatt nicht nach – sonst klaffte darunter eine Lücke. */
  const sheetShift = drag.dragY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolateLeft: 'clamp',
  });

  /** Beim Öffnen steigt das Blatt ein Stück auf, beim Schließen sinkt es zurück. */
  const riseShift = appear.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_RISE, 0],
    extrapolate: 'clamp',
  });

  /** Der Hintergrund geht mit: je weiter das Blatt weg ist, desto klarer die App. */
  const dragFade = drag.dragY.interpolate({
    inputRange: [0, 240],
    outputRange: [1, 0.3],
    extrapolate: 'clamp',
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Hintergrund: Weichzeichner + Schleier. Blendet auf, blendet zu und geht
          beim Wegwischen mit – daher beide Werte multipliziert. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(appear, dragFade) }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Schließen">
          <BlurView
            intensity={BACKDROP_BLUR}
            tint={isDark ? 'dark' : 'light'}
            blurMethod={BLUR_METHOD}
            blurTarget={blurTarget}
            style={StyleSheet.absoluteFill}
          />
          {/* Der Schleier deckt den GANZEN Bildschirm, nicht nur die Fläche über
              dem Blatt. Sonst lugte durch die runden Ecken unverdunkelte App
              hervor – das war die sichtbare Kante am Übergang. */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.scrim }]} />
        </Pressable>
      </Animated.View>

      <Animated.View
        onLayout={drag.onSheetLayout}
        style={[
          styles.sheet,
          {
            borderColor: glass.border,
            // Das Blatt reicht bis zum Fensterrand, die native Tab-Leiste liegt
            // aber darüber. Ohne ihren Platz verschwände „Abmelden" dahinter.
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
            opacity: appear,
            transform: [{ translateY: Animated.add(riseShift, sheetShift) }],
          },
        ]}>
        {/* Echtes Glas – und BEWUSST ohne eigene Füllung darüber: Die Tönung,
            die `BlurView` von sich aus aufträgt, IST die Füllung (siehe die
            Notiz an `SHEET_BLUR`). Legte man `glass.fill` obendrauf, käme das
            zusammen wieder auf ~80 % Deckung und das Glas wäre eine Farbfläche.
            Die Rundung steht auch am Weichzeichner selbst: Android schneidet
            ihn nicht immer zuverlässig an der Kante des Elternteils ab. */}
        <BlurView
          intensity={SHEET_BLUR}
          tint={isDark ? 'dark' : 'light'}
          blurMethod={BLUR_METHOD}
          blurTarget={blurTarget}
          style={[StyleSheet.absoluteFill, styles.sheetCorners]}
        />
        {/* Lichtsaum an der Oberkante – wie bei allen anderen Glasflächen. */}
        <LinearGradient
          pointerEvents="none"
          colors={[glass.highlight, 'transparent']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.sheetCorners, { opacity: 0.55 }]}
        />

        {/* Griffzone. Balken und Profilzeile stehen bewusst AUSSERHALB der
            Liste: Hier gibt es keine ScrollView, die um die Bewegung streitet,
            also greift das Wischen hier immer – auch wenn die Liste unten
            gerade weit heruntergescrollt ist. */}
        <View {...drag.headPan.panHandlers} style={styles.head}>
          <View style={[styles.grabber, { backgroundColor: surface.textMuted }]} />

          {/* Wer bin ich gerade? */}
          <View style={styles.profile}>
            <LinearGradient
              colors={[...BrandGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileRing}>
              <View style={[styles.profileInner, { backgroundColor: surface.chipBgSolid }]}>
                {user?.avatar ? (
                  <Image source={{ uri: user.avatar }} style={styles.profileImage} resizeMode="cover" />
                ) : (
                  <ThemedText style={[styles.profileInitials, { color: surface.accent }]}>
                    {initialsOf(user?.name)}
                  </ThemedText>
                )}
              </View>
            </LinearGradient>

            <View style={styles.profileText}>
              <ThemedText style={[styles.profileName, { color: surface.text }]} numberOfLines={1}>
                {user?.name ?? 'Konto'}
              </ThemedText>
              <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                {/* Die Stufe steht immer da – auch wenn kein Kontotyp gesetzt
                    ist: Dann gelten die Rechte von Standard (siehe
                    src/domain/account.ts), und genau das soll dort stehen. */}
                {[user?.username ? `@${user.username}` : null, accountLabel(user?.account_type)]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
            </View>

            {isAdmin ? (
              <ThemedText
                type="small"
                style={[styles.adminBadge, { color: surface.accent, backgroundColor: surface.chipBgSolid }]}>
                ADMIN
              </ThemedText>
            ) : null}
          </View>
        </View>

        {/* Der Griff um die Liste sitzt auf dieser Hülle und nicht auf der
            ScrollView selbst – nur als echter Vorfahr kommt er in der
            Capture-Phase vor ihr dran.
            `bounces={false}`: Sonst federt die Liste am oberen Ende mit,
            während das Blatt schon am Wischen ist – zwei Bewegungen für eine
            Geste. Der Scrollstand entscheidet, wer die Geste bekommt. */}
        <View {...drag.listPan.panHandlers} style={styles.listWrap}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            scrollEventThrottle={16}
            onScroll={drag.onScroll}
            contentContainerStyle={styles.sheetContent}>
            <Section label="Konto" surface={surface}>
              {account.map((entry) => (
                <Row key={entry.title} entry={entry} surface={surface} />
              ))}
            </Section>

            {isAdmin ? (
              <Section label="Admin-Bereich" surface={surface}>
                {admin.map((entry) => (
                  <Row key={entry.title} entry={entry} surface={surface} />
                ))}
              </Section>
            ) : null}

            <Pressable
              onPress={onLogout}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.logout,
                { borderColor: surface.cardBorder },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: '#ef4444' }}>
                Abmelden
              </ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  );
}

type Surface = ReturnType<typeof useBrandSurface>;

function Section({
  label,
  surface,
  children,
}: {
  label: string;
  surface: Surface;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" style={[styles.sectionLabel, { color: surface.textMuted }]}>
        {label.toUpperCase()}
      </ThemedText>
      {/* DECKEND, nicht durchsichtig: Das Blatt selbst ist schon Glas (Blur +
          Tönung). Eine zusätzlich durchsichtige Fläche darauf ließ die
          weichgezeichnete App durch die Liste hindurchscheinen – zwei Glasstufen
          übereinander, an denen das Blau kaum noch zu erkennen war. `chipBgSolid`
          ist dasselbe Blau, nur ausgerechnet. */}
      <View
        style={[
          styles.sectionBody,
          { backgroundColor: surface.chipBgSolid, borderColor: surface.chipBorder },
        ]}>
        {children}
      </View>
    </View>
  );
}

function Row({ entry, surface }: { entry: Entry; surface: Surface }) {
  return (
    <Pressable
      onPress={entry.onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: surface.chipBgStrong }]}>
      {/* Kachel eine Stufe kräftiger als die Liste – sonst löst sie sich im Blau auf. */}
      <View style={[styles.rowIcon, { backgroundColor: surface.chipBgStrong }]}>
        <Icon name={entry.icon} size={19} color={surface.chipText} />
      </View>
      <View style={styles.rowText}>
        <ThemedText type="smallBold" style={{ color: surface.text }}>
          {entry.title}
        </ThemedText>
        {entry.hint ? (
          <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
            {entry.hint}
          </ThemedText>
        ) : null}
      </View>
      <Icon name="chevron-right" size={18} color={surface.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

  avatarRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 2,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  initials: { fontSize: 15, fontWeight: '800', fontFamily: FontFamily.bold },
  adminDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    backgroundColor: '#22c55e',
  },

  sheet: {
    // Am unteren Rand verankert statt „unter einem flex:1-Schleier": So deckt
    // der Hintergrund den ganzen Bildschirm und nicht nur den Teil über dem Blatt.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    // Ohne `overflow: 'hidden'` malen Weichzeichner und Inhalt über die runden
    // Ecken hinweg – genau deshalb sah das Blatt oben eckig aus. Android
    // beachtet `borderRadius` bei Kindelementen ausschließlich hierüber.
    overflow: 'hidden',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    maxHeight: '86%',
  },
  /** Dieselbe Rundung für die Glasschichten – Androids Sicherheitsnetz. */
  sheetCorners: {
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
  },
  // Feste Griffzone über der Liste: Balken und Profilzeile. Der Abstand nach
  // unten ersetzt den Zwischenraum, den die Profilzeile vorher als erstes
  // Element der Liste aus deren `gap` bekam.
  head: { paddingBottom: Spacing.four },
  // Seit das Blatt sich wegwischen lässt, ist der Griff kein Zierstrich mehr,
  // sondern der sichtbare Hinweis darauf – darum etwas kräftiger als zuvor.
  grabber: {
    alignSelf: 'center',
    width: 48,
    height: 5,
    borderRadius: 999,
    opacity: 0.55,
    marginBottom: Spacing.three,
  },
  // `flexShrink`, weil die Hülle sonst nicht nachgibt: Eine ScrollView schrumpft
  // von sich aus innerhalb der `maxHeight` des Blattes, ein schlichtes `View`
  // nicht – ohne das liefe die Liste unten aus dem Blatt heraus.
  listWrap: { flexShrink: 1 },
  sheetContent: { gap: Spacing.four, paddingBottom: Spacing.two },

  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  profileRing: { width: 58, height: 58, borderRadius: 29, padding: 2.5 },
  profileInner: {
    flex: 1,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileImage: { width: '100%', height: '100%' },
  profileInitials: { fontSize: 20, fontWeight: '800', fontFamily: FontFamily.bold },
  profileText: { flex: 1, gap: 2 },
  profileName: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  adminBadge: {
    fontWeight: '800',
    letterSpacing: 1.2,
    fontSize: 11,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    overflow: 'hidden',
  },

  section: { gap: Spacing.two },
  sectionLabel: { letterSpacing: 0.8, marginLeft: Spacing.half, fontSize: 12 },
  sectionBody: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },

  logout: {
    alignSelf: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: 999,
    borderWidth: 1,
  },
});
