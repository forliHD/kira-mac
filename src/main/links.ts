// Link- und Fensterpolitik: Instanz-Origin → eigenes App-Fenster mit Preload,
// `blob:` → eingebautes Ansichtsfenster (der Preload erkennt das Protokoll und
// stellt nichts bereit), alles andere → System-Browser. `will-navigate` von
// einer Instanz-Seite weg → extern. Navigationen, die NICHT von einer
// Instanz-Seite ausgehen (Cloudflare-Access-Anmeldung, Identitätsanbieter),
// bleiben im Fenster, sonst bräche die Anmeldung.

import { type BrowserWindow, type WebContents, shell } from "electron";

import { scoped } from "./log";

const log = scoped("links");

export interface LinkPolicyDeps {
  isInstanceUrl: (url: string) => boolean;
  /** Wird für jedes neu erzeugte Kindfenster aufgerufen (Politik vererben, Downloads). */
  onChildWindow?: (win: BrowserWindow) => void;
}

function isBlob(url: string): boolean {
  return url.startsWith("blob:");
}

function isAuthFlow(url: string): boolean {
  // Cloudflare Access und gängige Identitätsanbieter laufen im Fenster weiter.
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".cloudflareaccess.com") || host === "accounts.google.com" || host.endsWith(".microsoftonline.com");
  } catch {
    return false;
  }
}

export function openExternalSafely(url: string): void {
  if (!/^(https?|mailto|tel):/i.test(url)) {
    log.warn("external_blocked", { scheme: url.split(":")[0] });
    return;
  }
  void shell.openExternal(url).catch((err: unknown) => log.warn("external_open_failed", { error: err instanceof Error ? err.message : String(err) }));
}

export function applyLinkPolicy(contents: WebContents, deps: LinkPolicyDeps): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isBlob(url)) {
      // Ansichtsfenster ohne Brücke: blob-URLs leben nur im erzeugenden
      // Renderer, deshalb muss Electron das Fenster selbst öffnen.
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 760,
          title: "KIRA – Ansicht",
          autoHideMenuBar: true,
        },
      };
    }
    if (deps.isInstanceUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 800,
          title: "KIRA",
        },
      };
    }
    if (url === "about:blank") {
      return { action: "deny" };
    }
    openExternalSafely(url);
    return { action: "deny" };
  });

  contents.on("did-create-window", (child, details) => {
    log.info("child_window", { blob: isBlob(details.url), instance: deps.isInstanceUrl(details.url) });
    applyLinkPolicy(child.webContents, deps);
    deps.onChildWindow?.(child);
  });

  contents.on("will-navigate", (event, url) => {
    const from = contents.getURL();
    if (deps.isInstanceUrl(url) || isBlob(url) || url.startsWith("file:") || url.startsWith("about:")) return;
    if (deps.isInstanceUrl(from) && !isAuthFlow(url)) {
      event.preventDefault();
      openExternalSafely(url);
      return;
    }
    // Von einer Nicht-Instanz-Seite (Anmeldung) aus darf navigiert werden.
  });
}
