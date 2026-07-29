import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useResolvedScheme } from '@/lib/theme-preference';

/**
 * Untere Leiste: fünf Ziele – und zwar für alle Konten dieselben.
 *
 * ## Home steht in der MITTE
 *
 * Die Reihenfolge hier ist die Reihenfolge in der Leiste: Karte · Freunde ·
 * **Home** · Aktivitäten · Einstellungen. Home liegt damit unter dem Daumen, und
 * zwar bei jeder Handgröße – der mittlere Platz ist der einzige, den man ohne
 * Hinsehen trifft.
 *
 * ## „Größer" steckt in der ZEICHNUNG, nicht im Code
 *
 * Ein einzelnes Feld der nativen Leiste lässt sich nicht vergrößern: Android
 * gibt jedem Eintrag dasselbe Kästchen (24 dp) und rechnet jedes Bild hinein,
 * und die Schriftgröße gilt immer für alle Beschriftungen zusammen (die Leiste
 * liest sie aus dem gerade aktiven Eintrag, siehe NativeTabsView im Paket).
 * Genau deshalb ist Home nicht „ein größerer Tab", sondern ein größeres SYMBOL:
 * Das Haus füllt sein Kästchen fast vollständig, die übrigen vier füllen
 * deutlich weniger und sind untereinander gleich groß. Die Zahlen dazu stehen in
 * `scripts/make-tab-icons.mjs` (COVERAGE) – dort werden die PNGs erzeugt.
 *
 * Wer eine wirklich größere, erhöhte Mitte will (der runde Knopf, den man von
 * anderen Apps kennt), muss die native Leiste gegen eine selbstgebaute tauschen.
 * Das kostet nativen Blur, das Einklappen beim Scrollen auf iOS und die nativen
 * Übergänge – deshalb steht sie hier nicht.
 *
 * ## Warum `backBehavior="history"`
 *
 * Diese expo-router-Fassung übergibt dem Router KEIN `initialRouteName`; als
 * „erster" Tab gilt damit der zuerst deklarierte – und das ist seit der
 * Umsortierung die Karte. Mit der Voreinstellung `initialRoute` landete die
 * Zurück-Taste auf Android also auf der Karte statt auf Home. `history` geht
 * dorthin zurück, wo man herkam, und ist von der Reihenfolge unabhängig.
 *
 * ## Die Fünf-Ziele-Grenze bestimmt diese Datei
 *
 * Androids untere Leiste fasst höchstens fünf Einträge; ab dem sechsten faltet
 * sie alles Weitere in einen „More"-Tab, den kaum jemand öffnet. Alles, was hier
 * steht, muss sich diesen knappen Platz also verdienen.
 *
 * Deshalb liegen NICHT hier, sondern als eigene Stack-Routen (erreichbar über das
 * Konto-Blatt auf der Startseite, siehe `account-widget.tsx`):
 *  - der **Admin-Bereich** – Screens, die 99 % der Nutzer nie sehen dürfen,
 *  - der **Business-Bereich** – nur ab der Stufe Business,
 *  - **Fortschritt** und **Prämien** – beide hängen an ihren Karten auf der
 *    Startseite, von wo man sie ohnehin aufruft.
 *
 * ## Warum keine bedingten Einträge mehr
 *
 * Früher hing hier ein `hidden={!showBusiness}`-Eintrag. Das war die Lösung,
 * solange vier Ziele allen gehörten und einer übrig war. Mit „Freunde" sind die
 * fünf voll – und ein verstecktes sechstes Ziel wäre für Business-Konten genau
 * der „More"-Tab, den die ganze Aufteilung vermeiden soll. Jetzt sieht jedes Konto
 * dieselbe Leiste, und das ist ohnehin die bessere Erfahrung: Die Navigation
 * verändert sich nicht unter der Hand, wenn sich eine Stufe ändert.
 */
export default function AppTabs() {
  const scheme = useResolvedScheme();
  const colors = Colors[scheme];

  return (
    <NativeTabs
      backBehavior="history"
      backgroundColor={colors.background}
      tintColor={colors.tint}
      iconColor={{ default: colors.textSecondary, selected: colors.tint }}
      indicatorColor={colors.backgroundElement}
      labelStyle={{
        default: { color: colors.textSecondary },
        selected: { color: colors.tint },
      }}>
      <NativeTabs.Trigger name="map">
        <Label>Map</Label>
        <Icon src={require('@/assets/images/tabIcons/map.png')} selectedColor={colors.tint} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="friends">
        <Label>Freunde</Label>
        {/* iOS behält sein SF-Symbol – dort ist das die Hausschrift. Android
            bekommt die eigene Zeichnung; vorher lag hier dasselbe PNG wie unter
            „Einstellungen", zwei Einträge trugen also dasselbe Bild. */}
        <Icon
          sf="person.2.fill"
          androidSrc={require('@/assets/images/tabIcons/people.png')}
          selectedColor={colors.tint}
        />
      </NativeTabs.Trigger>

      {/* Die Mitte. Bewusst auf BEIDEN Plattformen dasselbe PNG und kein
          SF-Symbol: Ein SF-Symbol wird in der Standardgröße gezeichnet, und
          damit wäre Home auf iOS genauso groß wie alles andere – das eine, was
          dieser Eintrag nicht sein soll. */}
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        <Icon src={require('@/assets/images/tabIcons/home.png')} selectedColor={colors.tint} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="my-activities">
        <Label>Aktivitäten</Label>
        <Icon
          sf="list.bullet.rectangle"
          androidSrc={require('@/assets/images/tabIcons/list.png')}
          selectedColor={colors.tint}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Label>Einstellungen</Label>
        <Icon
          sf="gearshape.fill"
          androidSrc={require('@/assets/images/tabIcons/gear.png')}
          selectedColor={colors.tint}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
