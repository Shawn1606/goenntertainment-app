/**
 * Storys: die Zahlen und die Gruppierung, die App und Server gemeinsam kennen.
 *
 * Gegenstück auf dem Server: `STORY_HOURS` in server/src/routes/stories.js.
 */

/** Wie lange eine Story sichtbar bleibt. */
export const STORY_HOURS = 24;

/**
 * Das Mindeste, was diese Datei von einer Story wissen muss.
 *
 * Bewusst nicht `import type { Story } from '@/lib/api'`: Die Domänen-Schicht
 * läuft unter `node --test` ohne den `@/`-Alias und ohne React Native. Ein
 * struktureller Typ hier hält beide Seiten testbar – `Story` aus der API passt
 * darauf, ohne dass eine der Dateien die andere kennen muss.
 */
export type GroupableStory = {
  id: number;
  seen: boolean;
  is_mine: boolean;
  created_at: string | null;
  user: { id: number; name: string };
};

/**
 * Alle Storys EINER Person – ein Ring in der Leiste.
 *
 * `stories` liegt in Erzählreihenfolge: älteste zuerst. Das ist die Reihenfolge,
 * in der man sie ansieht, und sie ist unabhängig davon, in welcher Reihenfolge
 * der Server die flache Liste vorschlägt.
 */
export type StoryGroup<T extends GroupableStory = GroupableStory> = {
  /** Stabil über Neuladen hinweg – als `key` in der Leiste brauchbar. */
  key: string;
  user: T['user'];
  stories: T[];
  /** true = ALLE Storys dieser Person sind gesehen. Färbt den Ring. */
  seen: boolean;
  /** true = die eigenen Storys („Deine Story"). */
  isMine: boolean;
};

/**
 * Storys nach Person bündeln – ein Ring pro Person statt pro Story.
 *
 * ## Warum überhaupt
 *
 * Vorher war jede Story ein eigener Ring. Wer drei Bilder hochlud, stand
 * dreimal in der Leiste, und der Betrachter sprang beim Weitertippen zur
 * nächsten PERSON statt zum nächsten eigenen Bild. Das ist nicht nur unschön –
 * es macht die Leiste bei wenigen aktiven Konten unbrauchbar, weil sie dann nur
 * noch aus Wiederholungen desselben Gesichts besteht.
 *
 * ## Zwei Reihenfolgen, und beide sind Absicht
 *
 * - **Die Gruppen** stehen in der Reihenfolge, in der ihre erste Story in der
 *   Serverliste auftaucht. Der Server sortiert ungesehene nach vorn (siehe
 *   server/src/routes/stories.js); hätten wir hier eine eigene Sortierung,
 *   gäbe es zwei Wahrheiten darüber, was „vorgeschlagen" heißt.
 * - **Innerhalb einer Gruppe** wird nach Alter sortiert, älteste zuerst. Eine
 *   Person erzählt ihren Tag vorwärts, nicht rückwärts. Bei gleichem oder
 *   fehlendem Datum entscheidet die ID – sie steigt mit der Zeit und ist damit
 *   der verlässlichere Ersatz.
 *
 * Gruppiert wird über `user.id`. Der Name wäre die naheliegende, aber falsche
 * Wahl: Zwei Konten dürfen „Max" heißen.
 */
export function groupStories<T extends GroupableStory>(stories: readonly T[]): StoryGroup<T>[] {
  const byUser = new Map<number, StoryGroup<T>>();

  for (const story of stories) {
    const id = story.user?.id;
    // Eine Story ohne Konto kann es nicht geben – wenn doch, überspringen wir
    // sie, statt eine Gruppe ohne Namen zu bauen.
    if (typeof id !== 'number') continue;

    const existing = byUser.get(id);
    if (existing) {
      existing.stories.push(story);
      // Ein Ring leuchtet, solange EINE Story ungesehen ist.
      existing.seen = existing.seen && story.seen;
      continue;
    }

    byUser.set(id, {
      key: `user-${id}`,
      user: story.user,
      stories: [story],
      seen: story.seen,
      isMine: story.is_mine,
    });
  }

  const groups = [...byUser.values()];
  for (const group of groups) group.stories.sort(byAge);
  return groups;
}

/** Älteste zuerst; ohne brauchbares Datum entscheidet die (aufsteigende) ID. */
function byAge(a: GroupableStory, b: GroupableStory): number {
  const at = Date.parse(a.created_at ?? '');
  const bt = Date.parse(b.created_at ?? '');
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  return a.id - b.id;
}

/**
 * Bei welcher Story einer Gruppe soll der Betrachter aufgehen?
 *
 * Bei der ersten ungesehenen – das ist der Punkt, an dem man beim letzten Mal
 * aufgehört hat. Sind alle gesehen, fängt es wieder vorne an: Wer eine
 * durchgesehene Gruppe erneut antippt, will sie nochmal ansehen und nicht auf
 * dem letzten Bild stehen.
 */
export function firstUnseenIndex(group: Pick<StoryGroup, 'stories'>): number {
  const index = group.stories.findIndex((story) => !story.seen);
  return index === -1 ? 0 : index;
}

/**
 * Einen Schritt weiter oder zurück – über Gruppengrenzen hinweg.
 *
 * Die ganze Blätter-Logik des Betrachters steckt hier und nicht in der
 * Komponente: Sie hat vier Randfälle (Anfang der ersten Gruppe, Ende einer
 * Gruppe, Ende der letzten Gruppe, leere Gruppe), und die will man geprüft
 * haben, nicht im Kopf durchspielen.
 *
 * @returns die neue Position, oder `null` für „hier ist Schluss" – dann schließt
 *   der Betrachter. Am ANFANG gibt es kein `null`: Zurücktippen vor der ersten
 *   Story bleibt einfach stehen, denn Zurück soll nie beenden.
 */
export function stepStory(
  groups: readonly Pick<StoryGroup, 'stories'>[],
  at: { group: number; story: number },
  direction: 1 | -1,
): { group: number; story: number } | null {
  const current = groups[at.group];
  if (!current) return null;

  const next = at.story + direction;

  if (next >= 0 && next < current.stories.length) {
    return { group: at.group, story: next };
  }

  if (direction === 1) {
    // Nächste Gruppe mit Inhalt suchen; leere überspringen statt auf ihnen
    // stehen zu bleiben.
    for (let g = at.group + 1; g < groups.length; g += 1) {
      if (groups[g].stories.length > 0) return { group: g, story: 0 };
    }
    return null;
  }

  for (let g = at.group - 1; g >= 0; g -= 1) {
    if (groups[g].stories.length > 0) {
      return { group: g, story: groups[g].stories.length - 1 };
    }
  }
  // Vor der allerersten Story: stehen bleiben, nicht schließen.
  return { group: at.group, story: 0 };
}

/* ------------------------------------------------------------------- Der Ring */

/**
 * So viele Bögen bekommt ein Ring höchstens.
 *
 * Ein Bogen je Story sagt ohne Zahl, wie viel hinter dem Bild steckt. Ab etwa
 * zehn kippt das aber: Aus dem Ring wird eine gepunktete Linie, und die liest
 * sich als Muster statt als Anzahl. Wer mehr Storys hat, bekommt also zehn Bögen
 * – die genaue Zahl steht in der Leiste ohnehin als Plakette daneben.
 */
export const MAX_RING_ARCS = 10;

/** Ein Strichmuster für den Ring, oder `null` für „durchgezogen". */
export type RingDash = { arc: number; gap: number };

/**
 * Den Ring in einen Bogen je Story teilen.
 *
 * Gerechnet wird auf dem UMFANG und nicht in Grad: Ein SVG-Kreis nimmt sein
 * Strichmuster in Längeneinheiten (`strokeDasharray`), und eine Umrechnung über
 * Winkel wäre eine Fehlerquelle mehr.
 *
 * `gap` ist ein WUNSCH, keine Vorgabe: Bei vielen Storys würde eine feste Lücke
 * den Bogen zwischen ihren Nachbarn zerdrücken, bis vom Ring nur noch Punkte
 * übrig sind. Deshalb bleibt jeder Bogen mindestens doppelt so lang wie seine
 * Lücke – das ist die Grenze, ab der man noch Bögen sieht und keine Perlenkette.
 *
 * @returns `null` heißt „durchgezogen" – bei einer einzelnen Story, und bei
 *   Unsinn (0, negativ, NaN). Ein Ring ohne Muster ist der harmlose Rückfall.
 */
export function ringDash(circumference: number, stories: number, gap: number): RingDash | null {
  if (!Number.isFinite(circumference) || circumference <= 0) return null;

  const count = Math.floor(Number(stories));
  if (!Number.isFinite(count) || count <= 1) return null;

  const arcs = Math.min(count, MAX_RING_ARCS);
  const each = circumference / arcs;
  // Ein Drittel des Platzes ist die Obergrenze für die Lücke – siehe oben.
  const width = Math.min(Math.max(Number(gap) || 0, 0), each / 3);
  return { arc: each - width, gap: width };
}

/**
 * Wie viel Zeit eine Story noch hat, als kurzer Satz.
 *
 * ## Warum das Minuten und kein Zeitstempel sind
 *
 * Naheliegend wäre `new Date(expires_at) - now`. Das war die erste Fassung und sie
 * war um zwei Stunden falsch: Die Datenbank dieses Projekts liefert ihre
 * `NOW()`-Zeitstempel in Ortszeit, ausgeliefert werden sie aber mit einem
 * angehängten „Z", also als UTC (siehe die Notiz in server/src/db.js). Aus einer
 * 24-Stunden-Story wurden dadurch „noch 25 Stunden".
 *
 * Eine Restzeit ist eine **Dauer**, und Dauern brauchen keine Zeitzone. Der Server
 * rechnet sie deshalb selbst (`TIMESTAMPDIFF` gegen dasselbe `NOW()`, mit dem er
 * auch filtert) und schickt Minuten. Damit kann die Anzeige gar nicht mehr von der
 * Zeitzone abhängen.
 *
 * `null`, wenn nichts mehr übrig oder nichts bekannt ist: Dann soll gar nichts
 * stehen. „noch 0 Min." ist die Sorte Angabe, die eine Anzeige unglaubwürdig macht.
 */
export function remainingLabel(minutesLeft: number | null | undefined): string | null {
  if (minutesLeft === null || minutesLeft === undefined) return null;
  const minutes = Math.floor(Number(minutesLeft));
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `noch ${minutes} Min.`;

  const hours = Math.floor(minutes / 60);
  return `noch ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
}
