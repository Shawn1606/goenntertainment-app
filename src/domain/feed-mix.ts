/**
 * Der „Für dich"-Feed: Beiträge von Leuten, dazwischen Dauerangebote.
 *
 * ## Das Problem
 *
 * Dauerangebote (Bowling, Trampolinhalle, Freibad – `is_permanent`) haben keinen
 * Termin. In einer nach Relevanz sortierten Liste landen sie deshalb entweder
 * alle ganz oben (dann sieht der Feed aus wie ein Branchenbuch) oder alle ganz
 * unten (dann sieht sie niemand). Beides ist falsch: Sie sind die Antwort auf
 * „heute ist nichts los, was geht trotzdem?" – und genau die Frage kommt beim
 * Scrollen, nicht vorher.
 *
 * ## Die Regel
 *
 * Die Beiträge von Leuten bleiben in ihrer Reihenfolge und sind der Feed. Nach
 * den ersten `firstAt` Beiträgen und danach alle `every` Beiträge kommt ein
 * Block „Jederzeit möglich" mit ein paar Dauerangeboten – immer die nächsten,
 * reihum, damit nicht jeder Block dasselbe zeigt. Jedes Dauerangebot taucht
 * höchstens zweimal im ganzen Feed auf; „immer mal wieder" soll nicht heißen
 * „alle zehn Zentimeter dasselbe".
 *
 * Gibt es gar keine Beiträge, werden die Dauerangebote selbst zum Feed – ein
 * Feed, der nur aus einem Karussell besteht, wäre eine leere Seite mit Deko.
 *
 * Reine Funktion ohne React, damit sie sich testen lässt.
 */

export type MixableActivity = { id: number; is_permanent: boolean };

export type FeedItem<T extends MixableActivity> =
  | { kind: 'post'; key: string; activity: T }
  | { kind: 'evergreen'; key: string; activities: T[] };

export type MixOptions = {
  /** Nach so vielen Beiträgen kommt der erste Block. */
  firstAt?: number;
  /** Danach alle so viele Beiträge ein weiterer. */
  every?: number;
  /** Höchstens so viele Dauerangebote pro Block. */
  perBlock?: number;
};

export const MIX_DEFAULTS: Required<MixOptions> = { firstAt: 2, every: 4, perBlock: 4 };

export function mixFeed<T extends MixableActivity>(ranked: readonly T[], options: MixOptions = {}): FeedItem<T>[] {
  const { firstAt, every, perBlock } = { ...MIX_DEFAULTS, ...options };
  const posts = ranked.filter((a) => !a.is_permanent);
  const evergreens = ranked.filter((a) => a.is_permanent);

  if (posts.length === 0) {
    return evergreens.map((activity) => ({ kind: 'post', key: `post-${activity.id}`, activity }));
  }

  const items: FeedItem<T>[] = [];
  const blockSize = Math.max(1, Math.min(perBlock, evergreens.length));
  // Jedes Dauerangebot höchstens zweimal: so viele Blöcke, wie dafür nötig sind.
  const maxBlocks = evergreens.length === 0 ? 0 : Math.ceil((evergreens.length * 2) / blockSize);
  let cursor = 0;
  let blocks = 0;

  const pushBlock = () => {
    if (blocks >= maxBlocks) return;
    const chunk: T[] = [];
    for (let i = 0; i < blockSize; i++) chunk.push(evergreens[(cursor + i) % evergreens.length]);
    cursor = (cursor + blockSize) % evergreens.length;
    items.push({ kind: 'evergreen', key: `evergreen-${blocks}`, activities: chunk });
    blocks++;
  };

  posts.forEach((activity, index) => {
    items.push({ kind: 'post', key: `post-${activity.id}`, activity });
    const count = index + 1;
    if (count === firstAt || (count > firstAt && (count - firstAt) % every === 0)) pushBlock();
  });

  // Weniger Beiträge als bis zum ersten Block: dann steht er eben am Ende –
  // sonst sähe man die Dauerangebote bei einem kleinen Feed nie.
  if (blocks === 0) pushBlock();

  return items;
}
