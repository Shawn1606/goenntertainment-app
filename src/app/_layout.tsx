import { Pacifico_400Regular, useFonts } from '@expo-google-fonts/pacifico';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

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
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(app)" />
        {/* Kein 'modal': Auf Android baute der Modal-Screen sich bei jeder
            Tastatur-/Layout-Änderung neu auf (Foto/Fokus/Interessen gingen
            verloren). Als normaler Screen bleibt der Zustand erhalten. */}
        <Stack.Screen name="create-activity" />
        {/* Karten-Ortsauswahl aus dem „Activity erstellen"-Formular. */}
        <Stack.Screen name="pick-location" />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Admin-Panel: immer per URL /admin erreichbar (eigener Login, im Browser bedienbar) */}
      <Stack.Screen name="admin" />
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
  const [fontsLoaded] = useFonts({ Pacifico_400Regular });

  return (
    <AuthProvider>
      <ThemePreferenceProvider>
        <ThemedNavigation fontsReady={fontsLoaded} />
      </ThemePreferenceProvider>
    </AuthProvider>
  );
}
