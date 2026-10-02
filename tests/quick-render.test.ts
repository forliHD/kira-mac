import { type FunctionComponent, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// MarkdownView.tsx gehört zum Web-Teilprojekt (JSX); tsconfig.node.json kennt
// kein JSX. Darum per nicht-literalem Pfad laden – tsc folgt dem nicht, Vitest
// übersetzt die Datei selbst.
const VIEW_MODULE = "../src/renderer/quick/MarkdownView.tsx";

interface ViewProps {
  text: string;
  onLink: (href: string) => void;
  caret?: boolean;
}

async function render(text: string, caret = false): Promise<string> {
  const mod = (await import(/* @vite-ignore */ VIEW_MODULE)) as { MarkdownView: unknown };
  const View = mod.MarkdownView as FunctionComponent<ViewProps>;
  return renderToStaticMarkup(createElement(View, { text, onLink: () => undefined, caret }));
}

describe("MarkdownView (gerendert)", () => {
  it("rohes HTML landet als Text, nie als Element", async () => {
    const html = await render('<script>alert(1)</script> <img src=x onerror="alert(1)"> <a href="javascript:alert(1)">x</a>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/href="javascript/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("unsichere Linkziele werden kein <a>, sichere schon", async () => {
    const html = await render("[böse](javascript:alert(1)) [daten](data:text/html,x) [gut](https://kira.example/chat) [pfad](/documents) https://a.de/x");
    expect(html).not.toMatch(/href="(javascript|data):/i);
    expect(html).toContain("böse");
    expect(html).toContain('href="https://kira.example/chat"');
    expect(html).toContain('href="/documents"');
    expect(html).toContain('href="https://a.de/x"');
    expect((html.match(/<a /g) ?? []).length).toBe(3);
  });

  it("Bilder werden ein Link „Bild: …“ statt <img>", async () => {
    const html = await render("![Grundriss](https://kira.example/g.png) ![kaputt](javascript:x)");
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("Bild: Grundriss");
    expect(html).toContain('href="https://kira.example/g.png"');
    expect(html).toContain("Bild: kaputt");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  it("zeichnet Überschriften, Listen, Code, Zitat und Tabelle als Elemente", async () => {
    const html = await render("# Titel\n\n- a\n- **b**\n\n1. eins\n\n```js\nlet x = 1 < 2;\n```\n\n> Zitat\n\n| A | B |\n|---|--:|\n| 1 | 2 |");
    expect(html).toContain("<h2");
    expect(html).toMatch(/<ul[^>]*><li>a<\/li><li><strong>b<\/strong><\/li><\/ul>/);
    expect(html).toContain("<ol");
    expect(html).toContain("<pre");
    expect(html).toContain("let x = 1 &lt; 2;");
    expect(html).toContain("<blockquote");
    expect(html).toMatch(/<th[^>]*>A<\/th>/);
    expect(html).toContain("text-align:right");
  });

  it("hängt die Schreibmarke nur beim Streamen an den letzten Block", async () => {
    expect(await render("Hallo\n\nWelt", true)).toMatch(/Welt<span class="q-caret"/);
    expect(await render("Hallo", false)).not.toContain("q-caret");
    expect(await render("- a\n- b", true)).toMatch(/<li>b<span class="q-caret"/);
  });
});
