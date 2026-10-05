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
    // Der Browser-Dialog kennt nur „OK": Was OK bedeutet, steht deshalb im Text –
    // bei Käufen ist das die Pflichtangabe „Zahlungspflichtig …".
    const meaning = confirmLabel !== 'OK' ? `\n\nOK = ${confirmLabel}` : '';
    const ok = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}${meaning}`);
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

/**
 * Reine Info-Meldung (ein Knopf), die auf Handy UND Web funktioniert.
 * Das Promise löst auf, wenn die Meldung weggeklickt wurde – so kann man
 * danach zuverlässig weiterarbeiten (z. B. abmelden).
 */
export function notifyUser(title: string, message: string, buttonLabel = 'OK'): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [{ text: buttonLabel, onPress: () => resolve() }], {
      onDismiss: () => resolve(),
    });
  });
}
