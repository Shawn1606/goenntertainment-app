import { Alert, Platform } from 'react-native';

/**
 * Ja/Nein-Rückfrage, die auf Handy UND Web funktioniert.
 * Native: React-Native-`Alert` mit zwei Knöpfen. Web: `window.confirm`
 * (RN-`Alert` hat im Web keine funktionierenden Knopf-Callbacks).
 *
 * Gibt `true` zurück, wenn bestätigt wurde.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel = 'OK',
  destructive = false,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
    return Promise.resolve(Boolean(ok));
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
