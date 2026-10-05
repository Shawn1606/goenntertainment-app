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

import { CreditsSheetProvider } from '@/components/credits-sheet';
import { renderAppHeader } from '@/components/ui/app-header';
import { AppSettingsProvider } from '@/lib/app-settings';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { MarketProvider } from '@/lib/market-context';
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
        {/* Die drei Tabs: Home · Finden · Karte (src/components/app-tabs.tsx). */}
        <Stack.Screen name="(app)" />

        {/* Marktplatz */}
        <Stack.Screen name="offer/[id]" />
        <Stack.Screen name="partner/[id]" />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="bookings" />

        {/* Club, Credits, Stempel, Check-in */}
        <Stack.Screen name="club" />
        <Stack.Screen name="wallet" />
        <Stack.Screen name="stamps" />
        <Stack.Screen name="checkin" />
        {/* Aufkleber-Link `…/c/<token>` – leitet in den Check-in. */}
        <Stack.Screen name="c/[token]" />

        {/* Gruppen und Gruppen-Chat */}
        <Stack.Screen name="groups" />
        <Stack.Screen name="group/[id]" />
        <Stack.Screen name="join/[code]" />
        <Stack.Screen name="chat" />

        {/* Konto: hinter dem Profilbild oben rechts. */}
        <Stack.Screen name="account" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="security/password" />
        <Stack.Screen name="security/two-factor" />
        <Stack.Screen name="security/delete-account" />
        <Stack.Screen name="blocked" />

        {/* Partner-Modus (Mitarbeitende eines Partners). */}
        <Stack.Screen name="partner-mode" />

        {/* Admin-Bereich: eigene Stack-Routen, erreichbar über das Konto. */}
        <Stack.Screen name="admin-dashboard" />
        <Stack.Screen name="admin-partners" />
        <Stack.Screen name="admin-partner" />
        <Stack.Screen name="admin-offer" />
        <Stack.Screen name="admin-vouchers" />
        <Stack.Screen name="admin-users" />
        <Stack.Screen name="admin-reports" />
        <Stack.Screen name="admin-evidence" />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Rechtstexte – AUSSERHALB beider Wächter: Bei der Registrierung muss man
          den Bedingungen zustimmen, und genau dort gibt es noch keinen Token. */}
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
  // Pacifico = Wortmarke, Instrument Sans = Schrift der gesamten Oberfläche.
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
          {/* Angebote, Club, Gruppen, Buchungen – ein Stand für alle Screens. */}
          <MarketProvider>
            <CreditsSheetProvider>
              <ThemedNavigation fontsReady={fontsLoaded} />
            </CreditsSheetProvider>
          </MarketProvider>
        </AppSettingsProvider>
      </ThemePreferenceProvider>
    </AuthProvider>
  );
}
