/**
 * Eine Liste in Abschnitte je Interesse zerlegen.
 *
 * ## Warum
 *
 * „Alles entdecken" mit 131 Einträgen ist keine Liste, sondern ein Haufen. Wer
 * Theater sucht, wischt an Konzerten vorbei; wer Konzerte sucht, an Lesungen.
 * Nach Kategorie unterteilt wird daraus eine Liste, in der man springen kann,
 * statt zu suchen – und die Überschrift sagt vorher, ob sich das Springen lohnt.
 *
 * ## Jede Aktivität landet in GENAU EINEM Abschnitt
 *
 * Ein Event darf bis zu fünf Interessen tragen. Es in jeden passenden Abschnitt
 * zu legen wäre die naheliegende Lesart von „unterteilen", ist aber falsch: Die
 * Zahlen an den Überschriften summieren sich dann auf mehr als die Trefferzahl
 * darüber, und dasselbe Event begegnet einem beim Wischen dreimal. Genau das
 * Gefühl – „habe ich das nicht schon gesehen?" – sollte das Unterteilen ja
 * beenden.
 *
 * ## Ein Kategorie-Abschnitt heißt: GENAU diese eine Kategorie
 *
 * Hier stand früher „zugeordnet wird das ERSTE Interesse". Das war ein Raten:
 * Ein Event mit „Konzerte + Tanzen" stand dann unter Konzerten, obwohl es
 * genauso gut ins Tanz-Regal gehört – und wer das Tanz-Regal durchwischte, fand
 * es dort nie. Die Reihenfolge vom Server ist bloß die Reihenfolge beim
 * Erstellen, keine Aussage über „hauptsächlich".
 *
 * Ein Abschnitt trägt deshalb nur Events, die GENAU EINE Kategorie haben – bei
 * ihnen ist die Zuordnung eindeutig. Alles mit mehreren Kategorien und alles
 * ohne Kategorie sammelt der Restposten „Weitere" am Ende ein. Nichts geht
 * verloren, nichts steht doppelt, und keine Überschrift behauptet etwas, was
 * nur geraten war.
 *
 * ## Häufige KOMBINATIONEN bekommen ihren eigenen Abschnitt
 *
 * Der Restposten war damit die größte Schublade: Der importierte Feed vergibt an
 * jedes Konzert „Konzerte + Musik", und 87 Termine lagen unter „Weitere", während
 * das Konzert-Regal einen einzigen trug. Eine Kombination, die so oft vorkommt, ist
 * keine Ausnahme – sie ist eine Kategorie, die nur keinen eigenen Namen hat.
 *
 * Ab mehr als {@link OWN_SECTION_MIN} - 1 Terminen mit der GLEICHEN Kombination wird
 * daraus deshalb ein eigener Abschnitt „Konzerte + Musik", und diese Termine sind aus
 * „Weitere" heraus. Was seltener vorkommt, bleibt dort: Bei zwei Terminen wäre ein
 * eigenes Regal mit doppeltem Titel mehr Überschrift als Inhalt.
 *
 * Die Reihenfolge innerhalb des Titels ist ALPHABETISCH und nicht die des Servers:
 * „Konzerte + Musik" und „Musik + Konzerte" sind dieselbe Kombination und müssen
 * denselben Abschnitt und denselben Titel ergeben.
 *
 * Bewusst kein `import type { Activity } from '@/lib/api'`: Die Domänen-Schicht
 * kennt die Transportschicht nicht (wie in story.ts).
 */

export type GroupableInterestItem = {
  id: number;
  interests: readonly { id: number; name: string }[];
  starts_at?: string | null;
};

export type InterestSection<T extends GroupableInterestItem> = {
  /** Stabiler Schlüssel für `key`-Props. */
  key: string;
  /**
   * Die Kategorie, deren ZEICHEN der Abschnitt trägt.
   *
   * Bei einem Kombinations-Abschnitt die erste seiner Kategorien – ein Zeichen ist
   * besser als keines, und es stimmt für einen Teil des Abschnitts. `null` nur im
   * Restposten, der für keine bestimmte Kategorie steht.
   */
  interestId: number | null;
  /** Was über dem Abschnitt steht. */
  title: string;
  activities: T[];
};

/**
 * Überschrift des Restpostens: seltene Kategorie-Kombinationen und Events ohne
 * eine einzige Kategorie. „Ohne Kategorie" hieß es, solange nur Letztere hier
 * lagen – das wäre jetzt falsch, denn ein Konzert mit Tanzabend hat eher zu viele
 * als keine.
 */
export const REST_TITLE = 'Weitere';

/**
 * Ab so vielen Terminen wird aus einer Kategorie-Kombination ein eigener Abschnitt.
 *
 * Sechs, also „mehr als fünf": Fünf Termine sind ein Zufall in den Daten, sechs
 * sind ein Muster. Kleiner gewählt würde die Startseite eine Wand aus Regalen mit
 * je zwei Terminen und dreiteiligen Überschriften; größer blieben Hunderte Termine
 * in „Weitere" liegen.
 */
export const OWN_SECTION_MIN = 6;

/** Der Restposten – ein Schlüssel, der keiner Kategorie gehören kann. */
const REST_KEY = 'interest-rest';

/**
 * Wofür ein Event stehen KÖNNTE: eine Kategorie, eine Kombination, oder nichts.
 *
 * „Könnte", weil erst die Häufigkeit entscheidet: Eine Kombination bekommt ihren
 * Abschnitt nur, wenn genug Termine sie teilen (siehe {@link OWN_SECTION_MIN}).
 */
type Bucket = {
  key: string;
  /** Zeichen-Kategorie: die einzige bzw. die erste der Kombination. */
  interestId: number | null;
  title: string;
  /** Mehrere Kategorien – dieser Abschnitt muss sich seine Größe verdienen. */
  combined: boolean;
};

/** Der Abschnitt, in den dieses Event GERNE käme. */
function bucketFor(item: GroupableInterestItem): Bucket {
  const tags = activityTags(item);

  if (tags.length === 0) {
    return { key: REST_KEY, interestId: null, title: REST_TITLE, combined: false };
  }

  if (tags.length === 1) {
    return {
      key: `interest-${tags[0].id}`,
      interestId: tags[0].id,
      title: tags[0].name,
      combined: false,
    };
  }

  return {
    // Die IDs im Schlüssel folgen der (alphabetischen) Reihenfolge der Namen, damit
    // Schlüssel und Titel dieselbe Kombination beschreiben.
    key: `interests-${tags.map((tag) => tag.id).join('-')}`,
    interestId: tags[0].id,
    title: tags.map((tag) => tag.name).join(' + '),
    combined: true,
  };
}

/**
 * Die Kategorien eines Events, alphabetisch und ohne Dubletten.
 *
 * Alphabetisch, weil „Konzerte + Musik" und „Musik + Konzerte" dieselbe Kombination
 * sind; ohne Dubletten, weil eine doppelt vergebene Kategorie sonst eine eigene
 * „Musik + Musik"-Schublade aufmachen würde.
 */
function activityTags(item: GroupableInterestItem): { id: number; name: string }[] {
  const seen = new Set<number>();
  const tags = [];
  for (const tag of item.interests ?? []) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    tags.push(tag);
  }
  return tags.sort((a, b) => a.name.localeCompare(b.name, 'de-DE') || a.id - b.id);
}

/** Aufsteigend nach Startzeit; ohne brauchbares Datum entscheidet die ID. */
function byStart(a: GroupableInterestItem, b: GroupableInterestItem): number {
  const at = Date.parse(a.starts_at ?? '');
  const bt = Date.parse(b.starts_at ?? '');
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk !== bOk) return aOk ? -1 : 1;
  if (aOk && bOk && at !== bt) return at - bt;
  return a.id - b.id;
}

/**
 * Zerlegt die Liste in Abschnitte je Interesse.
 *
 * Die Abschnitte stehen nach Größe, der volle zuerst: Bei zehn Kategorien und
 * einem Bildschirm zählt, was tatsächlich etwas hergibt. Bei gleicher Größe
 * entscheidet der Name, damit die Reihenfolge zwischen zwei Aufrufen nicht
 * springt. „Weitere" steht immer am Ende – es ist ein Restposten, keine
 * Kategorie.
 *
 * `sortWithin` aus: Wenn die Liste schon sortiert ist (etwa nach Nähe), soll das
 * Unterteilen die Ordnung nicht überschreiben.
 */
export function groupByInterest<T extends GroupableInterestItem>(
  activities: readonly T[],
  { sortWithin = true }: { sortWithin?: boolean } = {},
): InterestSection<T>[] {
  /**
   * Erst zählen, dann einsortieren.
   *
   * Ob eine Kombination ihren eigenen Abschnitt bekommt, hängt davon ab, wie oft
   * sie insgesamt vorkommt – das weiß man beim ersten Termin noch nicht. Deshalb
   * zwei Durchgänge; das Einsortieren läuft danach in der ursprünglichen
   * Reihenfolge, damit `sortWithin: false` eine vorhandene Ordnung behält.
   */
  const buckets = activities.map((activity) => bucketFor(activity));

  const counts = new Map<string, number>();
  for (const bucket of buckets) {
    counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
  }

  const sections = new Map<string, InterestSection<T>>();

  activities.forEach((activity, index) => {
    const wanted = buckets[index];
    // Eine Kombination, die zu selten vorkommt, wandert in den Restposten.
    const bucket =
      wanted.combined && (counts.get(wanted.key) ?? 0) < OWN_SECTION_MIN
        ? { key: REST_KEY, interestId: null, title: REST_TITLE, combined: false }
        : wanted;

    const existing = sections.get(bucket.key);
    if (existing) {
      existing.activities.push(activity);
      return;
    }

    sections.set(bucket.key, {
      key: bucket.key,
      interestId: bucket.interestId,
      title: bucket.title,
      activities: [activity],
    });
  });

  const list = [...sections.values()];
  if (sortWithin) {
    for (const section of list) section.activities.sort(byStart);
  }

  return list.sort((a, b) => {
    // Restposten immer ans Ende, unabhängig von seiner Größe.
    if (a.interestId === null) return 1;
    if (b.interestId === null) return -1;
    return b.activities.length - a.activities.length || a.title.localeCompare(b.title, 'de-DE');
  });
}
