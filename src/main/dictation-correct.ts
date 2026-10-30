// Nachkorrektur gegen den Wortschatz (Plan 21.10.2026, M2).
//
// Die Hülle gibt KIRA, den Anzeigenamen und die „Eigenen Begriffe“ als
// `contextualStrings` an den Helfer – der `SpeechTranscriber` (macOS 26+)
// wertet sie laut Apple aber nicht aus (Entwicklerforum 801877, Apple_Agent
// 09/2025: „SpeechTranscriber does not support this.“). Darum korrigiert die
// Hülle jedes fertige Stück selbst: ein Wort, das einem Begriff zum
// Verwechseln ähnlich klingt („Tira“ → KIRA, „Lugas“ → Lucas), wird zum
// Begriff – vorsichtig: häufige deutsche Wörter bleiben, zwei gleich gute
// Begriffe heben sich auf, Zahlen bleiben. Reine Funktionen, kein Electron
// (tests/dictation-correct.test.ts).

export interface CorrectionResult {
  text: string;
  /** Wie viele Wörter oder Wortgruppen ersetzt wurden (fürs Protokoll – nie der Text). */
  replacements: number;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/**
 * Häufige deutsche Wörter, die nie zu einem Begriff werden – auch wenn sie
 * einem Namen ähneln („weder“ ≠ Weber, „Kita“ bleibt, „oder“ bleibt).
 */
const COMMON_WORDS = new Set(
  `der die das den dem des ein eine einen einem einer eines und oder aber doch denn weil dass ob wenn als wie wo wohin woher wann warum wieso weshalb wer wen wem wessen was welche welcher welches
  ich du er sie es wir ihr mich dich sich uns euch mir dir ihm ihnen mein meine meinen meiner meinem dein deine deinen sein seine seinen seiner seinem unser unsere unseren eure euer
  nicht auch noch schon nur sehr viel viele wenig weniger mehr alle alles nichts etwas jemand niemand jeder jede jedes dies diese dieser dieses jene jener solche solcher
  ist sind war waren bin bist wird werden wurde wurden worden hat haben hatte hatten habe hast kann können konnte könnte muss müssen musste soll sollen sollte will wollen wollte darf dürfen durfte mag möchte möchten
  machen macht gemacht mache geht gehen ging gegangen kommt kommen kam gekommen sagen sagt sagte gesagt sehen sieht sah gesehen geben gibt gab gegeben nehmen nimmt nahm genommen finden findet fand gefunden
  denken denkt dachte gedacht glauben glaubt wissen weiß wusste brauchen braucht schicken schickt senden sendet schreiben schreibt schrieb lesen liest prüfen prüft fragen fragt bitten bittet
  treffen trifft holen holt bringen bringt lassen lässt stellen stellt legen legt setzen setzt zeigen zeigt öffnen öffnet schließen schließt starten startet löschen löscht speichern speichert suchen sucht
  warten wartet arbeiten arbeitet bleiben bleibt bleib heißen heißt heiße stehen steht stand liegen liegt lag laufen läuft lief fahren fährt fuhr halten hält hielt leben lebt wohnen wohnt spielen spielt
  gut gute guten gutes besser beste schlecht neu neue neuen neues alt alte alten groß große großen klein kleine kleinen lang lange langen kurz kurze schnell langsam früh spät später richtig falsch wichtig wichtige
  ganz ganze ganzen klar genau etwa fast kaum leider vielleicht wahrscheinlich sicher natürlich eigentlich einfach wirklich trotzdem deshalb daher darum also dann damit sonst immer nie wieder weder lieber gern gerne bitte danke hallo
  heute morgen gestern jetzt gleich bald eben gerade sofort vorher nachher zuerst zuletzt dabei davon dazu darauf daran darin dafür dagegen darüber darunter hier da dort oben unten links rechts vorne hinten innen außen draußen drinnen weg
  ja nein okay mal bis seit vor nach während zwischen gegen ohne mit bei zu zum zur von vom aus an am auf in im ins um für durch über unter hinter neben trotz wegen statt ab außer laut per pro
  zeit jahr jahre woche wochen monat monate tag tage stunde stunden minute minuten uhr ende anfang mitte sache sachen ding dinge frage fragen antwort termin termine mail mails nachricht text datei ordner liste punkt komma zeile absatz satz wort wörter name namen
  firma kunde kunden projekt projekte angebot rechnung vertrag preis euro prozent nummer zahl zahlen seite stelle haus stadt land welt leute mensch menschen frau herr herrn kind kinder team chef kollege kollegen kollegin
  montag dienstag mittwoch donnerstag freitag samstag sonntag januar februar märz april mai juni juli august september oktober november dezember
  weiter zurück rein raus hoch runter los her hin fertig offen zu auf aus an ab
  kita kino kilo lira mira reise reisen reiter leiter leiser meter liter later kurs kurse kasse klasse tasse masse mitte bitte sitte`
    .split(/\s+/)
    .filter(Boolean),
);

/** Lautschlüssel fürs Deutsche: ähnlich Klingendes bekommt denselben Schlüssel. */
export function phoneticKey(word: string): string {
  let s = word.toLowerCase();
  s = s.replace(/äu|eu/g, "oi").replace(/ei|ai|ey|ay/g, "ai");
  s = s.replace(/ä|ae/g, "e").replace(/ö|oe/g, "o").replace(/ü|ue/g, "u").replace(/ß/g, "s");
  s = s.replace(/sch/g, "s").replace(/ch/g, "x").replace(/ph/g, "f").replace(/th/g, "t").replace(/ck/g, "k").replace(/qu/g, "kv");
  s = s.replace(/tz|ts|z/g, "s").replace(/x/g, "ks").replace(/c/g, "k");
  s = s.replace(/[bp]/g, "p").replace(/[dt]/g, "t").replace(/[gk]/g, "k").replace(/[vw]/g, "f");
  s = s.replace(/ie/g, "i").replace(/y/g, "i");
  // Dehnungs-h im Wortinneren („Mahler“ → „maler“), am Anfang bleibt es.
  s = s.slice(0, 1) + s.slice(1).replace(/h/g, "");
  return s.replace(/(.)\1+/g, "$1");
}

/** Levenshtein-Abstand, früh beendet, sobald `max` überschritten ist (liefert dann max + 1). */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/** Erlaubte Tippfehler-Distanz je Begriffslänge: kurze Begriffe nur exakt oder lautgleich. */
export function maxDistance(termLength: number): number {
  if (termLength < 4) return 0;
  if (termLength < 8) return 1;
  return 2;
}

/** 0 = gleich (bis auf Groß/Klein), 1 = lautgleich, 2 = kleiner Tippfehler, null = kein Treffer. */
export function matchLevel(token: string, termWord: string, termKey: string = phoneticKey(termWord)): 0 | 1 | 2 | null {
  const lower = token.toLowerCase();
  const term = termWord.toLowerCase();
  if (lower === term) return 0;
  if (/^[\p{N}]+$/u.test(token) || lower.length < 3 || term.length < 3) return null;
  if (COMMON_WORDS.has(lower)) return null;
  const distance = editDistance(lower, term, 3);
  if (distance <= 3 && phoneticKey(token) === termKey) return 1;
  if (distance <= maxDistance(term.length) && Math.abs(lower.length - term.length) <= 2) return 2;
  return null;
}

interface TermEntry {
  text: string;
  words: string[];
  keys: string[];
}

export interface TermIndex {
  /** Mehrwortbegriffe, längste zuerst. */
  multi: TermEntry[];
  single: TermEntry[];
}

function entry(text: string): TermEntry | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return { text: words.join(" "), words, keys: words.map((w) => phoneticKey(w)) };
}

/** Begriffe vorbereiten; Wörter aus Mehrwortbegriffen zählen ab 4 Zeichen auch einzeln („Lucas Reiser“ → „Reiser“). */
export function buildTermIndex(terms: readonly string[]): TermIndex {
  const multi: TermEntry[] = [];
  const single = new Map<string, TermEntry>();
  const addSingle = (word: string): void => {
    const e = entry(word);
    if (!e) return;
    const key = e.text.toLowerCase();
    if (!single.has(key)) single.set(key, e);
  };
  for (const raw of terms) {
    const e = entry(raw);
    if (!e) continue;
    if (e.words.length === 1) {
      addSingle(e.text);
      continue;
    }
    multi.push(e);
    for (const word of e.words) {
      if (word.length >= 4 && !COMMON_WORDS.has(word.toLowerCase())) addSingle(word);
    }
  }
  multi.sort((a, b) => b.words.length - a.words.length);
  return { multi, single: [...single.values()] };
}

interface Token {
  start: number;
  end: number;
  text: string;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

/** Beste Übereinstimmung eines Tokens unter den Einzelbegriffen; bei Gleichstand zweier Begriffe null. */
function bestSingle(token: string, index: TermIndex): TermEntry | null {
  let best: { entry: TermEntry; level: number; distance: number } | null = null;
  let tie = false;
  for (const e of index.single) {
    const word = e.words[0];
    const key = e.keys[0];
    if (word === undefined || key === undefined) continue;
    const level = matchLevel(token, word, key);
    if (level === null) continue;
    const distance = editDistance(token.toLowerCase(), word.toLowerCase(), 3);
    if (!best || level < best.level || (level === best.level && distance < best.distance)) {
      best = { entry: e, level, distance };
      tie = false;
    } else if (level === best.level && distance === best.distance && e.text.toLowerCase() !== best.entry.text.toLowerCase()) {
      tie = true;
    }
  }
  return best && !tie ? best.entry : null;
}

/**
 * Korrigiert `text` gegen `terms`. Satzzeichen und Abstände bleiben; nur die
 * Wörter selbst ändern sich. Ein Begriff, der schon richtig dasteht, zählt
 * nicht als Ersetzung.
 */
export interface CorrectionOptions {
  /**
   * Wörter (klein), die das Systemwörterbuch kennt: Sie werden bei
   * Tippfehler-Treffern (Stufe 2) nie ersetzt – „Kita“ bleibt, auch wenn KIRA
   * nur einen Buchstaben entfernt ist. Lautgleiche Treffer (Stufe 1) wie
   * „Lukas“ → Lucas bleiben erlaubt. Ohne Liste gilt nur die eingebaute
   * Sperrliste häufiger Wörter.
   */
  knownWords?: ReadonlySet<string>;
}

/** Wörter, die eine Korrektur nur über einen Tippfehler-Treffer (Stufe 2) ersetzen würde – zum Nachschlagen im Wörterbuch. */
export function candidateWords(text: string, terms: readonly string[] | TermIndex): string[] {
  const index = Array.isArray(terms) ? buildTermIndex(terms) : (terms as TermIndex);
  const out = new Set<string>();
  for (const token of tokenize(text)) {
    const best = bestSingle(token.text, index);
    if (best && bestLevel(token.text, best) === 2) out.add(token.text);
    for (const e of index.multi) {
      for (let k = 0; k < e.words.length; k++) {
        const word = e.words[k];
        const key = e.keys[k];
        if (word !== undefined && key !== undefined && matchLevel(token.text, word, key) === 2) out.add(token.text);
      }
    }
  }
  return [...out];
}

function bestLevel(token: string, e: TermEntry): 0 | 1 | 2 | null {
  const word = e.words[0];
  const key = e.keys[0];
  if (word === undefined || key === undefined) return null;
  return matchLevel(token, word, key);
}

export function correctWithVocabulary(text: string, terms: readonly string[] | TermIndex, options: CorrectionOptions = {}): CorrectionResult {
  const index = Array.isArray(terms) ? buildTermIndex(terms) : (terms as TermIndex);
  if (!text || (index.multi.length === 0 && index.single.length === 0)) return { text, replacements: 0 };
  const tokens = tokenize(text);
  if (tokens.length === 0) return { text, replacements: 0 };
  const known = options.knownWords;
  /** Stufe-2-Treffer eines bekannten Worts zählen nicht. */
  const level = (token: string, word: string, key: string): 0 | 1 | 2 | null => {
    const l = matchLevel(token, word, key);
    if (l === 2 && known?.has(token.toLowerCase())) return null;
    return l;
  };

  let out = "";
  let cursor = 0;
  let replacements = 0;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) break;
    let consumed = 0;
    let replacement: string | null = null;

    for (const e of index.multi) {
      const n = e.words.length;
      if (i + n > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        const t = tokens[i + k];
        const prev = tokens[i + k - 1];
        const word = e.words[k];
        const key = e.keys[k];
        if (!t || word === undefined || key === undefined) {
          ok = false;
          break;
        }
        if (k > 0 && prev && !/^\s+$/.test(text.slice(prev.end, t.start))) ok = false;
        else if (level(t.text, word, key) === null) ok = false;
      }
      if (ok) {
        consumed = n;
        replacement = e.text;
        break;
      }
    }
    if (consumed === 0) {
      const e = bestSingle(token.text, index);
      if (e && bestLevel(token.text, e) !== null && !(bestLevel(token.text, e) === 2 && known?.has(token.text.toLowerCase()))) {
        consumed = 1;
        replacement = e.text;
      }
    }
    if (consumed === 0 || replacement === null) {
      i++;
      continue;
    }
    const last = tokens[i + consumed - 1] ?? token;
    const original = text.slice(token.start, last.end);
    out += text.slice(cursor, token.start) + replacement;
    cursor = last.end;
    if (original !== replacement) replacements++;
    i += consumed;
  }
  out += text.slice(cursor);
  return { text: out, replacements };
}
