import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import { Pacifico_400Regular, useFonts } from '@expo-google-fonts/pacifico';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { renderAppHeader } from '@/components/ui/app-header';
import { AppSettingsProvider } from '@/lib/app-settings';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ThemePreferenceProvider, useResolvedScheme } from '@/lib/theme-preference';

SplashScreen.preventAutoHideAsync();

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { isBootstrapping, token } = useAuth();
  const ready = fontsReady && !isBootstrapping;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  // Splash bleibt, bis Schrift geladen UND der gespeicherte Token geprüft ist.
  if (!ready) {
    return null;
  }

  return (
    // `headerBackTitle` global auf „Zurück": ohne das setzt iOS/Web den Titel des
    // vorherigen Screens ein – bei expo-router ist das der Routenname, also stand
    // auf dem Zurück-Knopf „(app)" oder „index". `displayMode: 'default'` hält das
    // Wort sichtbar, statt es bei langen Titeln auf den bloßen Pfeil einzukürzen.
    // `header`: Jeder Screen, der seinen Kopf einschaltet, bekommt den der App –
    // runder Zurück-Knopf statt System-Pfeil, überall gleich (app-header.tsx).
    <Stack
      screenOptions={{
        headerShown: false,
        headerBackTitle: 'Zurück',
        headerBackButtonDisplayMode: 'default',
        header: renderAppHeader,
      }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(app)" />
        {/* Kein 'modal': Auf Android baute der Modal-Screen sich bei jeder
            Tastatur-/Layout-Änderung neu auf (Foto/Fokus/Interessen gingen
            verloren). Als normaler Screen bleibt der Zustand erhalten. */}
        <Stack.Screen name="create-activity" />
        {/* Karten-Ortsauswahl aus dem „Activity erstellen"-Formular. */}
        <Stack.Screen name="pick-location" />
        {/* Story anlegen – erreichbar über „Deine Story" in der Story-Leiste. */}
        <Stack.Screen name="create-story" />
        {/* Chat-Übersicht und ein einzelner Chat. Bewusst Stack-Routen und keine
            Tabs: Die untere Leiste fasst fünf Ziele und ist voll (siehe
            app-tabs.tsx). Der Einstieg liegt im Freunde-Bereich, wo die Gruppen
            wohnen, und im Event-Popup für den Event-Chat. */}
        {/* Suche: Personen und Aktivitäten mit Verlauf – hinter der Lupe auf der
            Startseite und dem Suchfeld im Freunde-Tab. Blendet nur auf, statt
            hereinzuschieben: Sie legt sich über den Ort, von dem man kam. */}
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen name="chats" />
        <Stack.Screen name="chat" />
        {/* Die Glocke: was Leute gemacht haben, denen man folgt – und was auf
            den eigenen Beiträgen passiert ist. Wie die Chats eine Stack-Route,
            weil die untere Leiste ihre fünf Plätze voll hat; der Einstieg liegt
            oben rechts auf der Startseite. */}
        <Stack.Screen name="notifications" />
        {/* Einstellungen: seit dem Instagram-Umbau kein Tab mehr, sondern hinter dem
            Menü oben rechts im Profil. Mit Zurück-Knopf (setzt der Screen selbst). */}
        <Stack.Screen name="settings" />
        {/* Sicherheit: Passwort ändern, Zwei-Faktor, Konto löschen – aus den
            Einstellungen erreichbar. */}
        <Stack.Screen name="security/password" />
        <Stack.Screen name="security/two-factor" />
        <Stack.Screen name="security/delete-account" />
        {/* Blockierte Konten. Braucht einen eigenen Screen, weil eine blockierte
            Person überall sonst aus der App verschwindet – es gäbe kein Profil
            mehr, auf dem ein „Freigeben" stehen könnte. */}
        <Stack.Screen name="blocked" />
        {/* Admin-Bereich: eigene Stack-Routen statt Tabs – sonst faltet Android
            sie in einen „More"-Tab, der normale Nutzer nur verwirrt. Erreichbar
            über das Konto-Widget auf der Startseite. */}
        <Stack.Screen name="admin-dashboard" />
        {/* Admin: Liste aller Nutzer. */}
        <Stack.Screen name="admin-users" />
        {/* Admin: Anfragen auf Creator/Business/Business Plus bestätigen. */}
        <Stack.Screen name="admin-requests" />
        {/* Admin: laufende Storys ansehen und löschen. */}
        <Stack.Screen name="admin-stories" />
        {/* Admin: Berichte der KI-Verifizierung (Jugendschutz). */}
        <Stack.Screen name="admin-moderation" />
        {/* Admin: von Nutzer:innen gemeldete Inhalte und Konten. Der Gegenpart zum
            Haftungsausschluss – ohne diesen Ort wäre der Meldeknopf eine Attrappe. */}
        <Stack.Screen name="admin-reports" />
        {/* Admin: Beweismittel zu Sperren und Timeouts. */}
        <Stack.Screen name="admin-evidence" />
        {/* Fortschritt, Abzeichen und Rangliste (aus dem Kopf der Startseite). */}
        <Stack.Screen name="progress" />
        {/* Prämien: Punkte einlösen. Hängt an der Prämien-Karte auf der
            Startseite – dort steht der Punktestand, hier der Katalog. */}
        <Stack.Screen name="rewards" />
        {/* Business-Bereich. Kein Tab mehr: Androids untere Leiste fasst nur fünf
            Ziele, und die gehören seit dem Freunde-Tab allen Konten. Erreichbar
            über das Konto-Blatt – wie der Admin-Bereich, aus demselben Grund. */}
        <Stack.Screen name="business" />
        {/* Kontostufen: erreichbar über das Feld „Upgrade" oben links auf der
            Startseite. Bewusst ein eigener Screen und kein Blatt – vier Stufen
            mit ihren Vorzügen brauchen den Platz. */}
        <Stack.Screen name="upgrade" />
        {/* Öffentliche Profilseite (Stufe, Beiträge, Social-Links). Erreichbar
            über das Konto-Widget – und über den Host-Namen im Event-Popup, das
            ist der Weg, auf dem andere ein Profil überhaupt finden. */}
        <Stack.Screen name="profile/[username]" />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Rechtstexte IN der App: Impressum, Nutzungsbedingungen, Haftung, Regeln,
          Datenschutz (siehe src/domain/legal.ts).

          Bewusst AUSSERHALB beider Wächter: Bei der Registrierung muss man den
          Bedingungen zustimmen, und genau dort gibt es noch keinen Token. Lägen
          diese Texte im geschützten Bereich, führte der Link im
          Zustimmungssatz ins Leere – man müsste zustimmen, ohne lesen zu können. */}
      <Stack.Screen name="legal" />
    </Stack>
  );
}

/** Navigations-Theme an das aufgelöste Farbschema (inkl. Dark-Mode-Setting) koppeln. */
function ThemedNavigation({ fontsReady }: { fontsReady: boolean }) {
  const scheme = useResolvedScheme();

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <RootNavigator fontsReady={fontsReady} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Pacifico = Wortmarke, Instrument Sans = Schrift der gesamten Oberfläche
  // (dieselbe Familie wie auf cira.systems).
  const [fontsLoaded] = useFonts({
    Pacifico_400Regular,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  return (
    <AuthProvider>
      <ThemePreferenceProvider>
        <AppSettingsProvider>
          <ThemedNavigation fontsReady={fontsLoaded} />
        </AppSettingsProvider>
      </ThemePreferenceProvider>
    </AuthProvider>
  );
}
