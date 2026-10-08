/**
 * Gesperrte Begriffe in Namen, Benutzernamen und Texten – reine Logik.
 *
 * Die Liste kommt als Parameter herein (Inhalt von shared/blocked-terms.json); in
 * der App reicht sie `src/lib/blocked-terms.ts` durch. So bleibt diese Datei ohne
 * JSON-Import und laeuft unveraendert unter `node --test`.
 *
 * ## Warum die App das selbst prueft
 *
 * Entscheiden tut der Server: Laravel lehnt gesperrte Namen bei Registrierung und
 * Profil ab, Node bei Texten, Gruppen und Chat. Die App rechnet dasselbe nur
 * VORHER, damit die Meldung schon am Feld steht, bevor jemand auf „Weiter" tippt –
 * und zwar wortgleich mit der des Servers (beide lesen `messages` aus der Datei).
 *
 * ## Die Vorschrift
 *
 * Steht ausfuehrlich in server/src/blocked-terms.js; diese Datei rechnet Schritt
 * fuer Schritt dasselbe, die gemeinsamen Faelle in
 * shared/blocked-terms.fixtures.json halten beide (und Laravel) gegeneinander.
 * Kurz: NFKD + Vollbreite + klein → zwei Faltungen (ä→ae / ä→a, Zeichentabelle,
 * Akzente weg) → je vier Leet-Lesarten → „Stuecke" (zwischen Leerzeichen,
 * zusammengezogen) und „Woerter" (auch an camelCase-Grenzen) → `substring` in
 * Stuecken, `prefix` am Wortanfang, `word` als ganzes Wort, `allow` als Ausnahme.
 *
 * Bewusst ohne `Object.hasOwn` und `String.prototype.matchAll`: Beides ist in
 * aelteren Hermes-Fassungen nicht sicher vorhanden, und ein Fehler hier liesse das
 * Registrierungsformular abstuerzen statt nur ohne Vorab-Pruefung zu laufen.
 */

export type BlockedTermMode = 'username' | 'name' | 'text';

export const BLOCKED_TERM_MODES: readonly BlockedTermMode[] = ['username', 'name', 'text'];

/** 'length': the input is longer than `max_input_length` (see findBlockedTerm). */
export type BlockedTermKind = 'substring' | 'prefix' | 'word' | 'length';

export type BlockedTermGroup = {
  id: string;
  modes: readonly string[];
  note?: string;
  substring?: readonly string[];
  prefix?: readonly string[];
  word?: readonly string[];
};

export type BlockedTermLists = {
  version: number;
  /** Longest input the filter examines, in code points; longer input is a 'length' hit. */
  max_input_length: number;
  messages: Record<BlockedTermMode, string>;
  groups: readonly BlockedTermGroup[];
  allow: readonly string[];
  normalize: {
    umlauts: Record<string, string>;
    leet: Record<string, string>;
    leet_alt: Record<string, string>;
    chars: Record<string, string>;
  };
};

export type BlockedTermHit = { term: string; group: string; kind: BlockedTermKind };

type Table = {
  umlauts: Map<string, string>;
  leet: Map<string, string>;
  leetAlt: Map<string, string>;
  chars: Map<string, string>;
};

type CompiledTerm = {
  term: string;
  kind: BlockedTermKind;
  inChunks: RegExp | null;
  inTokens: RegExp | null;
};

type Compiled = {
  table: Table;
  groups: { id: string; modes: readonly string[]; terms: CompiledTerm[] }[];
  allow: RegExp[];
};

const toMap = (record: Record<string, string>) => new Map(Object.entries(record));

// --- Normalisierung ----------------------------------------------------------

/** Schritt 1: NFKD, Vollbreite, Kleinschreibung. */
function prepare(text: string): string {
  let s = text;
  try {
    s = s.normalize('NFKD');
  } catch {
    // Ohne Normalisierung bleibt die Zeichentabelle – sie kennt die gaengigen
    // Akzentbuchstaben auch zusammengesetzt.
  }
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return s.toLowerCase();
}

/** Schritt 2: Umlaute (nur Variante A), Zeichentabelle, kombinierende Zeichen. */
function fold(prepared: string, umlautVariant: boolean, table: Table): string {
  const cps = Array.from(prepared);
  let out = '';
  for (let i = 0; i < cps.length; i += 1) {
    const ch = cps[i];
    if (umlautVariant) {
      const pair = i + 1 < cps.length ? ch + cps[i + 1] : null;
      const pairValue = pair !== null ? table.umlauts.get(pair) : undefined;
      if (pairValue !== undefined) {
        out += pairValue;
        i += 1;
        continue;
      }
      const single = table.umlauts.get(ch);
      if (single !== undefined) {
        out += single;
        continue;
      }
    }
    const mapped = table.chars.get(ch);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x300 && cp <= 0x36f) continue;
    out += ch;
  }
  return out;
}

const isLetter = (ch: string) => ch >= 'a' && ch <= 'z';
const isDigit = (ch: string) => ch >= '0' && ch <= '9';

/** Schritt 3: Leetspeak – alles oder nur innen, 1 als i oder l. */
function leet(folded: string, oneAs: 'i' | 'l', innerOnly: boolean, table: Table): string {
  const cps = Array.from(folded);
  const isRunChar = (ch: string) => isLetter(ch) || isDigit(ch) || table.leet.has(ch);
  const mapChar = (ch: string) => {
    if (isLetter(ch)) return ch;
    const alt = oneAs === 'l' ? table.leetAlt.get(ch) : undefined;
    if (alt !== undefined) return alt;
    return table.leet.get(ch) ?? '';
  };

  let out = '';
  let i = 0;
  while (i < cps.length) {
    if (!isRunChar(cps[i])) {
      out += cps[i];
      i += 1;
      continue;
    }
    let j = i;
    while (j < cps.length && isRunChar(cps[j])) j += 1;
    const run = cps.slice(i, j);
    i = j;

    if (!run.some(isLetter)) {
      out += run.join('');
      continue;
    }
    let from = 0;
    let to = run.length;
    let prefix = '';
    let suffix = '';
    if (innerOnly) {
      while (!isLetter(run[from])) from += 1;
      while (!isLetter(run[to - 1])) to -= 1;
      if (from > 0) prefix = ' ';
      if (to < run.length) suffix = ' ';
    }
    out += prefix + run.slice(from, to).map(mapChar).join('') + suffix;
  }
  return out;
}

const unique = (items: string[]) => Array.from(new Set(items));

function variants(text: string, table: Table): string[] {
  const prepared = prepare(text);
  const out: string[] = [];
  for (const f of [fold(prepared, true, table), fold(prepared, false, table)]) {
    out.push(f, leet(f, 'i', false, table), leet(f, 'i', true, table));
    out.push(leet(f, 'l', false, table), leet(f, 'l', true, table));
  }
  return unique(out);
}

function splitCamel(text: string): string {
  const cps = Array.from(text);
  let out = '';
  for (let i = 0; i < cps.length; i += 1) {
    const ch = cps[i];
    const prev = i > 0 ? cps[i - 1] : null;
    const prevIsLower = prev !== null && prev !== prev.toUpperCase() && prev === prev.toLowerCase();
    const isUpper = ch !== ch.toLowerCase();
    if (prevIsLower && isUpper) out += ' ';
    out += ch;
  }
  return out;
}

function mergeSingles(items: string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const item of items) {
    if (item.length === 1 && isLetter(item)) {
      run.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

/** `\x0B` statt `\v` – siehe server/src/blocked-terms.js (PCRE versteht `\v` weiter). */
function chunkLine(variant: string): string {
  const chunks = variant
    .split(/[ \t\n\r\f\x0B]+/)
    .map((chunk) => chunk.replace(/[^a-z0-9]+/g, ''))
    .filter((chunk) => chunk !== '');
  return mergeSingles(chunks).join(' ');
}

function tokenLine(variant: string): string {
  return mergeSingles(variant.match(/[a-z]+|[0-9]+/g) ?? []).join(' ');
}

const LINE_SEPARATOR = ' | ';

/** Der Text in den Formen, in denen gesucht wird – fuer Tests und zum Nachvollziehen. */
export function analyseText(
  text: string,
  lists: BlockedTermLists,
): { chunks: string[]; tokens: string[] } {
  return analyseWith(text, compile(lists).table);
}

function analyseWith(text: string, table: Table): { chunks: string[]; tokens: string[] } {
  const raw = typeof text === 'string' ? text : '';
  const plain = variants(raw, table);
  const camel = splitCamel(raw);
  const withCamel = camel === raw ? plain : [...plain, ...variants(camel, table)];
  return {
    chunks: unique(plain.map(chunkLine)),
    tokens: unique(withCamel.map(tokenLine)),
  };
}

// --- Begriffe ----------------------------------------------------------------

function runsPattern(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j += 1;
    const count = j - i;
    out += count === 1 ? `${s[i]}+` : `${s[i]}{${count},}`;
    i = j;
  }
  return out;
}

function termTokens(term: string, table: Table): string[] {
  return fold(prepare(term), true, table).match(/[a-z]+|[0-9]+/g) ?? [];
}

function compileTerm(term: string, kind: Exclude<BlockedTermKind, 'length'>, table: Table) {
  const tokens = termTokens(term, table);
  if (tokens.length === 0) return null;
  const sequence = tokens.map(runsPattern).join(' ?');
  const compiled: CompiledTerm = { term, kind, inChunks: null, inTokens: null };
  if (kind === 'substring') {
    compiled.inChunks = new RegExp(runsPattern(tokens.join('')), 'g');
    if (tokens.length > 1) compiled.inTokens = new RegExp(`(?:^| )${sequence}(?= |$)`, 'g');
  } else if (kind === 'prefix') {
    compiled.inTokens = new RegExp(`(?:^| )${sequence}`, 'g');
  } else {
    compiled.inTokens = new RegExp(`(?:^| )${sequence}(?= |$)`, 'g');
  }
  return { compiled, key: `${kind}:${tokens.join(' ')}` };
}

const cache = new WeakMap<BlockedTermLists, Compiled>();

function compile(lists: BlockedTermLists): Compiled {
  const cached = cache.get(lists);
  if (cached) return cached;

  const table: Table = {
    umlauts: toMap(lists.normalize.umlauts),
    leet: toMap(lists.normalize.leet),
    leetAlt: toMap(lists.normalize.leet_alt),
    chars: toMap(lists.normalize.chars),
  };
  const kinds: Exclude<BlockedTermKind, 'length'>[] = ['substring', 'prefix', 'word'];
  const groups = lists.groups.map((group) => {
    const seen = new Set<string>();
    const terms: CompiledTerm[] = [];
    for (const kind of kinds) {
      for (const term of group[kind] ?? []) {
        const result = compileTerm(term, kind, table);
        if (!result || seen.has(result.key)) continue;
        seen.add(result.key);
        terms.push(result.compiled);
      }
    }
    return { id: group.id, modes: group.modes, terms };
  });
  const allow = lists.allow
    .map((term) => termTokens(term, table).join(''))
    .filter((squashed) => squashed !== '')
    .map((squashed) => new RegExp(runsPattern(squashed), 'g'));

  const compiled = { table, groups, allow };
  cache.set(lists, compiled);
  return compiled;
}

/** Alle Treffer eines globalen Musters als [von, bis). */
function spans(re: RegExp, line: string): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  let m = re.exec(line);
  while (m !== null) {
    const start = m.index + (m[0][0] === ' ' ? 1 : 0);
    out.push([start, m.index + m[0].length]);
    m = re.exec(line);
  }
  return out;
}

function hasUncoveredHit(
  re: RegExp,
  line: string,
  allow: RegExp[],
  spanCache: Map<string, [number, number][]>,
): boolean {
  for (const [start, end] of spans(re, line)) {
    let allowed = spanCache.get(line);
    if (!allowed) {
      allowed = allow.flatMap((a) => spans(a, line));
      spanCache.set(line, allowed);
    }
    if (!allowed.some(([from, to]) => from <= start && to >= end)) return true;
  }
  return false;
}

/** `max_input_length` of a list; a list without a positive whole number there is unusable. */
function maxInputLength(lists: BlockedTermLists): number {
  const max = lists.max_input_length;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
    throw new TypeError('Blocked-terms list: max_input_length is missing or not a positive whole number');
  }
  return max;
}

/**
 * Does `text` have more than `max` Unicode code points? Linear and bounded: at most `max` UTF-16
 * units cannot, more than 2 * max units must, in between the code points are counted (stopping
 * at max + 1). Code points, as in server/src/blocked-terms.js and Laravel's mb_strlen.
 */
export function exceedsMaxInput(text: string, max: number): boolean {
  if (text.length <= max) return false;
  if (text.length > 2 * max) return true;
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
    if (count > max) return true;
  }
  return false;
}

/**
 * Enthaelt `text` einen gesperrten Begriff? Liefert den ersten Treffer in
 * Listen-Reihenfolge – oder null.
 *
 * Input longer than `max_input_length` code points is a hit of kind 'length' before anything
 * else runs (fail closed; same rule and order as the server, see server/src/blocked-terms.js).
 */
export function findBlockedTerm(
  text: string | null | undefined,
  lists: BlockedTermLists,
  mode: BlockedTermMode,
): BlockedTermHit | null {
  if (!BLOCKED_TERM_MODES.includes(mode)) {
    throw new TypeError(`Unbekannter Pruefmodus: ${String(mode)}`);
  }
  if (typeof text !== 'string') return null;
  if (exceedsMaxInput(text, maxInputLength(lists))) return { term: '', group: 'max_input_length', kind: 'length' };
  if (text.trim() === '') return null;

  const compiled = compile(lists);
  const { chunks, tokens } = analyseWith(text, compiled.table);
  const chunkLineAll = chunks.join(LINE_SEPARATOR);
  const tokenLineAll = tokens.join(LINE_SEPARATOR);
  const spanCache = new Map<string, [number, number][]>();

  for (const group of compiled.groups) {
    if (!group.modes.includes(mode)) continue;
    for (const term of group.terms) {
      const hit =
        (term.inChunks !== null && hasUncoveredHit(term.inChunks, chunkLineAll, compiled.allow, spanCache)) ||
        (term.inTokens !== null && hasUncoveredHit(term.inTokens, tokenLineAll, compiled.allow, spanCache));
      if (hit) return { term: term.term, group: group.id, kind: term.kind };
    }
  }
  return null;
}

/**
 * Meldung fuer ein Formularfeld: der Satz, den auch der Server schickt – oder
 * null, wenn der Wert in Ordnung ist (oder leer; ob ein Feld Pflicht ist,
 * entscheidet das Formular).
 */
export function blockedTermMessageFor(
  value: string | null | undefined,
  lists: BlockedTermLists,
  mode: BlockedTermMode,
): string | null {
  return findBlockedTerm(value, lists, mode) ? lists.messages[mode] : null;
}
