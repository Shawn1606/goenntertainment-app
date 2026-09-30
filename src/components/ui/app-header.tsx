import type { NativeStackHeaderProps } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/ui/icon-button';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/go-back';

/**
 * Die Kopfzeile ALLER Stack-Screens – als `header` im Stack eingehängt.
 *
 * ## Warum nicht der System-Kopf
 *
 * Der eingebaute Kopf zeichnet auf jeder Plattform etwas anderes: iOS einen
 * blauen bzw. akzentfarbenen Pfeil mit „Zurück", Android einen nackten Pfeil,
 * das Web eine Textzeile. Neben den eigenen runden Knöpfen der App wirkte das
 * wie ein vergessener Platzhalter. Diese Fassung hat überall dieselbe Form:
 * runder Zurück-Knopf links, Titel in der Mitte, Platz für eine Aktion rechts.
 *
 * Jeder Screen, der `headerShown: true` setzt, bekommt sie automatisch – ohne
 * eine Zeile eigenen Code. `title`, `headerRight`, `headerLeft` und
 * `headerTransparent` wirken wie gewohnt; die Farb-Optionen des System-Kopfs
 * (`headerTintColor`, `headerStyle`) sind wirkungslos, die Farben kommen aus dem
 * Thema.
 *
 * Die Wisch-Geste zurück auf iOS bleibt erhalten: Sie hängt am Stack, nicht an
 * der Kopfzeile.
 */
export function AppHeader({ navigation, options, back }: NativeStackHeaderProps) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const transparent = !!options.headerTransparent;

  const title =
    typeof options.headerTitle === 'string'
      ? options.headerTitle
      : typeof options.title === 'string'
        ? options.title
        : '';

  const left: ReactNode = options.headerLeft ? (
    options.headerLeft({ tintColor: colors.text, canGoBack: !!back, label: 'Zurück' })
  ) : (
    <BackButton
      variant={transparent ? 'elevated' : 'filled'}
      onPress={() => (back ? navigation.goBack() : goBack())}
    />
  );

  const right: ReactNode = options.headerRight
    ? options.headerRight({ tintColor: colors.text, canGoBack: !!back })
    : null;

  return (
    <View
      style={[
        transparent ? styles.floating : { backgroundColor: colors.background },
        { paddingTop: insets.top + Spacing.one },
      ]}
      pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.side}>{left}</View>
        {/* Über einem Bild (durchsichtiger Kopf) bleibt der Titel weg – auf einem
            Foto wäre er nicht zuverlässig lesbar, und der Screen zeigt den Namen
            ohnehin groß im Inhalt. */}
        {!transparent && title ? (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : (
          <View style={styles.titleSpacer} />
        )}
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
}

/** Für `screenOptions={{ header: renderAppHeader }}`. */
export function renderAppHeader(props: NativeStackHeaderProps) {
  return <AppHeader {...props} />;
}

const styles = StyleSheet.create({
  floating: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  /** Beide Seiten gleich breit – nur so steht der Titel wirklich in der Mitte. */
  side: { width: 88, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end', gap: Spacing.two },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FontFamily.bold,
    fontSize: 17,
  },
  titleSpacer: { flex: 1 },
});
