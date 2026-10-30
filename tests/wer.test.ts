import { describe, expect, it } from "vitest";

import { termHits, werTokens, wordErrorRate } from "../src/shared/wer";

describe("werTokens", () => {
  it("normalisiert Groß/Klein, ß und Satzzeichen", () => {
    expect(werTokens("Hallo, Frau Weber! Straße 14:30.")).toEqual(["hallo", "frau", "weber", "strasse", "14", "30"]);
    expect(werTokens("  ")).toEqual([]);
  });
});

describe("wordErrorRate", () => {
  it("ist 0 bei gleichem Text (auch mit anderer Zeichensetzung)", () => {
    expect(wordErrorRate("Hallo Welt.", "hallo welt")).toEqual({ words: 2, substitutions: 0, insertions: 0, deletions: 0, wer: 0 });
  });

  it("zählt Ersetzung, Einfügung und Löschung getrennt", () => {
    const r = wordErrorRate("der Termin ist am Montag", "der Termin am Montag und Dienstag ist");
    expect(r.words).toBe(5);
    expect(r.substitutions + r.insertions + r.deletions).toBeGreaterThan(0);
    expect(wordErrorRate("a b c", "a x c")).toMatchObject({ substitutions: 1, insertions: 0, deletions: 0, wer: 1 / 3 });
    expect(wordErrorRate("a b c", "a c")).toMatchObject({ substitutions: 0, insertions: 0, deletions: 1 });
    expect(wordErrorRate("a b c", "a b b c")).toMatchObject({ substitutions: 0, insertions: 1, deletions: 0 });
  });

  it("leere Vorlage: 0 ohne Hypothese, sonst 1", () => {
    expect(wordErrorRate("", "").wer).toBe(0);
    expect(wordErrorRate("", "etwas").wer).toBe(1);
  });
});

describe("termHits", () => {
  it("zählt Vorkommen der Begriffe in Vorlage und Erkanntem", () => {
    const ref = "Hallo KIRA, frag Lucas Reiser nach Proxmox. KIRA antwortet.";
    const hyp = "Hallo Tira, frag Lucas Reiser nach Proxmox. KIRA antwortet.";
    expect(termHits(ref, hyp, ["KIRA", "Lucas Reiser", "Proxmox", "Nordlicht"])).toEqual({ total: 4, hit: 3 });
  });

  it("ganze Wörter, nicht Teile", () => {
    expect(termHits("Tim kommt", "Timo kommt", ["Tim"])).toEqual({ total: 1, hit: 0 });
  });
});
