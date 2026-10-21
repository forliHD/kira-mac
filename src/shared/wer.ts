// Wortfehlerrate (WER) für den Diktat-Test (Plan 21.10.2026, M6): Vorlage
// gegen Erkanntes, nach einer milden Normalisierung (Kleinschreibung, ß → ss,
// Satzzeichen weg). Reine Funktionen, keine Abhängigkeiten
// (tests/wer.test.ts).

export interface WerResult {
  /** Wörter der Vorlage. */
  words: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  /** (S + I + D) / Wörter, 0 … (mehr als 1 ist möglich). */
  wer: number;
}

/** Wörter zum Vergleichen: klein, ß → ss, Apostrophe weg, Satzzeichen als Trenner. */
export function werTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[’'`´]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Levenshtein auf Wortebene mit Rückverfolgung, damit Ersetzungen,
 * Einfügungen und Löschungen getrennt gezählt werden.
 */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = werTokens(reference);
  const hyp = werTokens(hypothesis);
  const n = ref.length;
  const m = hyp.length;
  // d[i][j] = Kosten, ref[0..i) nach hyp[0..j) zu wandeln.
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) (d[i] as number[])[0] = i;
  for (let j = 0; j <= m; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      (d[i] as number[])[j] = Math.min((d[i - 1]?.[j] ?? 0) + 1, (d[i]?.[j - 1] ?? 0) + 1, (d[i - 1]?.[j - 1] ?? 0) + cost);
    }
  }
  let i = n;
  let j = m;
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  while (i > 0 || j > 0) {
    const here = d[i]?.[j] ?? 0;
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && here === (d[i - 1]?.[j - 1] ?? 0)) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && here === (d[i - 1]?.[j - 1] ?? 0) + 1) {
      substitutions++;
      i--;
      j--;
    } else if (j > 0 && here === (d[i]?.[j - 1] ?? 0) + 1) {
      insertions++;
      j--;
    } else {
      deletions++;
      i--;
    }
  }
  const errors = substitutions + insertions + deletions;
  return { words: n, substitutions, insertions, deletions, wer: n === 0 ? (m === 0 ? 0 : 1) : errors / n };
}

export interface TermHits {
  /** Vorkommen der Begriffe in der Vorlage. */
  total: number;
  /** Davon im Erkannten wiedergefunden. */
  hit: number;
}

function countPhrase(haystack: string, phrase: string): number {
  if (!phrase) return 0;
  let count = 0;
  let from = 0;
  const needle = ` ${phrase} `;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length - 1;
  }
}

/** Wie viele Begriffe der Vorlage im Erkannten stehen (ganze Wörter, normalisiert). */
export function termHits(reference: string, hypothesis: string, terms: readonly string[]): TermHits {
  const ref = ` ${werTokens(reference).join(" ")} `;
  const hyp = ` ${werTokens(hypothesis).join(" ")} `;
  let total = 0;
  let hit = 0;
  const seen = new Set<string>();
  for (const term of terms) {
    const phrase = werTokens(term).join(" ");
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    const inRef = countPhrase(ref, phrase);
    if (inRef === 0) continue;
    total += inRef;
    hit += Math.min(inRef, countPhrase(hyp, phrase));
  }
  return { total, hit };
}
