// Deutsches App-Menü mit Standardrollen: KIRA, Datei, Bearbeiten, Darstellung,
// Fenster, Hilfe.

import { Menu, type MenuItemConstructorOptions, app, shell } from "electron";

import { describeAccelerator } from "./hotkeys";

export interface MenuDeps {
  onOpenMain: () => void;
  onQuick: () => void;
  onDictation: () => void;
  onSettings: () => void;
  onUpdates: () => void;
  onOpenInBrowser: () => void;
  onShowLogs: () => void;
  onNewWindow: () => void;
  hotkeys: () => { quickWindow: string; dictation: string };
  isDictating: () => boolean;
  /** Fertig geladenes Update (Version) oder null. */
  updateReady: () => string | null;
  onInstallUpdate: () => void;
}

export function buildAppMenu(deps: MenuDeps): void {
  const hk = deps.hotkeys();
  const dev = !app.isPackaged;
  const template: MenuItemConstructorOptions[] = [
    {
      label: "KIRA",
      submenu: [
        { label: "Über KIRA", role: "about" },
        { type: "separator" },
        { label: "Einstellungen…", accelerator: "Command+,", click: () => deps.onSettings() },
        ...(deps.updateReady()
          ? [{ label: `Update auf ${deps.updateReady() ?? ""} installieren und neu starten`, click: () => deps.onInstallUpdate() }]
          : [{ label: "Nach Updates suchen…", click: () => deps.onUpdates() }]),
        { type: "separator" },
        { label: "Dienste", role: "services" },
        { type: "separator" },
        { label: "KIRA ausblenden", role: "hide" },
        { label: "Andere ausblenden", role: "hideOthers" },
        { label: "Alle einblenden", role: "unhide" },
        { type: "separator" },
        { label: "KIRA beenden", role: "quit" },
      ],
    },
    {
      label: "Datei",
      submenu: [
        { label: "Neues Fenster", accelerator: "Command+N", click: () => deps.onNewWindow() },
        { label: `Schnellfenster (${describeAccelerator(hk.quickWindow)})`, click: () => deps.onQuick() },
        { type: "separator" },
        { label: "Fenster schließen", role: "close" },
      ],
    },
    {
      label: "Bearbeiten",
      submenu: [
        { label: "Widerrufen", role: "undo" },
        { label: "Wiederholen", role: "redo" },
        { type: "separator" },
        { label: "Ausschneiden", role: "cut" },
        { label: "Kopieren", role: "copy" },
        { label: "Einsetzen", role: "paste" },
        { label: "Einsetzen und Stil anpassen", role: "pasteAndMatchStyle" },
        { label: "Löschen", role: "delete" },
        { label: "Alles auswählen", role: "selectAll" },
        { type: "separator" },
        {
          label: `${deps.isDictating() ? "Diktat stoppen" : "Diktat starten"} (${describeAccelerator(hk.dictation)})`,
          click: () => deps.onDictation(),
        },
        { type: "separator" },
        { label: "Sprache", submenu: [{ label: "Diktat beginnen", role: "startSpeaking" }, { label: "Diktat beenden", role: "stopSpeaking" }] },
      ],
    },
    {
      label: "Darstellung",
      submenu: [
        { label: "Neu laden", role: "reload" },
        { label: "Erzwungen neu laden", role: "forceReload" },
        ...(dev ? [{ label: "Entwicklerwerkzeuge", role: "toggleDevTools" } as MenuItemConstructorOptions] : []),
        { type: "separator" },
        { label: "Originalgröße", role: "resetZoom" },
        { label: "Vergrößern", role: "zoomIn" },
        { label: "Verkleinern", role: "zoomOut" },
        { type: "separator" },
        { label: "Vollbild ein/aus", role: "togglefullscreen" },
      ],
    },
    {
      label: "Fenster",
      role: "window",
      submenu: [
        { label: "KIRA anzeigen", accelerator: "Command+1", click: () => deps.onOpenMain() },
        { type: "separator" },
        { label: "Im Dock ablegen", role: "minimize" },
        { label: "Zoomen", role: "zoom" },
        { type: "separator" },
        { label: "Alle nach vorne bringen", role: "front" },
      ],
    },
    {
      label: "Hilfe",
      role: "help",
      submenu: [
        { label: "Dashboard im Browser öffnen", click: () => deps.onOpenInBrowser() },
        { label: "Protokolle anzeigen", click: () => deps.onShowLogs() },
        { type: "separator" },
        { label: "KIRA für Mac auf GitHub", click: () => void shell.openExternal("https://github.com/forliHD/kira-mac") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
