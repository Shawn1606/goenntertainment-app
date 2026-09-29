/**
 * Aus einem Orts-Text die Anfragen bauen, mit denen ein Geocoder etwas findet.
 *
 * ## Warum das nötig ist
 *
 * Nominatim beantwortet „Nörgelbuff, Gronerstraße 23, Göttingen" mit einer
 * LEEREN Liste – geprüft am 29.07.2026. Es sucht die Bestandteile gemeinsam, und
 * einen Datensatz, der Vereinsname UND Hausnummer trägt, gibt es meist nicht.
 * „Gronerstraße 23, Göttingen" und „Nörgelbuff Göttingen" liefern dagegen beide
 * denselben Punkt.
 *
 * Das trifft nicht nur importierte Events: „Location, Straße, Stadt" ist die Art,
 * wie Menschen einen Ort aufschreiben. Ohne Rückfallstufen bleibt die Karte für
 * genau die Schreibweise leer, die am häufigsten vorkommt.
 *
 * Hier steht nur die Textarbeit, ohne Netz – deshalb testbar
 * (siehe place-query.test.ts). Das Anfragen selbst macht src/lib/geocode.ts.
 */

/**
 * Die Anfragen zu einem Orts-Text, von genau nach grob.
 *
 * Reihenfolge ist Absicht:
 *  1. Der ganze Text – wenn er trifft, ist er die genaueste Antwort.
 *  2. Ohne den führenden Namen ("Gronerstraße 23, Göttingen") – eine Adresse
 *     ist der verlässlichste Treffer, den ein Geocoder kennt.
 *  3. Name + letzter Bestandteil ("Nörgelbuff Göttingen") – greift, wenn keine
 *     Straße dabeisteht oder die Hausnummer unbekannt ist.
 *
 * Die reine Stadt ist bewusst KEINE Stufe: Sie würde für jeden unauffindbaren
 * Ort einen Pin in die Stadtmitte setzen. Ein Pin, der einen anderen Ort behauptet,
 * ist schlechter als kein Pin – auf einer Karte ist die Position die ganze Aussage.
 */
export function placeQueries(location: string): string[] {
  const full = String(location ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!full) return [];

  const parts = full
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  // Nur Trennzeichen und sonst nichts (",,,"): Da ist kein Ort drin, und eine
  // Anfrage darauf wäre eine verschenkte Sekunde am Rate-Limit.
  if (parts.length === 0) return [];

  const queries = [full];

  if (parts.length >= 2) {
    const [name, ...rest] = parts;
    queries.push(rest.join(', '));

    const city = parts[parts.length - 1];
    // Nur wenn der Name nicht selbst die Stadt ist ("Göttingen, Göttingen").
    if (name.toLowerCase() !== city.toLowerCase()) {
      queries.push(`${name} ${city}`);
    }
  }

  // Doppelte fallen heraus: Bei zwei Bestandteilen sind Stufe 2 und 3 sonst
  // dieselbe Anfrage, und das wäre eine verschenkte Sekunde am Rate-Limit.
  return [...new Set(queries)];
}
