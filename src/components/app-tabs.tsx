import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useResolvedScheme } from '@/lib/theme-preference';

/**
 * Untere Leiste im Instagram-/TikTok-Muster:
 *
 *   Home · Karte · ＋ Erstellen · Freunde · Profil
 *
 * ## Warum genau diese fünf
 *
 * Das ist die Reihenfolge, die man aus Instagram und TikTok kennt – und genau
 * deshalb braucht sie keine Erklärung: Links das Stöbern, in der Mitte das
 * Erstellen, rechts außen das eigene Profil. Wer eine der beiden Apps benutzt,
 * findet sich ohne Nachdenken zurecht.
 *
 * - **Home** ist der Feed mit den Aktivitäten.
 * - **Karte** zeigt dieselben Aktivitäten nach Ort.
 * - **＋** steht in der Mitte, weil Erstellen der Kern ist: Ohne neue Aktivitäten
 *   ist die App leer. Vorher war der Knopf ein schwebender Kreis irgendwo auf der
 *   Startseite und nur für manche Kontostufen da.
 * - **Freunde** bündelt Leute, Gruppen und Chats.
 * - **Profil** ist das eigene Profil mit „Erstellt / Dabei / Gemerkt". Dort hängen
 *   auch die Einstellungen (Zahnrad oben rechts), wie bei Instagram. Die früheren
 *   Tabs „Aktivitäten" und „Einstellungen" sind darin aufgegangen.
 *
 * ## Symbole
 *
 * iOS bekommt SF Symbols – die Hausschrift dort, mit Umriss im Ruhezustand und
 * gefüllt, wenn der Tab aktiv ist (genau das Instagram-Verhalten). Android
 * bekommt eigene PNGs aus `scripts/make-tab-icons.mjs`; die Leiste färbt sie über
 * `iconColor`. Beschriftungen bleiben stehen: Sie kosten kaum Platz und nehmen
 * jedes Rätselraten, wofür ein Symbol steht.
 *
 * ## Warum `backBehavior="history"`
 *
 * Diese expo-router-Fassung übergibt dem Router kein `initialRouteName`; als
 * „erster" Tab gilt der zuerst deklarierte. Mit `history` geht die Zurück-Taste
 * auf Android dorthin, wo man herkam – unabhängig von der Reihenfolge.
 *
 * ## Fünf ist die Grenze
 *
 * Androids untere Leiste fasst höchstens fünf Einträge; ab dem sechsten faltet
 * sie alles Weitere in einen „More"-Tab. Alles Weitere (Chats, Einstellungen,
 * Admin) liegt deshalb als Stack-Route hinter einem Symbol im jeweiligen Kopf.
 */
export default function AppTabs() {
  const scheme = useResolvedScheme();
  const colors = Colors[scheme];

  return (
    <NativeTabs
      backBehavior="history"
      backgroundColor={colors.background}
      tintColor={colors.text}
      iconColor={{ default: colors.textSecondary, selected: colors.text }}
      indicatorColor={colors.backgroundElement}
      labelStyle={{
        default: { color: colors.textSecondary },
        selected: { color: colors.text },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          src={require('@/assets/images/tabIcons/home.png')}
          selectedColor={colors.text}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Label>Karte</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'map', selected: 'map.fill' }}
          src={require('@/assets/images/tabIcons/map.png')}
          selectedColor={colors.text}
        />
      </NativeTabs.Trigger>

      {/* Die Mitte: Erstellen. Das Symbol trägt den Akzent auch im Ruhezustand –
          es ist die eine Handlung, zu der die Leiste einlädt. */}
      <NativeTabs.Trigger name="create">
        <NativeTabs.Trigger.Label>Erstellen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'plus.app', selected: 'plus.app.fill' }}
          src={require('@/assets/images/tabIcons/plus.png')}
          selectedColor={colors.tint}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="friends">
        <NativeTabs.Trigger.Label>Freunde</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.2', selected: 'person.2.fill' }}
          src={require('@/assets/images/tabIcons/people.png')}
          selectedColor={colors.text}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="me">
        <NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          src={require('@/assets/images/tabIcons/person.png')}
          selectedColor={colors.text}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
