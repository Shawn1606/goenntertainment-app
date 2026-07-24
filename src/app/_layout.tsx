import { Pacifico_400Regular, useFonts } from '@expo-google-fonts/pacifico';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth-context';

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
        <Stack.Screen name="create-activity" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Admin-Panel: immer per URL /admin erreichbar (eigener Login, im Browser bedienbar) */}
      <Stack.Screen name="admin" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({ Pacifico_400Regular });

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RootNavigator fontsReady={fontsLoaded} />
      </ThemeProvider>
    </AuthProvider>
  );
}
