import { describe, expect, it } from "vitest";

import { QUICK_MIN_HEIGHT, QUICK_WIDTH, quickHeight, quickLeft, quickMaxHeight, quickTop } from "../src/main/windows/quick-geometry";

// Owner-Wunsch 02.10.2026: Schnellfenster höher ansetzen und mehr vom Bildschirm
// nutzen. Arbeitsfläche eines 16-Zoll-MacBook (1728 × 1117 pt, Menüleiste 37 pt,
// Dock ausgeblendet) und eines 13-Zoll-MacBook Air (1470 × 956 pt, Dock unten).
const MBP16 = { x: 0, y: 37, width: 1728, height: 1080 };
const AIR13 = { x: 0, y: 37, width: 1470, height: 846 };

describe("Schnellfenster: Lage und Höhe", () => {
  it("setzt die Oberkante bei 10 % statt 18 % der Arbeitsfläche", () => {
    expect(quickTop(MBP16)).toBe(37 + 108);
    expect(quickTop(AIR13)).toBe(37 + 85);
    // vorher: 37 + 194 bzw. 37 + 152
    expect(quickTop(MBP16)).toBeLessThan(Math.round(37 + MBP16.height * 0.18));
  });

  it("wächst bis kurz vor den unteren Rand – deutlich mehr als die alten 75 %", () => {
    const top = quickTop(MBP16);
    const max = quickMaxHeight(MBP16, top);
    // Unterkante 1073 pt = 43 pt Luft über dem Rand der Arbeitsfläche (1117 pt).
    expect(max).toBe(928);
    expect(top + max).toBe(1073);
    expect(max).toBeGreaterThan(Math.round(MBP16.height * 0.75)); // vorher höchstens 810
    expect(max / MBP16.height).toBeGreaterThan(0.85);
  });

  it("ragt auch auf kleinen Bildschirmen nie in den unteren Rand", () => {
    for (const area of [MBP16, AIR13, { x: 0, y: 25, width: 1280, height: 600 }]) {
      const top = quickTop(area);
      expect(top + quickMaxHeight(area, top)).toBeLessThanOrEqual(area.y + area.height - 28);
    }
  });

  it("begrenzt die Inhaltshöhe zwischen Mindesthöhe und Platz bis unten", () => {
    const top = quickTop(AIR13);
    expect(quickHeight(AIR13, top, 40)).toBe(QUICK_MIN_HEIGHT);
    expect(quickHeight(AIR13, top, 300.2)).toBe(301);
    expect(quickHeight(AIR13, top, 5000)).toBe(quickMaxHeight(AIR13, top));
  });

  it("weiter unten (verschobenes Fenster) bleibt weniger Höhe, nie unter der Mindesthöhe", () => {
    expect(quickMaxHeight(AIR13, AIR13.y + 600)).toBeLessThan(quickMaxHeight(AIR13, quickTop(AIR13)));
    expect(quickMaxHeight(AIR13, AIR13.y + AIR13.height)).toBe(QUICK_MIN_HEIGHT);
  });

  it("steht waagerecht mittig, auch auf einem zweiten Bildschirm rechts", () => {
    expect(quickLeft(MBP16)).toBe((1728 - QUICK_WIDTH) / 2);
    expect(quickLeft({ x: 1728, y: 0, width: 2560, height: 1415 })).toBe(1728 + (2560 - QUICK_WIDTH) / 2);
  });
});
