// Einstellungsfenster (lokale Seite `settings`): Ampel eingelassen über der
// Seitenleiste, native Vibrancy hinter dem transparenten Webinhalt.

import { LocalWindowController } from "./common";

export const settingsWindow = new LocalWindowController("settings", {
  width: 900,
  height: 620,
  minWidth: 780,
  minHeight: 520,
  title: "KIRA – Einstellungen",
  titleBarStyle: "hiddenInset",
  trafficLightPosition: { x: 20, y: 20 },
  transparent: true,
  backgroundColor: "#00000000",
  vibrancy: "under-window",
  visualEffectState: "active",
  fullscreenable: false,
});
