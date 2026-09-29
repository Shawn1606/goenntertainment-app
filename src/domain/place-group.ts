/**
 * Aktivitäten am selben Ort zu EINEM Pin zusammenfassen.
 *
 * ## Warum
 *
 * Ein Veranstaltungsort hat nicht ein Event, sondern ein Programm. Das Nörgelbuff
 * allein bringt 143 Termine – als Marker je Termin liegen 143 Pins exakt
 * übereinander. Sichtbar ist dann einer, antippbar der zufällig oberste, und die
 * Karte behauptet, es gäbe in Göttingen einen einzigen Abend.
 *
 * Ein Pin je Ort, der eine Liste öffnet, ist die einzige Darstellung, die der
 * Wirklichkeit entspricht: Man entscheidet erst wohin, dann was.
 *
 * ## Gruppiert wird über die KOORDINATE, nicht über den Ortstext
 *
 * Zwei Schreibweisen desselben Hauses („Nörgelbuff, Gronerstraße 23, Göttingen"
 * und „Nörgelbuff Göttingen") ergeben Punkte, die wenige Meter auseinanderliegen
 * – über den Text gruppiert wären das zwei Pins aufeinander, also genau das
 * Problem zurück. Auf einer Karte zählt, ob sich Pins überdecken, und das ist
 * eine Frage der Position.
 *
 * Bewusst kein `import type { Activity } from '@/lib/api'`: Die Domänen-Schicht
 * kennt die Transportschicht nicht, deshalb reicht die Form, die wirklich
 * gebraucht wird (wie in story.ts).
 */

export type PlaceCoords = { lat: number; lng: number };

export type GroupablePlaceItem = {
  id: number;
  location?: string | null;
  starts_at?: string | null;
  coords: PlaceCoords;
};

export type PlaceGroup<T extends GroupablePlaceItem> = {
  /** Stabiler Schlüssel für `key`-Props und Auswahl-Vergleiche. */
  key: string;
  /** Gemeinsame Position des Pins. */
  coords: PlaceCoords;
  /** Was am Pin steht. */
  location: string;
  /** Alle Termine dort, der nächste zuerst. */
  activities: T[];
};

/**
 * Ab welchem Abstand zwei Positionen als verschiedene Orte gelten.
 *
 * 50 m, und das ist großzügig gemeint: Ein Kartenstift ist ~30 px breit, was bei
 * Stadt-Zoom über 100 m entspricht – näher beieinander überdecken sich zwei Pins
 * ohnehin, egal was die Koordinaten sagen.
 */
const SAME_PLACE_METERS = 50;

/**
 * Abstand in Metern.
 *
 * Gleichwinklige Näherung statt Haversine: Auf 50 m liegt der Fehler weit unter
 * einem Meter, und die Formel ist die Hälfte so lang.
 */
function metersBetween(a: PlaceCoords, b: PlaceCoords): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  // Längengrade rücken zu den Polen zusammen – ohne cos wäre der Abstand in
  // Ost-West-Richtung in Göttingen um ~38 % zu groß.
  const dLng = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  return Math.hypot(dLat, dLng) * EARTH_RADIUS_M;
}

/** Aufsteigend nach Startzeit; ohne brauchbares Datum entscheidet die ID. */
function byStart(a: GroupablePlaceItem, b: GroupablePlaceItem): number {
  const at = Date.parse(a.starts_at ?? '');
  const bt = Date.parse(b.starts_at ?? '');
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  // Termine ohne Datum nach hinten: Ein Pin soll mit dem nächsten Abend aufmachen.
  if (aOk !== bOk) return aOk ? -1 : 1;
  if (aOk && bOk && at !== bt) return at - bt;
  return a.id - b.id;
}

/**
 * Der Text, der am Pin steht: die häufigste Schreibweise der Gruppe.
 *
 * Bei Gleichstand gewinnt die zuerst gesehene – damit ist das Ergebnis
 * reproduzierbar und nicht von der Aufzählungsreihenfolge einer Map abhängig.
 */
function labelFor(items: GroupablePlaceItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = item.location?.trim();
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  let best = '';
  let bestCount = 0;
  for (const [text, count] of counts) {
    if (count > bestCount) {
      best = text;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Fasst Aktivitäten mit (fast) derselben Position zusammen.
 *
 * Die Gruppen stehen chronologisch – der Ort mit dem nächsten Termin zuerst.
 * Das ist dieselbe Ordnung, die die Regale auf Home benutzen, und sie macht die
 * Reihenfolge für Tests eindeutig.
 */
export function groupByPlace<T extends GroupablePlaceItem>(items: readonly T[]): PlaceGroup<T>[] {
  /**
   * Gesammelt wird nach ABSTAND und nicht über eine gerundete Koordinate als
   * Schlüssel.
   *
   * Das Runden war der erste Versuch und ist falsch: Der Namens-Treffer des
   * Nörgelbuff (51.5319201) und der Adress-Treffer (51.5318459) liegen 11 m
   * auseinander, fallen aber auf verschiedene Seiten der vierten Nachkommastelle.
   * Ein Gitter trennt zwei Punkte immer dann, wenn eine Zellgrenze zwischen
   * ihnen liegt – wie nah sie sind, spielt dabei keine Rolle.
   */
  const buckets: { anchor: PlaceCoords; items: T[] }[] = [];

  for (const item of items) {
    // Ohne brauchbare Koordinate gibt es keinen Pin – solche Einträge zählt
    // `useMapActivities` bereits als `unlocated`, hier wären sie ein Pin bei 0/0.
    const lat = item.coords?.lat;
    const lng = item.coords?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // Verglichen wird gegen den ANKER, den ersten Eintrag der Gruppe – nicht
    // gegen den laufenden Mittelwert. Sonst wandert der Bezugspunkt mit jedem
    // Zugang, und eine Kette knapper Abstände zieht am Ende Orte zusammen, die
    // 200 m auseinanderliegen.
    const bucket = buckets.find(
      (candidate) => metersBetween(candidate.anchor, item.coords) <= SAME_PLACE_METERS,
    );
    if (bucket) bucket.items.push(item);
    else buckets.push({ anchor: item.coords, items: [item] });
  }

  const groups = buckets.map(({ anchor, items: bucketItems }) => {
    const activities = [...bucketItems].sort(byStart);
    return {
      // Der Anker steckt im Schlüssel: Er ist über einen Lauf hinweg stabil und
      // hängt nicht daran, welcher Termin gerade der nächste ist.
      key: `place-${anchor.lat.toFixed(5)},${anchor.lng.toFixed(5)}`,
      // Die Position des Ankers und nicht der Mittelwert: Ein Mittelwert aus zwei
      // nahen Punkten liegt an einer Stelle, an der nichts ist.
      coords: anchor,
      location: labelFor(activities),
      activities,
    };
  });

  return groups.sort((a, b) => byStart(a.activities[0], b.activities[0]));
}
