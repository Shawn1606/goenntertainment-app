/**
 * Gesperrte Begriffe in Namen, Benutzernamen und Texten – die deterministische
 * erste Stufe vor der KI-Moderation.
 *
 * ## Warum es diese Stufe braucht, obwohl es die KI gibt
 *
 * Die KI-Moderation (src/moderation.js) ist ohne ANTHROPIC_API_KEY aus und laesst
 * bei einem Ausfall alles durch (MODERATION_FAIL_OPEN). Sie prueft ausserdem nur
 * Inhalte, keine Benutzernamen. Diese Liste greift IMMER – ohne Netz, ohne
 * Schluessel, in Mikrosekunden – und sie greift ueberall gleich: Die App prueft
 * damit schon beim Tippen, Laravel bei Registrierung und Profil, Node bei allem
 * anderen. Alle drei lesen dieselbe Datei (shared/blocked-terms.json) und rechnen
 * nach derselben Vorschrift; shared/blocked-terms.fixtures.json haelt sie
 * gegeneinander. Wer hier etwas an der Vorschrift aendert, aendert sie auch in
 * src/domain/blocked-terms.ts und api/app/Support/BlockedTerms.php.
 *
 * ## Die Vorschrift
 *
 * 1. **Vorbereiten:** NFKD (zerlegt Akzente, macht aus 𝐅𝐔𝐂𝐊, ⓕⓤⓒⓚ und Hochzahlen
 *    normale Zeichen), Vollbreite (ＦＵＣＫ) zu ASCII, Kleinschreibung.
 * 2. **Falten**, zwei Varianten: einmal ä→ae, ö→oe, ü→ue, einmal ä→a, ö→o, ü→u.
 *    Beide werden geprueft – „Kümmeltürke" ist geschrieben „kuemmeltuerke" wie
 *    „kummelturke". Danach die Zeichentabelle (ß→ss, kyrillisches а/о/е/с/р →
 *    lateinisch, Kapitaelchen, unsichtbare Zeichen weg) und alle kombinierenden
 *    Zeichen weg.
 * 3. **Leetspeak**, zusaetzlich zu jeder gefalteten Variante: In jedem Stueck aus
 *    Buchstaben, Ziffern und Leet-Zeichen, das mindestens einen Buchstaben hat,
 *    wird 0→o, 1→i (bzw. l), 3→e, 4→a, 5→s, 7→t, 9→g, @→a, $→s, €→e, !→i; andere
 *    Ziffern fallen weg („ni2gger"). Reine Zahlen bleiben Zahlen – sonst wuerde
 *    aus „Bus 455" ein Schimpfwort. Zweimal gerechnet: einmal alles, einmal nur
 *    INNEN (Ziffern am Rand werden zum Trenner), denn „wichser2008" ist ein
 *    Wort mit Jahreszahl und „ana1" ist kein „anal".
 * 4. **Zerlegen:** „Stuecke" sind die Teile zwischen Leerzeichen, von allem ausser
 *    a-z/0-9 befreit („n.i.g.g.e.r" → ein Stueck). „Woerter" sind Buchstaben- bzw.
 *    Ziffernfolgen, zusaetzlich an camelCase-Grenzen getrennt („FickDich").
 *    Drei und mehr einzelne Buchstaben hintereinander werden zu einem Stueck bzw.
 *    Wort zusammengezogen („F U C K").
 * 5. **Vergleichen:** `substring` sucht in den Stuecken, `prefix` am Wortanfang,
 *    `word` nur ganze Woerter; Wortfolgen („sieg heil") auch ueber Wortgrenzen und
 *    zusammengeschrieben. Buchstaben-Wiederholungen: Jeder Buchstabe des Begriffs
 *    darf beliebig oft stehen, ein doppelter aber nicht seltener als doppelt –
 *    „niiiggger" trifft „nigger", „Niger" nicht.
 * 6. **Ausnahmen:** Liegt ein Treffer ganz innerhalb eines `allow`-Wortes
 *    („Scunthorpe", „Pussycat"), zaehlt er nicht.
 *
 * Die Begriffe selbst werden nach Schritt 1–2 (erste Variante, ohne Leet)
 * normalisiert, damit Liste und Eingabe dieselbe Sprache sprechen.
 *
 * ## Was eine Wortliste grundsaetzlich nicht kann
 *
 * Sie erkennt keine Bedeutung: „Ich bring dich um" oder eine Beleidigung aus
 * lauter harmlosen Woertern gehen durch – das ist die Aufgabe der KI. Und jede
 * Liste ist ein Kompromiss zwischen Durchlass und Fehlalarm; wo die Grenze liegt,
 * steht an den Gruppen in shared/blocked-terms.json.
 */
import fs from 'node:fs';

export const BLOCKED_TERM_MODES = ['username', 'name', 'text'];

/**
 * Die Liste liegt ausserhalb von server/ (shared/ im Repo), weil App und Laravel
 * sie ebenfalls lesen – eine Kopie je Stelle liefe auseinander. Im Docker-Abbild
 * liegt sie unter /shared (siehe server/Dockerfile), also wieder zwei Ebenen ueber
 * dieser Datei.
 *
 * Fehlt sie, startet der Server NICHT. Das ist Absicht: Diese Stufe soll immer
 * greifen, und ein Server, der stillschweigend ohne sie laeuft, faellt erst auf,
 * wenn die Beleidigung schon im Profil steht.
 */
function loadDefaultLists() {
  const file = process.env.BLOCKED_TERMS_FILE
    ? process.env.BLOCKED_TERMS_FILE
    : new URL('../../shared/blocked-terms.json', import.meta.url);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const BLOCKED_TERMS = loadDefaultLists();

// --- Normalisierung ----------------------------------------------------------

const COMBINING_FROM = 0x300;
const COMBINING_TO = 0x36f;

/** Schritt 1: NFKD, Vollbreite, Kleinschreibung. */
function prepare(text) {
  let s = String(text);
  try {
    s = s.normalize('NFKD');
  } catch {
    // Ohne Normalisierung (alte JS-Umgebungen) bleibt die Zeichentabelle – sie
    // kennt die gaengigen Akzentbuchstaben auch zusammengesetzt.
  }
  // Vollbreite (U+FF01–U+FF5E) → ASCII. NFKD erledigt das schon; das hier ist
  // die Absicherung fuer Umgebungen ohne NFKD, damit das Ergebnis gleich bleibt.
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return s.toLowerCase();
}

/** Schritt 2: Umlaute (nur Variante A), Zeichentabelle, kombinierende Zeichen. */
function fold(prepared, umlautVariant, table) {
  const cps = Array.from(prepared);
  let out = '';
  for (let i = 0; i < cps.length; i += 1) {
    const ch = cps[i];
    if (umlautVariant) {
      const pair = i + 1 < cps.length ? ch + cps[i + 1] : null;
      if (pair !== null && Object.hasOwn(table.umlauts, pair)) {
        out += table.umlauts[pair];
        i += 1;
        continue;
      }
      if (Object.hasOwn(table.umlauts, ch)) {
        out += table.umlauts[ch];
        continue;
      }
    }
    if (Object.hasOwn(table.chars, ch)) {
      out += table.chars[ch];
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp >= COMBINING_FROM && cp <= COMBINING_TO) continue;
    out += ch;
  }
  return out;
}

const isLetter = (ch) => ch >= 'a' && ch <= 'z';
const isDigit = (ch) => ch >= '0' && ch <= '9';

/**
 * Schritt 3: Leetspeak.
 *
 * @param oneAs 'i' oder 'l' – was aus der 1 wird („n1gger" vs. „arsch1och").
 * @param innerOnly Ziffern/Zeichen am Rand eines Stuecks werden zum Trenner statt
 *   zum Buchstaben („wichser2008" → „wichser ").
 */
function leet(folded, oneAs, innerOnly, table) {
  const cps = Array.from(folded);
  const isRunChar = (ch) => isLetter(ch) || isDigit(ch) || Object.hasOwn(table.leet, ch);
  const mapChar = (ch) => {
    if (isLetter(ch)) return ch;
    if (oneAs === 'l' && Object.hasOwn(table.leet_alt, ch)) return table.leet_alt[ch];
    if (Object.hasOwn(table.leet, ch)) return table.leet[ch];
    return ''; // Ziffern ohne Leet-Bedeutung (2, 6, 8) fallen weg
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

/** Alle Lesarten eines Textes (Schritt 1–3), ohne Doppelte, in fester Reihenfolge. */
function variants(text, table) {
  const prepared = prepare(text);
  const folds = [fold(prepared, true, table), fold(prepared, false, table)];
  const out = [];
  for (const f of folds) {
    out.push(f, leet(f, 'i', false, table), leet(f, 'i', true, table));
    out.push(leet(f, 'l', false, table), leet(f, 'l', true, table));
  }
  return [...new Set(out)];
}

/**
 * camelCase-Grenzen als Leerzeichen („FickDich" → „Fick Dich"). Auf dem
 * Originaltext, weil die Gross-/Kleinschreibung danach verloren ist.
 */
function splitCamel(text) {
  const cps = Array.from(String(text));
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

/** Drei und mehr einzelne Buchstaben in Folge → ein Eintrag („f u c k" → „fuck"). */
function mergeSingles(items) {
  const out = [];
  let run = [];
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

/**
 * Stuecke einer Lesart, per Leerzeichen verbunden.
 *
 * `\x0B` statt `\v`: In PHP (PCRE) heisst `\v` „jeder senkrechte Leerraum" und
 * faengt z. B. auch U+0085 – in JS nur den Tabulator U+000B. Ausgeschrieben
 * trennen alle drei Umsetzungen an denselben Zeichen.
 */
function chunkLine(variant) {
  const chunks = variant
    .split(/[ \t\n\r\f\x0B]+/)
    .map((chunk) => chunk.replace(/[^a-z0-9]+/g, ''))
    .filter((chunk) => chunk !== '');
  return mergeSingles(chunks).join(' ');
}

/** Woerter einer Lesart, per Leerzeichen verbunden. */
function tokenLine(variant) {
  return mergeSingles(variant.match(/[a-z]+|[0-9]+/g) ?? []).join(' ');
}

/**
 * Trenner zwischen den Lesarten in EINER Zeile. Kein Buchstabe, keine Ziffer, kein
 * Leerzeichen: Kein Begriff kann ihn ueberspannen, und eine Wortfolge endet nie
 * in der einen Lesart und geht in der naechsten weiter.
 */
const LINE_SEPARATOR = ' | ';

/**
 * Der Text in den Formen, in denen gesucht wird. Exportiert fuer Tests und zum
 * Nachvollziehen, WARUM etwas getroffen hat.
 *
 * @returns {{ chunks: string[], tokens: string[] }}
 */
export function analyseText(text, lists = BLOCKED_TERMS) {
  const table = lists.normalize;
  const raw = typeof text === 'string' ? text : '';
  const plain = variants(raw, table);
  const camel = splitCamel(raw);
  const withCamel = camel === raw ? plain : [...plain, ...variants(camel, table)];
  return {
    chunks: [...new Set(plain.map(chunkLine))],
    tokens: [...new Set(withCamel.map(tokenLine))],
  };
}

// --- Begriffe ----------------------------------------------------------------

/** Buchstabenfolge → Muster mit Wiederholungen („nigger" → n+i+g{2,}e+r+). */
function runsPattern(s) {
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

/** Begriff → seine Woerter (Schritt 1–2, erste Variante, ohne Leet). */
export function termTokens(term, table) {
  return fold(prepare(term), true, table).match(/[a-z]+|[0-9]+/g) ?? [];
}

function compileTerm(term, kind, table) {
  const tokens = termTokens(term, table);
  if (tokens.length === 0) return null;
  const sequence = tokens.map(runsPattern).join(' ?');
  const compiled = { term, kind, key: `${kind}:${tokens.join(' ')}` };
  if (kind === 'substring') {
    compiled.inChunks = new RegExp(runsPattern(tokens.join('')), 'g');
    // Wortfolgen zusaetzlich ueber Wortgrenzen: „Sieg Heil" sind zwei Stuecke.
    if (tokens.length > 1) compiled.inTokens = new RegExp(`(?:^| )${sequence}(?= |$)`, 'g');
  } else if (kind === 'prefix') {
    compiled.inTokens = new RegExp(`(?:^| )${sequence}`, 'g');
  } else {
    compiled.inTokens = new RegExp(`(?:^| )${sequence}(?= |$)`, 'g');
  }
  return compiled;
}

const compiledCache = new WeakMap();

/** Liste → vorbereitete Muster. Wird je Listen-Objekt nur einmal gebaut. */
export function compileBlockedTerms(lists) {
  const cached = compiledCache.get(lists);
  if (cached) return cached;

  const table = lists.normalize;
  const groups = (lists.groups ?? []).map((group) => {
    const seen = new Set();
    const terms = [];
    for (const kind of ['substring', 'prefix', 'word']) {
      for (const term of group[kind] ?? []) {
        const compiled = compileTerm(term, kind, table);
        if (!compiled || seen.has(compiled.key)) continue;
        seen.add(compiled.key);
        terms.push(compiled);
      }
    }
    return { id: group.id, modes: group.modes ?? [], terms };
  });
  const allow = (lists.allow ?? [])
    .map((term) => termTokens(term, table).join(''))
    .filter((squashed) => squashed !== '')
    .map((squashed) => new RegExp(runsPattern(squashed), 'g'));

  const compiled = { groups, allow };
  compiledCache.set(lists, compiled);
  return compiled;
}

/** Stellen [von, bis) in `line`, die ein allow-Wort abdeckt. */
function allowSpans(line, allow) {
  const spans = [];
  for (const re of allow) {
    for (const m of line.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/** Gibt es in `line` einen Treffer, den kein allow-Wort vollstaendig abdeckt? */
function hasUncoveredHit(re, line, allow, spanCache) {
  for (const m of line.matchAll(re)) {
    // Das fuehrende Leerzeichen der Wort-Muster gehoert nicht zum Treffer.
    const start = m.index + (m[0][0] === ' ' ? 1 : 0);
    const end = m.index + m[0].length;
    if (!spanCache.has(line)) spanCache.set(line, allowSpans(line, allow));
    const covered = spanCache.get(line).some(([from, to]) => from <= start && to >= end);
    if (!covered) return true;
  }
  return false;
}

/**
 * Enthaelt `text` einen gesperrten Begriff?
 *
 * @param {string} text
 * @param {object} lists Inhalt von shared/blocked-terms.json
 * @param {'username'|'name'|'text'} mode
 * @returns {{ term: string, group: string, kind: 'substring'|'prefix'|'word' } | null}
 *   Der erste Treffer in Listen-Reihenfolge – oder null.
 */
export function findBlockedTerm(text, lists, mode) {
  if (!BLOCKED_TERM_MODES.includes(mode)) {
    throw new TypeError(`Unbekannter Pruefmodus: ${mode}`);
  }
  if (typeof text !== 'string' || text.trim() === '') return null;

  const compiled = compileBlockedTerms(lists);
  const { chunks, tokens } = analyseText(text, lists);
  const chunkLineAll = chunks.join(LINE_SEPARATOR);
  const tokenLineAll = tokens.join(LINE_SEPARATOR);
  const spanCache = new Map();

  for (const group of compiled.groups) {
    if (!group.modes.includes(mode)) continue;
    for (const term of group.terms) {
      const hit =
        (term.inChunks && hasUncoveredHit(term.inChunks, chunkLineAll, compiled.allow, spanCache)) ||
        (term.inTokens && hasUncoveredHit(term.inTokens, tokenLineAll, compiled.allow, spanCache));
      if (hit) return { term: term.term, group: group.id, kind: term.kind };
    }
  }
  return null;
}

/** Die Meldung fuer einen Modus – dieselbe, die die App anzeigt. */
export function blockedTermMessageFor(mode, lists = BLOCKED_TERMS) {
  return lists.messages[mode];
}

/**
 * Bequem fuer die Routen: Ist `value` gesperrt, kommt die Meldung an `field` in
 * den Validator. Leere Werte und Nicht-Texte uebergeht sie – ob ein Feld Pflicht
 * ist, entscheidet die Route vorher.
 *
 * @returns {boolean} true, wenn der Wert gesperrt war.
 */
export function rejectBlockedTerms(v, field, value, mode, lists = BLOCKED_TERMS) {
  if (typeof value !== 'string' || !findBlockedTerm(value, lists, mode)) return false;
  v.add(field, blockedTermMessageFor(mode, lists));
  return true;
}
