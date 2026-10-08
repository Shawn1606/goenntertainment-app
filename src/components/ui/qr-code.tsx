import { create } from 'qrcode';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/**
 * QR-Code als SVG – für die Authenticator-App, den Kunden-Pass und Aufkleber-Codes.
 *
 * `qrcode` rechnet nur das Punkteraster aus (reines JavaScript, läuft in Expo Go
 * ohne nativen Teil); gezeichnet wird mit react-native-svg, das die App ohnehin
 * hat. Alle dunklen Felder landen in EINEM Pfad statt in hunderten Rechtecken –
 * das bleibt beim Zeichnen flüssig.
 *
 * Immer schwarz auf weiß, unabhängig vom Dunkelmodus: Viele Scanner lesen
 * invertierte Codes nicht.
 */
export function QrCode({ value, size = 200, label = 'QR-Code' }: { value: string; size?: number; label?: string }) {
  const { path, count } = useMemo(() => {
    const qr = create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);

  // Ruhezone von 4 Feldern rundum – ohne sie erkennen manche Scanner den Rand nicht.
  const quiet = 4;
  const total = count + quiet * 2;

  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${total} ${total}`} accessibilityLabel={label}>
      <Rect x={-quiet} y={-quiet} width={total} height={total} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
