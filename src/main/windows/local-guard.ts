// Lokale Seiten (Schnellfenster, HUD, Einstellungen, Einrichtung) dürfen nie
// wegnavigieren: Ein gezogener Link, ein Formular oder ein Skriptfehler würde
// sonst eine fremde Seite MIT dem lokalen Preload (window.KiraLocal) laden.
// Navigationen und neue Fenster gehen stattdessen an `openLink` (Instanz →
// Hauptfenster, sonst System-Browser).

import { type WebContents } from "electron";

import { scoped } from "../log";

const log = scoped("local-guard");

export function guardLocalPage(contents: WebContents, openLink: (url: string) => void): void {
  contents.on("will-navigate", (event, url) => {
    // Neu laden derselben Seite (z. B. HMR in der Entwicklung) bleibt erlaubt.
    const current = contents.getURL();
    if (current && sameDocument(current, url)) return;
    event.preventDefault();
    log.info("local_navigation_blocked", { scheme: url.split(":")[0] });
    openLink(url);
  });
  contents.on("will-redirect", (event, url) => {
    const current = contents.getURL();
    if (current && sameDocument(current, url)) return;
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: "deny" };
  });
}

function sameDocument(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}
