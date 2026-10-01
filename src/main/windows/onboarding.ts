// Einrichtungsfenster beim ersten Start (lokale Seite `onboarding`): Ampel
// eingelassen, native Vibrancy hinter dem transparenten Webinhalt.

import { LocalWindowController } from "./common";

export const onboardingWindow = new LocalWindowController("onboarding", {
  width: 760,
  height: 560,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  title: "KIRA einrichten",
  titleBarStyle: "hiddenInset",
  trafficLightPosition: { x: 20, y: 20 },
  transparent: true,
  backgroundColor: "#00000000",
  vibrancy: "under-window",
  visualEffectState: "active",
});
