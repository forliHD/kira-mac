// Pfade zu Helfer, Preloads und Ressourcen – in Entwicklung (electron-vite)
// und in der gepackten App (asar + Contents/Resources) verschieden.

import { join } from "node:path";

import { app } from "electron";

/** Projektwurzel in der Entwicklung: out/main → zwei Ebenen hoch. Bewusst über
 *  `__dirname` statt `app.getAppPath()`, damit auch `electron out/main/index.js`
 *  (ohne package.json als App-Pfad) die Ressourcen findet. */
function devRoot(): string {
  return join(__dirname, "..", "..");
}

/** `resources/<…>` im Repo bzw. `Contents/Resources/<…>` in der App. */
export function resourcePath(...parts: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(devRoot(), "resources");
  return join(base, ...parts);
}

/** Der Swift-Helfer: dev `helper/.build/release/kira-helper`, gepackt `Resources/helper/kira-helper`. */
export function helperBinaryPath(): string {
  return app.isPackaged ? join(process.resourcesPath, "helper", "kira-helper") : join(devRoot(), "helper", ".build", "release", "kira-helper");
}

/** Preload-Bündel (electron-vite legt sie neben out/main ab). */
export function preloadPath(name: "index" | "local"): string {
  return join(__dirname, "..", "preload", `${name}.js`);
}

/** Lokale Seite: dev über den Vite-Server, gepackt aus out/renderer. */
export function localPageUrl(page: "onboarding" | "settings" | "hud" | "offline", query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query).toString();
  const suffix = qs ? `?${qs}` : "";
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServer) return `${devServer}/${page}/index.html${suffix}`;
  const file = join(__dirname, "..", "renderer", page, "index.html");
  return `file://${file}${suffix}`;
}
