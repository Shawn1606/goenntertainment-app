import { Stack } from 'expo-router';

import { ForceScheme } from '@/lib/theme-preference';

/**
 * Die Anmelde-Screens laufen immer auf der hellen Leinwand (GoennBackground).
 * Damit Felder und Karten darin nicht in Dark-Mode-Farben kippen, wenn im
 * Konto Dark-Mode gewählt ist, wird das Schema hier fest auf hell gesetzt.
 */
export default function AuthLayout() {
  return (
    <ForceScheme scheme="light">
      <Stack
        screenOptions={{
          headerShown: false,
          headerBackTitle: 'Zurück',
          headerBackButtonDisplayMode: 'default',
        }}
      />
    </ForceScheme>
  );
}
