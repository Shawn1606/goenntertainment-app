import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Ziel der Aufkleber-Adresse `…/c/<token>` – geöffnet über einen Link (Kamera-App,
 * Browser-Seite „In der App öffnen"). Leitet in den Check-in weiter, der den
 * Code sofort einlöst.
 */
export default function StickerLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <Redirect href={{ pathname: '/checkin', params: { token } }} />;
}
