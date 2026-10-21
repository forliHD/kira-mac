import { describe, expect, it } from "vitest";

import { buildTermIndex, candidateWords, correctWithVocabulary, editDistance, matchLevel, phoneticKey } from "../src/main/dictation-correct";

const TERMS = ["KIRA", "Lucas Reiser", "Musterfirma GmbH", "Proxmox", "Frau Weber", "Nordlicht"];

describe("Lautschlüssel und Abstand", () => {
  it("gibt ähnlich Klingendem denselben Schlüssel", () => {
    expect(phoneticKey("Lugas")).toBe(phoneticKey("Lucas"));
    expect(phoneticKey("Proxmocks")).toBe(phoneticKey("Proxmox"));
    expect(phoneticKey("Maier")).toBe(phoneticKey("Meyer"));
    expect(phoneticKey("Philipp")).toBe(phoneticKey("Filip"));
    expect(phoneticKey("Müller")).toBe(phoneticKey("Mueller"));
  });

  it("hält Verschiedenes auseinander", () => {
    expect(phoneticKey("Weber")).not.toBe(phoneticKey("Wetter"));
    expect(phoneticKey("Kira")).not.toBe(phoneticKey("Tira"));
  });

  it("editDistance bricht früh ab", () => {
    expect(editDistance("kira", "tira")).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("matchLevel", () => {
  it("0 bei gleichem Wort (Groß/Klein egal), 1 lautgleich, 2 Tippfehler, null sonst", () => {
    expect(matchLevel("kira", "KIRA")).toBe(0);
    expect(matchLevel("Lugas", "Lucas")).toBe(1);
    expect(matchLevel("Tira", "KIRA")).toBe(2);
    expect(matchLevel("Weeber", "Weber")).toBe(1); // ee → e: lautgleich
    expect(matchLevel("Wober", "Weber")).toBe(2);
    expect(matchLevel("Wetter", "Weber")).toBeNull();
    expect(matchLevel("Haus", "Hans")).toBeNull(); // „Haus“ ist ein häufiges Wort
  });

  it("schützt häufige Wörter, Zahlen und Kurzes", () => {
    expect(matchLevel("weder", "Weber")).toBeNull();
    expect(matchLevel("oder", "Odem")).toBeNull();
    expect(matchLevel("2024", "2025")).toBeNull();
    expect(matchLevel("Tim", "Tom")).toBeNull();
  });
});

describe("correctWithVocabulary", () => {
  it("ersetzt verhörte Namen und behält Satzzeichen", () => {
    const r = correctWithVocabulary("Hallo Tira, frag Lugas nach Proxmocks.", TERMS);
    expect(r.text).toBe("Hallo KIRA, frag Lucas nach Proxmox.");
    expect(r.replacements).toBe(3);
  });

  it("korrigiert nur die Schreibweise, wenn das Wort stimmt", () => {
    const r = correctWithVocabulary("kira hat geantwortet", TERMS);
    expect(r.text).toBe("KIRA hat geantwortet");
    expect(r.replacements).toBe(1);
    expect(correctWithVocabulary("KIRA hat geantwortet", TERMS)).toEqual({ text: "KIRA hat geantwortet", replacements: 0 });
  });

  it("erkennt Mehrwortbegriffe und deren Teile", () => {
    expect(correctWithVocabulary("Bitte frau weeber anrufen", TERMS).text).toBe("Bitte Frau Weber anrufen");
    expect(correctWithVocabulary("Das war Lukas Reißer.", TERMS).text).toBe("Das war Lucas Reiser.");
    expect(correctWithVocabulary("Gruß an Reißer", TERMS).text).toBe("Gruß an Reiser");
    expect(correctWithVocabulary("die musterfirma gmbh zahlt", TERMS).text).toBe("die Musterfirma GmbH zahlt");
  });

  it("lässt häufige Wörter und Fremdes in Ruhe", () => {
    const text = "Das Wetter ist weder gut noch schlecht, oder?";
    expect(correctWithVocabulary(text, TERMS)).toEqual({ text, replacements: 0 });
    expect(correctWithVocabulary("Kita und Kino", TERMS).text).toBe("Kita und Kino");
  });

  it("schont Wörter, die das Wörterbuch kennt – nur bei Tippfehler-Treffern", () => {
    const known = new Set(["kila", "lukas"]);
    expect(candidateWords("Kila ruft Lukas und Tira", TERMS)).toEqual(["Kila", "Tira"]);
    const r = correctWithVocabulary("Kila ruft Lukas und Tira", TERMS, { knownWords: known });
    expect(r.text).toBe("Kila ruft Lucas und KIRA"); // Kila bekannt → bleibt; Lukas lautgleich → Lucas; Tira unbekannt → KIRA
    expect(r.replacements).toBe(2);
    expect(correctWithVocabulary("frau Wober", TERMS, { knownWords: new Set(["wober"]) }).text).toBe("frau Wober");
  });

  it("lässt Zahlen, Bindestriche und Leerzeilen unangetastet", () => {
    expect(correctWithVocabulary("Tira-Server 2026\n\nneu", TERMS).text).toBe("KIRA-Server 2026\n\nneu");
    expect(correctWithVocabulary("14:30 Uhr", TERMS).text).toBe("14:30 Uhr");
  });

  it("hebt sich bei zwei gleich guten Begriffen auf", () => {
    const r = correctWithVocabulary("Herr Maier kommt", ["Meier", "Mayer"]);
    expect(r.text).toBe("Herr Maier kommt");
    expect(r.replacements).toBe(0);
  });

  it("tut ohne Begriffe und ohne Text nichts", () => {
    expect(correctWithVocabulary("Hallo", [])).toEqual({ text: "Hallo", replacements: 0 });
    expect(correctWithVocabulary("", TERMS)).toEqual({ text: "", replacements: 0 });
  });

  it("nimmt auch einen vorbereiteten Index", () => {
    const index = buildTermIndex(TERMS);
    expect(index.multi.map((e) => e.text)).toEqual(["Lucas Reiser", "Musterfirma GmbH", "Frau Weber"]);
    expect(index.single.map((e) => e.text)).toEqual(["KIRA", "Lucas", "Reiser", "Musterfirma", "GmbH", "Proxmox", "Weber", "Nordlicht"]);
    expect(correctWithVocabulary("Nordlich", index).text).toBe("Nordlicht");
  });
});
