// Einrichtungsfenster beim ersten Start (lokale Seite `onboarding`).

import { LocalWindowController } from "./common";

export const onboardingWindow = new LocalWindowController("onboarding", {
  width: 640,
  height: 600,
  resizable: false,
  minimizable: false,
  maximizable: false,
  title: "KIRA einrichten",
  backgroundColor: "#0b0c0f",
});
