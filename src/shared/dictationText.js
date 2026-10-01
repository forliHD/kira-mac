// Quelle: kira/dashboard/src/lib/dictationText.js, Stand 3.296.1 — per scripts/sync-shared.sh aktualisieren.
// Nicht von Hand ändern: Diktierbefehle müssen in Dashboard und Mac-App identisch sein.

// Diktat 2.0 (P1 des Plans „Diktat, Transkripte & Sprechererkennung“) — reine
// Textlogik ohne Browser-APIs, damit vitest sie ohne Mikrofon prüft:
//
//   applyDictationCommands  Diktierbefehle („Punkt“, „neuer Absatz“, „das löschen“)
//   joinDictation           Leerzeichen-Logik beim Anhängen einer Äußerung
//   insertAtCaret           Einfügen an der Cursorposition eines Textfelds
//   removeInsertion         Rückgängig der letzten Äußerung
//   isSilenceHallucination  Whisper-Phantomsätze bei Stille (Sprachmodus-Lehre)

// ── Diktierbefehle ───────────────────────────────────────────────────────────
// Bewusst konservativ: nur ganze Befehlswörter, nicht nach Artikeln („der
// Punkt ist …“ bleibt Text). Whisper setzt normale Satzzeichen selbst — die
// Befehle sind für Diktierende, die sie gewohnt sind (Apple, Dragon).

const PUNCT = new Map([
  ["punkt", "."],
  ["komma", ","],
  ["fragezeichen", "?"],
  ["ausrufezeichen", "!"],
  ["doppelpunkt", ":"],
  ["semikolon", ";"],
  ["strichpunkt", ";"],
  ["auslassungspunkte", "…"],
]);

const DASH = new Map([
  ["bindestrich", "-"],
  ["gedankenstrich", "–"],
]);

const STRUCT = new Map([
  ["neue zeile", "\n"],
  ["neuen zeile", "\n"],
  ["neuer zeile", "\n"],
  ["zeilenumbruch", "\n"],
  ["neuer absatz", "\n\n"],
  ["neue absatz", "\n\n"],
  ["neuen absatz", "\n\n"],
  ["absatz", "\n\n"],
  ["aufzählung", "\n- "],
  ["neuer punkt", "\n- "],
  ["spiegelstrich", "\n- "],
]);

const OPEN = new Map([
  ["anführungszeichen auf", "„"],
  ["anführungszeichen unten", "„"],
  ["klammer auf", "("],
]);

const CLOSE = new Map([
  ["anführungszeichen zu", "“"],
  ["anführungszeichen oben", "“"],
  ["anführungszeichen ende", "“"],
  ["klammer zu", ")"],
]);

const UNDO = /^(das\s+löschen|löschen|rückgängig|zurück|streichen)$/i;

// Vor diesen Wörtern ist „Punkt“/„Komma“ ein Hauptwort, kein Befehl.
const ARTICLES = new Set([
  "der", "die", "das", "des", "dem", "den", "ein", "eine", "einen", "einem", "einer", "eines",
  "kein", "keine", "keinen", "keinem", "keiner", "dieser", "diese", "dieses", "diesen", "diesem",
  "jeder", "jede", "jedes", "jeden", "jedem", "zum", "zur", "am", "im", "vom", "beim", "ans", "ins",
  "mein", "meine", "meinen", "meinem", "dein", "deine", "sein", "seine", "ihr", "ihre", "unser", "unsere",
  "welcher", "welche", "welches", "wichtiger", "wichtigen", "letzter", "letzten", "erster", "ersten", "zweiter", "zweiten",
]);

const SENTENCE_END = /[.!?…]$/;
// „neue Absatz“, „neuen Zeile“: Whisper hört „neuer“ oft als „neue“ — das Adjektiv
// vor einem Strukturbefehl gehört zum Befehl, nicht in den Text.
const STRUCT_ADJ = new Set(["neue", "neuer", "neuen", "neu"]);

function stripPunct(word) {
  return word.replace(/^[„“"'(]+|[.,;:!?…“")]+$/g, "");
}

function capitalize(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * Wendet Diktierbefehle auf eine erkannte Äußerung an.
 * Rückgabe: { text, op } — op ist "undo", wenn die Äußerung nur ein
 * Rückgängig-Befehl war (dann ist text leer).
 */
export function applyDictationCommands(raw, { enabled = true } = {}) {
  const text = (raw || "").trim();
  if (!text) return { text: "", op: null };
  if (!enabled) return { text, op: null };
  if (UNDO.test(stripPunct(text))) return { text: "", op: "undo" };

  const lower = stripPunct(text).toLowerCase();
  if (STRUCT.has(lower)) return { text: STRUCT.get(lower), op: null };

  const words = text.split(/\s+/);
  const out = []; // Ausgabe-Token: Wörter, Satzzeichen hängen am Vorgänger
  let pendingOpen = ""; // öffnendes Zeichen, das ans nächste Wort gehört
  let capitalizeNext = false;
  let glueNext = false; // nach „Bindestrich“: nächstes Wort ohne Leerzeichen anhängen
  let i = 0;
  while (i < words.length) {
    const w1 = stripPunct(words[i]).toLowerCase();
    const w2 = i + 1 < words.length ? `${w1} ${stripPunct(words[i + 1]).toLowerCase()}` : "";
    const prevWord = i > 0 ? stripPunct(words[i - 1]).toLowerCase() : "";
    const afterArticle = ARTICLES.has(prevWord);

    // Zwei-Wort-Befehle zuerst (öffnen/schließen/Struktur).
    if (w2 && OPEN.has(w2)) {
      pendingOpen += OPEN.get(w2);
      i += 2;
      continue;
    }
    if (w2 && CLOSE.has(w2)) {
      if (out.length) out[out.length - 1] += CLOSE.get(w2);
      else pendingOpen += CLOSE.get(w2);
      i += 2;
      continue;
    }
    if (w2 && STRUCT.has(w2)) {
      out.push(STRUCT.get(w2));
      capitalizeNext = true;
      i += 2;
      continue;
    }
    if (STRUCT.has(w1) && !afterArticle) {
      if (out.length && STRUCT_ADJ.has(stripPunct(out[out.length - 1]).toLowerCase())) out.pop();
      out.push(STRUCT.get(w1));
      capitalizeNext = true;
      i += 1;
      continue;
    }
    if (PUNCT.has(w1) && !afterArticle && out.length) {
      const mark = PUNCT.get(w1);
      out[out.length - 1] = out[out.length - 1].replace(/[.,;:!?…]+$/, "") + mark;
      capitalizeNext = SENTENCE_END.test(mark);
      i += 1;
      continue;
    }
    if (DASH.has(w1) && !afterArticle && out.length) {
      if (w1 === "bindestrich") {
        // „E Bindestrich Mail“ → „E-Mail“: hängt ohne Leerzeichen an beiden Seiten.
        out[out.length - 1] += "-";
        glueNext = true;
      } else {
        out.push(DASH.get(w1));
      }
      i += 1;
      continue;
    }

    let word = words[i];
    if (capitalizeNext) {
      word = capitalize(word);
      capitalizeNext = false;
    }
    if (pendingOpen) {
      word = pendingOpen + word;
      pendingOpen = "";
    }
    if (glueNext && out.length) {
      out[out.length - 1] += word;
      glueNext = false;
    } else {
      out.push(word);
    }
    i += 1;
  }
  if (pendingOpen) out.push(pendingOpen);

  // Zusammensetzen: Struktur-Token schließen ohne Leerzeichen an, alles
  // andere mit genau einem.
  let result = "";
  for (const tok of out) {
    if (!result) result = tok;
    else if (tok.startsWith("\n")) result = result.replace(/ $/, "") + tok;
    else if (result.endsWith("\n") || result.endsWith("- ")) result += tok;
    else result += ` ${tok}`;
  }
  return { text: result, op: null };
}

// ── Anhängen / Einfügen ──────────────────────────────────────────────────────

const NO_SPACE_BEFORE = /^[,.;:!?…)“]/;
const NO_SPACE_AFTER = /[\s\n(„]$/;

/** Hängt eine Äußerung an vorhandenen Text an — mit genau einem Leerzeichen, wo eins hingehört. */
export function joinDictation(prev, next) {
  const add = (next || "").replace(/^[ \t]+/, ""); // Zeilenumbrüche bleiben
  if (!add) return prev || "";
  if (!prev) return add;
  if (add.startsWith("\n")) return prev.replace(/[ \t]+$/, "") + add;
  if (NO_SPACE_AFTER.test(prev) || NO_SPACE_BEFORE.test(add)) return prev + add;
  return `${prev} ${add}`;
}

/**
 * Fügt ``text`` an der Cursorposition (selStart..selEnd ersetzt) ein.
 * Rückgabe: { value, caret, range } — range ist der eingefügte Bereich für
 * das Rückgängig der letzten Äußerung.
 */
export function insertAtCaret(value, selStart, selEnd, text) {
  const v = value || "";
  const start = Math.max(0, Math.min(selStart ?? v.length, v.length));
  const end = Math.max(start, Math.min(selEnd ?? start, v.length));
  const before = v.slice(0, start);
  const after = v.slice(end);
  const joined = joinDictation(before, text);
  if (joined === before) return { value: v, caret: end, range: null };
  const inserted = joined.slice(before.length);
  const needsGap = after && !/^\s/.test(after) && !/\s$/.test(inserted) && !NO_SPACE_BEFORE.test(after);
  return {
    value: joined + (needsGap ? " " : "") + after,
    caret: joined.length,
    range: { start: before.length, end: joined.length, text: inserted },
  };
}

/** Entfernt die zuletzt eingefügte Äußerung, wenn sie noch unverändert dort steht. */
export function removeInsertion(value, range) {
  if (!range) return null;
  const v = value || "";
  if (v.slice(range.start, range.end) !== range.text) return null;
  let head = v.slice(0, range.start);
  let tail = v.slice(range.end);
  // Ein Trenn-Leerzeichen, das nur wegen der Einfügung entstand, geht mit.
  if (tail.startsWith(" ") && (head === "" || /\s$/.test(head))) tail = tail.slice(1);
  return { value: head + tail, caret: head.length };
}

// ── Whisper-Phantome bei Stille ──────────────────────────────────────────────
// Bekannte Halluzinationen aus dem Sprachmodus (FALLE 2 im Voice-Chat-Plan).
// Nur verwerfen, wenn kaum Sprache gemessen wurde — ein echtes „Vielen Dank.“
// nach 2 s Sprechen bleibt (Owner-QA v3.115.1).
const HALLUCINATIONS = [
  /^untertitel(ung)? (der|von|im auftrag) /i,
  /amara\.org/i,
  /^vielen dank( für.*)?[.!]?$/i,
  /^(danke|tschüss|bis zum nächsten mal)[.!]?$/i,
  /^untertitel/i,
  /^copyright/i,
  /^musik$/i,
  /^\[.*\]$/,
  /^\(.*\)$/,
];

export function isSilenceHallucination(text, spokenMs = 0) {
  const t = (text || "").trim();
  if (!t) return true;
  if (spokenMs >= 400) return false;
  return HALLUCINATIONS.some((re) => re.test(t));
}
