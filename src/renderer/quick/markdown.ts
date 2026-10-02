// Kleiner, sicherer Markdown-Parser für die Antworten im Schnellfenster.
//
// Ergebnis ist ein Knotenbaum (Block/Inline), den MarkdownView.tsx als
// React-Elemente zeichnet – nie als HTML-String. Darum gilt:
//   • rohes HTML bleibt Text („<script>“ wird angezeigt, nicht ausgeführt),
//   • Links nur mit erlaubtem Ziel (http/https/mailto/tel oder ein Pfad der
//     Instanz wie „/chat“), alles andere (javascript:, data:, file:, //host …)
//     wird zu Text,
//   • Bilder werden nicht geladen (CSP), sondern als Link „Bild: …“ gezeigt.
//
// Umfang: Absätze (Zeilenumbrüche bleiben), # bis ### (#### … zählt als ###),
// Listen mit -, *, + und 1. / 1) samt Verschachtelung, Codeblöcke ``` / ~~~
// (offener Block beim Streamen läuft bis zum Ende), Zitate, Tabellen,
// Trennlinien, **fett**, *kursiv*, ~~durchgestrichen~~, `Code`, Links,
// <https://…> und nackte http(s)-Adressen. Kein Datei-, DOM- oder React-Import:
// tests/quick-markdown.test.ts prüft das Modul direkt in Node.

export type Align = "left" | "center" | "right" | null;

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  /** Bild: wird als Link „Bild: alt“ gezeigt; `href` ist null, wenn das Ziel nicht erlaubt ist. */
  | { type: "image"; href: string | null; alt: string }
  | { type: "break" };

export interface ListItem {
  blocks: Block[];
}

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "code"; lang: string | null; text: string }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; children: Block[] }
  | { type: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: "rule" };

/** Obergrenzen gegen entartete Eingaben (die Seite darf nie hängen). */
const MAX_SOURCE = 200_000;
const MAX_BLOCK_DEPTH = 5;
const MAX_INLINE_DEPTH = 6;
const MAX_LABEL_SCAN = 2_000;
const MAX_TABLE_COLUMNS = 24;

// ── Sichere Linkziele ───────────────────────────────────────────────────

/**
 * Prüft ein Linkziel und gibt es (normalisiert) zurück – oder null.
 * Erlaubt: http(s) mit Host, mailto:, tel:, Pfade der Instanz („/…“, aber
 * nicht „//host“ oder „/\host“, die Browser als fremden Host lesen).
 */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!url || url.length > 4_096) return null;
  // Steuerzeichen (auch Tab/Zeilenumbruch: „java\nscript:“) nie durchlassen.
  if (/[\u0000-\u001F\u007F]/.test(url)) return null;
  if (url.startsWith("/")) {
    if (url.startsWith("//") || url.startsWith("/\\")) return null;
    return url.replace(/ /g, "%20");
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") {
    try {
      const parsed = new URL(url.replace(/ /g, "%20"));
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
      return parsed.href;
    } catch {
      return null;
    }
  }
  if (scheme === "mailto") return /^mailto:[^\s<>"]+$/i.test(url) ? url : null;
  if (scheme === "tel") return /^tel:\+?[\d\s().-]{3,}$/i.test(url) ? url : null;
  return null;
}

// ── Blöcke ──────────────────────────────────────────────────────────────

export function parseMarkdown(source: string): Block[] {
  const text = (source.length > MAX_SOURCE ? source.slice(0, MAX_SOURCE) : source).replace(/\r\n?/g, "\n").replace(/\u0000/g, "\uFFFD");
  const lines = text.split("\n").map(expandLeadingTabs);
  return parseBlocks(lines, 0);
}

function expandLeadingTabs(line: string): string {
  if (!line.startsWith("\t") && !/^ +\t/.test(line)) return line;
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  let width = 0;
  for (const ch of lead) width = ch === "\t" ? width + 4 - (width % 4) : width + 1;
  return " ".repeat(width) + line.slice(lead.length);
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const BULLET_RE = /^( {0,3})([-*+])( {1,4}|\t)(.*)$/;
const ORDERED_RE = /^( {0,3})(\d{1,9})([.)])( {1,4}|\t)(.*)$/;

interface Fence {
  indent: number;
  char: string;
  length: number;
  lang: string | null;
}

function matchFence(line: string): Fence | null {
  const m = FENCE_RE.exec(line);
  if (!m) return null;
  const marker = m[2] ?? "";
  const info = (m[3] ?? "").trim();
  if (marker.startsWith("`") && info.includes("`")) return null;
  const lang = info.split(/\s+/)[0] ?? "";
  return { indent: (m[1] ?? "").length, char: marker[0] ?? "`", length: marker.length, lang: lang ? lang.slice(0, 32) : null };
}

interface ListMarker {
  ordered: boolean;
  indent: number;
  start: number;
  /** Einrückung des Inhalts (Markerbreite + Leerraum). */
  contentIndent: number;
  content: string;
}

function matchListMarker(line: string): ListMarker | null {
  const b = BULLET_RE.exec(line);
  if (b) {
    const indent = (b[1] ?? "").length;
    const gap = (b[3] ?? " ").length;
    return { ordered: false, indent, start: 1, contentIndent: indent + 1 + gap, content: b[4] ?? "" };
  }
  const o = ORDERED_RE.exec(line);
  if (o) {
    const indent = (o[1] ?? "").length;
    const digits = o[2] ?? "1";
    const gap = (o[4] ?? " ").length;
    return { ordered: true, indent, start: Number.parseInt(digits, 10), contentIndent: indent + digits.length + 1 + gap, content: o[5] ?? "" };
  }
  return null;
}

function tableSeparator(line: string | undefined): Align[] | null {
  if (line === undefined) return null;
  const t = line.trim();
  if (!t.includes("|") || !t.includes("-")) return null;
  if (!/^\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?$/.test(t)) return null;
  return splitRow(t).map((cell) => {
    const s = cell.trim();
    const left = s.startsWith(":");
    const right = s.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

function startsTable(lines: string[], i: number): boolean {
  const line = lines[i];
  return line !== undefined && line.includes("|") && !isBlank(line) && tableSeparator(lines[i + 1]) !== null;
}

/** Zeile beginnt einen neuen Block (unterbricht also einen Absatz). */
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  if (matchFence(line) || HEADING_RE.test(line) || RULE_RE.test(line) || QUOTE_RE.test(line)) return true;
  const marker = matchListMarker(line);
  // Wie CommonMark: eine nummerierte Liste unterbricht einen Absatz nur mit 1.
  // („1990. war ein gutes Jahr“ bleibt Text), eine Aufzählung immer.
  if (marker && marker.content.trim() && (!marker.ordered || marker.start === 1)) return true;
  return startsTable(lines, i);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  if (depth > MAX_BLOCK_DEPTH) {
    const text = lines.map((l) => l.trim()).filter(Boolean).join("\n");
    return text ? [{ type: "paragraph", children: parseInline(text) }] : [];
  }
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const body: string[] = [];
      const close = new RegExp(`^ {0,3}${fence.char === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (close.test(l)) {
          i++;
          break;
        }
        body.push(fence.indent ? l.replace(new RegExp(`^ {0,${fence.indent}}`), "") : l);
        i++;
      }
      blocks.push({ type: "code", lang: fence.lang, text: body.join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(3, (heading[1] ?? "#").length) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline((heading[2] ?? "").trim()) });
      i++;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      let lazyOk = false;
      while (i < lines.length) {
        const l = lines[i] ?? "";
        const q = QUOTE_RE.exec(l);
        if (q) {
          inner.push(q[1] ?? "");
          lazyOk = !isBlank(q[1]);
          i++;
          continue;
        }
        // „Faule“ Fortsetzung: Folgezeile ohne > setzt den Absatz im Zitat fort.
        if (lazyOk && !isBlank(l) && !startsBlock(lines, i)) {
          inner.push(l);
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner, depth + 1) });
      continue;
    }

    const marker = matchListMarker(line);
    if (marker) {
      const parsed = parseList(lines, i, marker, depth);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    if (startsTable(lines, i)) {
      const align = (tableSeparator(lines[i + 1]) ?? []).slice(0, MAX_TABLE_COLUMNS);
      const cols = align.length;
      const fit = (cells: string[]): Inline[][] => {
        const out = cells.slice(0, cols).map((c) => parseInline(c.trim()));
        while (out.length < cols) out.push([]);
        return out;
      };
      const head = fit(splitRow(line.trim()));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (isBlank(l) || !l.includes("|")) break;
        rows.push(fit(splitRow(l.trim())));
        i++;
      }
      blocks.push({ type: "table", align, head, rows });
      continue;
    }

    // Absatz: bis zur Leerzeile oder zum nächsten Block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) {
      para.push((lines[i] ?? "").trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  }
  return blocks;
}

function parseList(lines: string[], start: number, first: ListMarker, depth: number): { block: Block; next: number } {
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const marker = matchListMarker(lines[i] ?? "");
    if (!marker || marker.ordered !== first.ordered || marker.indent > first.indent + 3) break;
    const body: string[] = [marker.content];
    let lastBlank = false;
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (isBlank(l)) {
        // Leerzeile: gehört dazu, wenn danach noch eingerückter Inhalt kommt.
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        const nextLine = lines[j];
        if (nextLine !== undefined && indentOf(nextLine) > marker.indent && !siblingMarker(nextLine, marker)) {
          for (let k = i; k < j; k++) body.push("");
          i = j;
          lastBlank = true;
          continue;
        }
        break;
      }
      const indent = indentOf(l);
      if (indent >= marker.contentIndent) {
        body.push(l.slice(marker.contentIndent));
        lastBlank = false;
        i++;
        continue;
      }
      if (siblingMarker(l, marker)) break;
      if (indent > marker.indent) {
        // Zu knapp eingerückt (z. B. 2 Leerzeichen unter „1. “): trotzdem Inhalt
        // des Punkts, so schreiben Sprachmodelle verschachtelte Listen oft.
        body.push(l.slice(indent));
        lastBlank = false;
        i++;
        continue;
      }
      if (!lastBlank && !startsBlock(lines, i)) {
        body.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    items.push({ blocks: parseBlocks(body, depth + 1) });
    // Nach einer Leerzeile beendet eine nicht passende Zeile die Liste (oben).
    if (i < lines.length && isBlank(lines[i])) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      const nextMarker = matchListMarker(lines[j] ?? "");
      if (nextMarker && nextMarker.ordered === first.ordered && nextMarker.indent <= first.indent + 3) {
        i = j;
        continue;
      }
      break;
    }
  }
  return { block: { type: "list", ordered: first.ordered, start: Math.min(first.start, 1_000_000_000), items }, next: i };
}

/** Nächster Punkt derselben Liste (gleiche Art, weniger eingerückt als der Inhalt). */
function siblingMarker(line: string, current: ListMarker): boolean {
  const m = matchListMarker(line);
  return Boolean(m && m.ordered === current.ordered && indentOf(line) < current.contentIndent);
}

/** Tabellenzeile in Zellen teilen; „|“ in `Code` oder als „\|“ trennt nicht. */
function splitRow(row: string): string[] {
  let s = row;
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i] ?? "";
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 2;
      continue;
    }
    if (ch === "`") {
      const run = runLength(s, i, "`");
      const close = findBacktickClose(s, i + run, run);
      if (close >= 0) {
        cur += s.slice(i, close + run);
        i = close + run;
        continue;
      }
      cur += s.slice(i, i + run);
      i += run;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      i++;
      if (cells.length >= MAX_TABLE_COLUMNS) {
        cur = s.slice(i);
        break;
      }
      continue;
    }
    cur += ch;
    i++;
  }
  cells.push(cur);
  return cells;
}

// ── Inline ──────────────────────────────────────────────────────────────

const ESCAPABLE = new Set("\\`*_{}[]()#+-.!|~<>\"'$%&,/:;=?@^".split(""));
const BARE_URL_RE = /https?:\/\/[^\s<>"'`\u00A0]+/iy;
const AUTOLINK_RE = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/iy;
const ENTITY_RE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/y;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0" };
const PUNCT_RE = /[\p{P}\p{S}]/u;
const SPACE_RE = /\s/u;

type DelimChar = "*" | "_" | "~";

interface Delim {
  ch: DelimChar;
  count: number;
  readonly orig: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

/** Glied der doppelt verketteten Liste, auf der die Hervorhebungen aufgelöst werden. */
interface Cell {
  node: Inline | null;
  delim: Delim | null;
  prev: Cell | null;
  next: Cell | null;
  active: boolean;
}

/**
 * Inline-Markdown → Knoten. Hervorhebungen nach dem CommonMark-Verfahren
 * („process emphasis“ mit Begrenzer-Stapel), damit `**fett *kursiv***` und
 * `snake_case_namen` richtig aufgelöst werden; Laufzeit annähernd linear.
 */
export function parseInline(src: string, depth = 0, inLink = false): Inline[] {
  if (!src) return [];
  if (depth > MAX_INLINE_DEPTH) return [{ type: "text", text: src }];

  let head: Cell | null = null;
  let tail: Cell | null = null;
  const delims: Cell[] = [];
  let buf = "";

  const append = (node: Inline | null, delim: Delim | null): Cell => {
    const cell: Cell = { node, delim, prev: tail, next: null, active: true };
    if (tail) tail.next = cell;
    else head = cell;
    tail = cell;
    if (delim) delims.push(cell);
    return cell;
  };
  const flush = (): void => {
    if (buf) {
      append({ type: "text", text: buf }, null);
      buf = "";
    }
  };
  const pushNode = (node: Inline): void => {
    flush();
    append(node, null);
  };

  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i] ?? "";
    switch (ch) {
      case "\\": {
        const next = src[i + 1];
        if (next === "\n") {
          pushNode({ type: "break" });
          i += 2;
          continue;
        }
        if (next !== undefined && ESCAPABLE.has(next)) {
          buf += next;
          i += 2;
          continue;
        }
        buf += ch;
        i++;
        continue;
      }
      case "\n":
        pushNode({ type: "break" });
        i++;
        continue;
      case "`": {
        const run = runLength(src, i, "`");
        const close = findBacktickClose(src, i + run, run);
        if (close >= 0) {
          let code = src.slice(i + run, close).replace(/\n/g, " ");
          if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
          pushNode({ type: "code", text: code });
          i = close + run;
          continue;
        }
        buf += src.slice(i, i + run);
        i += run;
        continue;
      }
      case "!": {
        if (src[i + 1] === "[") {
          const link = parseLinkAt(src, i + 1);
          if (link) {
            pushNode({ type: "image", href: safeHref(link.dest), alt: plainText(parseInline(link.label, depth + 1, true)).trim() });
            i = link.end;
            continue;
          }
        }
        buf += ch;
        i++;
        continue;
      }
      case "[": {
        if (!inLink) {
          const link = parseLinkAt(src, i);
          if (link) {
            const children = parseInline(link.label, depth + 1, true);
            const href = safeHref(link.dest);
            flush();
            if (href) append({ type: "link", href, children: children.length ? children : [{ type: "text", text: href }] }, null);
            // Nicht erlaubtes Ziel (javascript:, data: …): nur der Linktext bleibt – als Text.
            else for (const child of children) append(child, null);
            i = link.end;
            continue;
          }
        }
        buf += ch;
        i++;
        continue;
      }
      case "<": {
        if (!inLink) {
          AUTOLINK_RE.lastIndex = i;
          const m = AUTOLINK_RE.exec(src);
          const href = m ? safeHref(m[1] ?? "") : null;
          if (m && href) {
            pushNode({ type: "link", href, children: [{ type: "text", text: m[1] ?? href }] });
            i += m[0].length;
            continue;
          }
        }
        buf += ch;
        i++;
        continue;
      }
      case "&": {
        ENTITY_RE.lastIndex = i;
        const m = ENTITY_RE.exec(src);
        if (m) {
          buf += decodeEntity(m);
          i += m[0].length;
          continue;
        }
        buf += ch;
        i++;
        continue;
      }
      case "*":
      case "_":
      case "~": {
        const run = runLength(src, i, ch);
        // GFM: nur ~~ (genau zwei) streicht durch; ein einzelnes ~ ist Text („~5 Min“).
        if (ch === "~" && run !== 2) {
          buf += src.slice(i, i + run);
          i += run;
          continue;
        }
        const before = i === 0 ? " " : (src[i - 1] ?? " ");
        const after = i + run >= n ? " " : (src[i + run] ?? " ");
        const { canOpen, canClose } = flanking(ch, before, after);
        if (!canOpen && !canClose) {
          buf += src.slice(i, i + run);
        } else {
          flush();
          append({ type: "text", text: src.slice(i, i + run) }, { ch, count: run, orig: run, canOpen, canClose });
        }
        i += run;
        continue;
      }
      case "h":
      case "H": {
        if (!inLink && !/[\p{L}\p{N}]/u.test(src[i - 1] ?? " ")) {
          BARE_URL_RE.lastIndex = i;
          const m = BARE_URL_RE.exec(src);
          if (m) {
            const raw = trimUrlTail(m[0]);
            const href = safeHref(raw);
            if (href) {
              pushNode({ type: "link", href, children: [{ type: "text", text: raw }] });
              i += raw.length;
              continue;
            }
          }
        }
        buf += ch;
        i++;
        continue;
      }
      default:
        buf += ch;
        i++;
    }
  }
  flush();
  processEmphasis(delims);
  return collect(head, null);
}

function flanking(ch: DelimChar, before: string, after: string): { canOpen: boolean; canClose: boolean } {
  const afterSpace = SPACE_RE.test(after);
  const beforeSpace = SPACE_RE.test(before);
  const afterPunct = PUNCT_RE.test(after);
  const beforePunct = PUNCT_RE.test(before);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  if (ch === "_") {
    // Unterstriche mitten im Wort (snake_case) sind nie Hervorhebung.
    return { canOpen: left && (!right || beforePunct), canClose: right && (!left || afterPunct) };
  }
  return { canOpen: left, canClose: right };
}

function processEmphasis(delims: Cell[]): void {
  // Untergrenzen je Art, damit erfolglose Suchen nicht wiederholt werden
  // (CommonMark „openers_bottom“) – hält die Laufzeit linear.
  const bottoms = new Map<string, number>();
  let ci = 0;
  while (ci < delims.length) {
    const closer = delims[ci];
    const cd = closer?.delim;
    if (!closer || !cd || !closer.active || !cd.canClose || cd.count === 0) {
      ci++;
      continue;
    }
    const key = `${cd.ch}${cd.canOpen ? 1 : 0}${cd.orig % 3}`;
    const bottom = bottoms.get(key) ?? -1;
    let found = -1;
    for (let oi = ci - 1; oi > bottom; oi--) {
      const opener = delims[oi];
      const od = opener?.delim;
      if (!opener || !od || !opener.active || od.ch !== cd.ch || !od.canOpen || od.count === 0) continue;
      const ruleOfThree = (od.canClose || cd.canOpen) && (od.orig + cd.orig) % 3 === 0 && !(od.orig % 3 === 0 && cd.orig % 3 === 0);
      if (ruleOfThree) continue;
      if (cd.ch === "~" && (od.count !== 2 || cd.count !== 2)) continue;
      found = oi;
      break;
    }
    if (found < 0) {
      bottoms.set(key, ci - 1);
      if (!cd.canOpen) closer.active = false;
      ci++;
      continue;
    }
    const opener = delims[found] as Cell;
    const od = opener.delim as Delim;
    const use = cd.ch === "~" ? 2 : od.count >= 2 && cd.count >= 2 ? 2 : 1;
    for (let k = found + 1; k < ci; k++) {
      const between = delims[k];
      if (between) between.active = false;
    }
    const children = collect(opener.next, closer);
    const node: Inline =
      cd.ch === "~" ? { type: "del", children } : use === 2 ? { type: "strong", children } : { type: "em", children };
    const cell: Cell = { node, delim: null, prev: opener, next: closer, active: true };
    opener.next = cell;
    closer.prev = cell;
    od.count -= use;
    cd.count -= use;
    if (od.count === 0) opener.active = false;
    if (cd.count === 0) {
      closer.active = false;
      ci++;
    }
  }
}

/** Knoten von `from` bis ausschließlich `until` einsammeln; übrige Begrenzer werden Text. */
function collect(from: Cell | null, until: Cell | null): Inline[] {
  const out: Inline[] = [];
  for (let c = from; c && c !== until; c = c.next) {
    if (c.delim) {
      if (c.delim.count > 0) pushText(out, c.delim.ch.repeat(c.delim.count));
    } else if (c.node) {
      if (c.node.type === "text") pushText(out, c.node.text);
      else out.push(c.node);
    }
  }
  return out;
}

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

function runLength(s: string, i: number, ch: string): number {
  let j = i;
  while (j < s.length && s[j] === ch) j++;
  return j - i;
}

/** Schließende Backtick-Folge genau gleicher Länge suchen. */
function findBacktickClose(s: string, from: number, run: number): number {
  let i = s.indexOf("`", from);
  while (i >= 0) {
    const len = runLength(s, i, "`");
    if (len === run) return i;
    i = s.indexOf("`", i + len);
  }
  return -1;
}

interface LinkMatch {
  label: string;
  dest: string;
  end: number;
}

/** `[label](ziel "titel")` ab Position `i` (dort steht „[“). */
function parseLinkAt(s: string, i: number): LinkMatch | null {
  let depth = 0;
  let j = i;
  const limit = Math.min(s.length, i + MAX_LABEL_SCAN);
  let close = -1;
  while (j < limit) {
    const ch = s[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "`") {
      const run = runLength(s, j, "`");
      const end = findBacktickClose(s, j + run, run);
      j = end >= 0 && end < limit ? end + run : j + run;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        close = j;
        break;
      }
    }
    j++;
  }
  if (close < 0 || s[close + 1] !== "(") return null;
  let k = close + 2;
  while (s[k] === " ") k++;
  let dest = "";
  if (s[k] === "<") {
    const end = s.indexOf(">", k + 1);
    if (end < 0) return null;
    dest = s.slice(k + 1, end);
    if (dest.includes("\n")) return null;
    k = end + 1;
  } else {
    let parens = 0;
    const start = k;
    while (k < s.length && k - start < 4_096) {
      const ch = s[k] ?? "";
      if (ch === "\\" && k + 1 < s.length) {
        k += 2;
        continue;
      }
      if (SPACE_RE.test(ch)) break;
      if (ch === "(") {
        parens++;
        if (parens > 32) return null;
      } else if (ch === ")") {
        if (parens === 0) break;
        parens--;
      }
      k++;
    }
    dest = s.slice(start, k).replace(/\\([()])/g, "$1");
  }
  // Entitäten VOR der Prüfung auflösen: „&#106;avascript:“ wird so zu
  // „javascript:“ und fällt bei safeHref durch.
  dest = decodeEntities(dest);
  while (s[k] === " " || s[k] === "\n") k++;
  const quote = s[k];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    const end = s.indexOf(closer, k + 1);
    if (end < 0) return null;
    k = end + 1;
    while (s[k] === " ") k++;
  }
  if (s[k] !== ")") return null;
  return { label: s.slice(i + 1, close), dest, end: k + 1 };
}

/** Satzzeichen am Ende einer nackten Adresse gehören zum Satz („… unter https://x.de.“). */
function trimUrlTail(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (last && ".,:;!?\"'’”*_~".includes(last)) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const open = (u.match(/\(/g) ?? []).length;
      const shut = (u.match(/\)/g) ?? []).length;
      if (shut > open) {
        u = u.slice(0, -1);
        continue;
      }
    }
    return u;
  }
}

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g, (whole: string, dec?: string, hex?: string, named?: string) =>
    entityValue(whole, dec, hex, named),
  );
}

function decodeEntity(m: RegExpExecArray): string {
  return entityValue(m[0], m[1], m[2], m[3]);
}

function entityValue(whole: string, dec: string | undefined, hex: string | undefined, named: string | undefined): string {
  if (named) return NAMED_ENTITIES[named] ?? whole;
  const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "0", 16);
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\uFFFD";
  return String.fromCodePoint(code);
}

/** Reiner Text eines Knotenbaums (für alt-Texte und Tests). */
export function plainText(nodes: Inline[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "code":
        out += node.text;
        break;
      case "break":
        out += "\n";
        break;
      case "image":
        out += node.alt;
        break;
      default:
        out += plainText(node.children);
    }
  }
  return out;
}
