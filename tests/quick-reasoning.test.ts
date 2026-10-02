import { type FunctionComponent, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Denkschritte im Schnellfenster (Owner-Wunsch 02.10.2026): eingeklappt wie im
// Dashboard („Nachgedacht · 2 Schritte“ + Vorschau), aufklappbar. App.tsx gehört
// zum Web-Teilprojekt – per nicht-literalem Pfad laden wie quick-render.test.ts.
const APP_MODULE = "../src/renderer/quick/App.tsx";

interface ReasoningProps {
  steps: string[];
  streaming: boolean;
}

async function render(props: ReasoningProps): Promise<string> {
  const mod = (await import(/* @vite-ignore */ APP_MODULE)) as { Reasoning: unknown };
  const View = mod.Reasoning as FunctionComponent<ReasoningProps>;
  return renderToStaticMarkup(createElement(View, props));
}

describe("Reasoning (Schnellfenster)", () => {
  it("zeigt eingeklappt Kopfzeile, Zahl und den letzten Schritt als Vorschau", async () => {
    const html = await render({ steps: ["Der Nutzer fragt nach Mails.", "Ich suche mit mail_search, days=1."], streaming: false });
    expect(html).toContain("Nachgedacht");
    expect(html).toContain("2 Schritte");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Ich suche mit mail_search, days=1.");
    // Eingeklappt keine Liste der Schritte.
    expect(html).not.toContain("<ol");
  });

  it("solange KIRA noch denkt: „Denkt nach“, Einzahl bei einem Schritt", async () => {
    const html = await render({ steps: ["Überlege…"], streaming: true });
    expect(html).toContain("Denkt nach");
    expect(html).toContain("1 Schritt<");
    expect(html).toContain("is-busy");
  });

  it("ohne Denkschritte nichts", async () => {
    expect(await render({ steps: [], streaming: false })).toBe("");
  });
});
