// Einstellungsfenster (lokale Seite `settings`).

import { LocalWindowController } from "./common";

export const settingsWindow = new LocalWindowController("settings", {
  width: 760,
  height: 720,
  minWidth: 600,
  minHeight: 480,
  title: "KIRA – Einstellungen",
  backgroundColor: "#0b0c0f",
});
