import { describe, expect, it } from "vitest";

import { type Block, type Inline, parseInline, parseMarkdown, plainText, safeHref } from "../src/renderer/quick/markdown";

const text = (t: string): Inline => ({ type: "text", text: t });
const para = (...children: Inline[]): Block => ({ type: "paragraph", children });

/** Alle Links eines Baums (rekursiv), für die Sicherheitsfälle. */
function links(blocks: Block[]): string[] {
  const out: string[] = [];
  const walkInline = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.type === "link") out.push(n.href);
      if (n.type === "image" && n.href) out.push(n.href);
      if ("children" in n) walkInline(n.children);
    }
  };
  const walk = (bs: Block[]): void => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") walkInline(b.children);
      else if (b.type === "list") b.items.forEach((item) => walk(item.blocks));
      else if (b.type === "quote") walk(b.children);
      else if (b.type === "table") [b.head, ...b.rows].forEach((row) => row.forEach(walkInline));
    }
  };
  walk(blocks);
  return out;
}

describe("Blöcke", () => {
  it("trennt Absätze an Leerzeilen und behält Zeilenumbrüche", () => {
    expect(parseMarkdown("Hallo Frau Weber,\n\nviele Grüße\nLucas")).toEqual([
      para(text("Hallo Frau Weber,")),
      para(text("viele Grüße"), { type: "break" }, text("Lucas")),
    ]);
  });

  it("erkennt # bis ### und zählt tiefere Ebenen als ###", () => {
    const blocks = parseMarkdown("# Eins\n## Zwei ##\n### Drei\n#### Vier\n#Hashtag");
    expect(blocks.slice(0, 4).map((b) => (b.type === "heading" ? [b.level, plainText(b.children)] : null))).toEqual([
      [1, "Eins"],
      [2, "Zwei"],
      [3, "Drei"],
      [3, "Vier"],
    ]);
    expect(blocks[4]).toEqual(para(text("#Hashtag")));
  });

  it("Aufzählungen und nummerierte Listen samt Startwert", () => {
    const [ul, ol] = parseMarkdown("- eins\n* zwei\n+ drei\n\n3. drei\n4. vier");
    expect(ul).toMatchObject({ type: "list", ordered: false });
    expect(ul?.type === "list" && ul.items.map((i) => i.blocks)).toEqual([[para(text("eins"))], [para(text("zwei"))], [para(text("drei"))]]);
    expect(ol).toMatchObject({ type: "list", ordered: true, start: 3 });
    expect(ol?.type === "list" && ol.items.length).toBe(2);
  });

  it("verschachtelt eine Ebene – auch mit knapper Einrückung unter „1.“", () => {
    const [list] = parseMarkdown("1. Erstens\n  - a\n  - b\n2. Zweitens");
    expect(list?.type).toBe("list");
    if (list?.type !== "list") return;
    expect(list.items).toHaveLength(2);
    const first = list.items[0]?.blocks ?? [];
    expect(first[0]).toEqual(para(text("Erstens")));
    expect(first[1]).toMatchObject({ type: "list", ordered: false, items: [{ blocks: [para(text("a"))] }, { blocks: [para(text("b"))] }] });
  });

  it("eine Liste darf einen Absatz unterbrechen, „1990. …“ aber nicht", () => {
    expect(parseMarkdown("Die Punkte:\n- a\n- b").map((b) => b.type)).toEqual(["paragraph", "list"]);
    expect(parseMarkdown("Das war\n1990. ein gutes Jahr").map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("Codeblöcke mit Sprache; Markdown darin bleibt roh; offener Block beim Streamen", () => {
    expect(parseMarkdown("```ts\nconst a = **b**;\n<script>x</script>\n```\nDanach")).toEqual([
      { type: "code", lang: "ts", text: "const a = **b**;\n<script>x</script>" },
      para(text("Danach")),
    ]);
    expect(parseMarkdown("Text\n```\nnoch offen")).toEqual([para(text("Text")), { type: "code", lang: null, text: "noch offen" }]);
    expect(parseMarkdown("~~~\n```\n~~~")).toEqual([{ type: "code", lang: null, text: "```" }]);
  });

  it("Zitat, Trennlinie und Tabelle mit Ausrichtung", () => {
    expect(parseMarkdown("> Zitat\nweiter\n\n---")).toEqual([
      { type: "quote", children: [para(text("Zitat"), { type: "break" }, text("weiter"))] },
      { type: "rule" },
    ]);
    const [table] = parseMarkdown("| Name | Betrag |\n|:--|--:|\n| Miete | 900 € |\n| `a|b` | x \\| y |");
    expect(table).toEqual({
      type: "table",
      align: ["left", "right"],
      head: [[text("Name")], [text("Betrag")]],
      rows: [
        [[text("Miete")], [text("900 €")]],
        [[{ type: "code", text: "a|b" }], [text("x | y")]],
      ],
    });
  });

  it("füllt kurze Tabellenzeilen auf, kappt zu lange und endet an einer Zeile ohne |", () => {
    const blocks = parseMarkdown("a | b\n--- | ---\n1 |\n1 | 2 | 3\nDanach");
    expect(blocks.map((b) => b.type)).toEqual(["table", "paragraph"]);
    expect(blocks[0]?.type === "table" && blocks[0].rows).toEqual([
      [[text("1")], []],
      [[text("1")], [text("2")]],
    ]);
  });
});

describe("Inline", () => {
  it("fett, kursiv, durchgestrichen, Code", () => {
    expect(parseInline("**fett** und *kursiv*, _auch_ ~~weg~~ `x*y`")).toEqual([
      { type: "strong", children: [text("fett")] },
      text(" und "),
      { type: "em", children: [text("kursiv")] },
      text(", "),
      { type: "em", children: [text("auch")] },
      text(" "),
      { type: "del", children: [text("weg")] },
      text(" "),
      { type: "code", text: "x*y" },
    ]);
  });

  it("verschachtelte Hervorhebung wie in CommonMark", () => {
    expect(parseInline("***beides***")).toEqual([{ type: "em", children: [{ type: "strong", children: [text("beides")] }] }]);
    expect(parseInline("**fett *kursiv***")).toEqual([{ type: "strong", children: [text("fett "), { type: "em", children: [text("kursiv")] }] }]);
    expect(parseInline("*a **b** c*")).toEqual([{ type: "em", children: [text("a "), { type: "strong", children: [text("b")] }, text(" c")] }]);
  });

  it("lässt snake_case, Rechenzeichen und offene Sternchen in Ruhe", () => {
    expect(parseInline("datei_name_v2.py")).toEqual([text("datei_name_v2.py")]);
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
    expect(parseInline("**noch offen")).toEqual([text("**noch offen")]);
    expect(parseInline("~5 Minuten")).toEqual([text("~5 Minuten")]);
  });

  it("Links, Autolinks und nackte Adressen (Satzzeichen am Ende gehören nicht dazu)", () => {
    expect(parseInline("[KIRA](https://kira.example/chat) und <https://a.de/x>")).toEqual([
      { type: "link", href: "https://kira.example/chat", children: [text("KIRA")] },
      text(" und "),
      { type: "link", href: "https://a.de/x", children: [text("https://a.de/x")] },
    ]);
    expect(parseInline("Siehe https://example.com/a_(b). Oder (http://192.168.178.166/)!")).toEqual([
      text("Siehe "),
      { type: "link", href: "https://example.com/a_(b)", children: [text("https://example.com/a_(b)")] },
      text(". Oder ("),
      { type: "link", href: "http://192.168.178.166/", children: [text("http://192.168.178.166/")] },
      text(")!"),
    ]);
    expect(parseInline("**https://fett.de**")).toEqual([
      { type: "strong", children: [{ type: "link", href: "https://fett.de/", children: [text("https://fett.de")] }] },
    ]);
  });

  it("Bilder werden zu „Bild“-Knoten, nicht geladen", () => {
    expect(parseInline("![Ein **Hund**](https://img.example/h.jpg)")).toEqual([{ type: "image", href: "https://img.example/h.jpg", alt: "Ein Hund" }]);
    expect(parseInline("![x](javascript:alert(1))")).toEqual([{ type: "image", href: null, alt: "x" }]);
  });

  it("Escapes und Entitäten", () => {
    expect(parseInline("\\*kein\\* &amp; &lt;b&gt; &#x41;")).toEqual([text("*kein* & <b> A")]);
  });
});

describe("Randfälle aus Sprachmodell-Antworten", () => {
  it("Link mit Titel und mit <Ziel mit Leerzeichen>", () => {
    expect(parseInline('[a](https://x.de "Titel") [b](<https://x.de/a b>)')).toEqual([
      { type: "link", href: "https://x.de/", children: [text("a")] },
      text(" "),
      { type: "link", href: "https://x.de/a%20b", children: [text("b")] },
    ]);
  });

  it("lockere Liste bleibt eine Liste; Codeblock im Listenpunkt", () => {
    const [list, ...rest] = parseMarkdown("- eins\n\n- zwei\n  ```sh\n  ls -la\n  ```\n\nDanach");
    expect(rest.map((b) => b.type)).toEqual(["paragraph"]);
    expect(list?.type === "list" && list.items.map((i) => i.blocks.map((b) => b.type))).toEqual([["paragraph"], ["paragraph", "code"]]);
    expect(list?.type === "list" && list.items[1]?.blocks[1]).toEqual({ type: "code", lang: "sh", text: "ls -la" });
  });

  it("„1)“-Listen, mailto-Autolink, halb gestreamte Hervorhebung, verschachteltes Zitat", () => {
    expect(parseMarkdown("1) a\n2) b")[0]).toMatchObject({ type: "list", ordered: true, start: 1 });
    expect(parseInline("<mailto:lucas@example.com>")).toEqual([{ type: "link", href: "mailto:lucas@example.com", children: [text("mailto:lucas@example.com")] }]);
    expect(parseInline("Das ist **wich")).toEqual([text("Das ist **wich")]);
    expect(parseMarkdown(">> innen")).toEqual([{ type: "quote", children: [{ type: "quote", children: [para(text("innen"))] }] }]);
  });

  it("Unterstrich-Hervorhebung nur an Wortgrenzen, Backslash am Zeilenende bricht um", () => {
    expect(parseInline("_kursiv_, aber nicht_hier_")).toEqual([{ type: "em", children: [text("kursiv")] }, text(", aber nicht_hier_")]);
    expect(parseInline("a\\\nb")).toEqual([text("a"), { type: "break" }, text("b")]);
  });
});

describe("Sicherheit", () => {
  it("rohes HTML bleibt Text", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([para(text("<script>alert(1)</script>"))]);
    expect(parseMarkdown('<img src=x onerror="alert(1)">')).toEqual([para(text('<img src=x onerror="alert(1)">'))]);
  });

  it("javascript:-Links werden kein Link – der Linktext bleibt Text", () => {
    expect(parseInline("[klick](javascript:alert(1))")).toEqual([text("klick")]);
    expect(parseInline("[**fett**](JaVaScRiPt:alert(1))")).toEqual([{ type: "strong", children: [text("fett")] }]);
    expect(parseInline("<javascript:alert(1)>")).toEqual([text("<javascript:alert(1)>")]);
    expect(parseInline("javascript:alert(1)")).toEqual([text("javascript:alert(1)")]);
  });

  it("kein Link für data:, vbscript:, file:, //host, /\\host, Steuerzeichen und versteckte Entitäten", () => {
    const md = [
      "[a](data:text/html,<b>x</b>)",
      "[b](vbscript:msgbox(1))",
      "[c](file:///etc/passwd)",
      "[d](//evil.example)",
      "[e](/\\evil.example)",
      "[f](&#106;avascript:alert(1))",
      "[g](<java\nscript:alert(1)>)",
      "[h](  javascript:alert(1))",
      "[i](relativ/pfad)",
    ].join("\n\n");
    expect(links(parseMarkdown(md))).toEqual([]);
  });

  it("safeHref erlaubt nur http(s) mit Host, mailto, tel und Instanz-Pfade", () => {
    expect(safeHref("HTTPS://Example.COM/a b")).toBe("https://example.com/a%20b");
    expect(safeHref("http://")).toBeNull();
    expect(safeHref("mailto:lucas@example.com")).toBe("mailto:lucas@example.com");
    expect(safeHref("tel:+49 30 1234567")).toBe("tel:+49 30 1234567");
    expect(safeHref("/chat?session=4")).toBe("/chat?session=4");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("\u0001https://a.de")).toBeNull();
  });

  it("entartete Eingaben laufen schnell durch", () => {
    const inputs = ["*a ".repeat(20_000), "[".repeat(20_000), "_".repeat(20_000), "`".repeat(5_001), "**".repeat(10_000), "> ".repeat(5_000), "- ".repeat(5_000)];
    for (const input of inputs) {
      const started = performance.now();
      parseMarkdown(input);
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});
