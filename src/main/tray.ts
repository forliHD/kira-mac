// Menüleisten-Symbol: Status (verbunden/offline), Öffnen, Schnellfenster,
// Diktat starten/stoppen, Einstellungen, Nach Updates suchen, Beenden.
// Vier Template-Bilder (resources/tray/): verbunden, getrennt (gestrichelt),
// Diktat läuft (Mikrofon), Update bereit (Punkt). Fehlt eines, nimmt es das
// verbundene. Ist ein Update geladen, steht „installieren“ ganz oben im Menü.

import { Menu, type MenuItemConstructorOptions, type NativeImage, Tray, nativeImage } from "electron";

import { type UpdateState } from "../shared/local-api";
import { describeAccelerator } from "./hotkeys";
import { scoped } from "./log";
import { resourcePath } from "./paths";

const log = scoped("tray");

export interface TrayDeps {
  onOpen: () => void;
  onQuick: () => void;
  onDictation: () => void;
  onSettings: () => void;
  onUpdates: () => void;
  onQuit: () => void;
  isDictating: () => boolean;
  hotkeys: () => { quickWindow: string; dictation: string };
  /** Gibt es ein Diktat im Verlauf? */
  hasDictation: () => boolean;
  onCopyLastDictation: () => void;
  onDictationHistory: () => void;
  /** Stand des Auto-Updates (updater.ts). */
  update: () => UpdateState;
  onInstallUpdate: () => void;
}

type TrayLook = "online" | "offline" | "dictating" | "update";

const TRAY_FILES: Record<TrayLook, string> = {
  online: "kiraTemplate.png",
  offline: "kiraOfflineTemplate.png",
  dictating: "kiraDictatingTemplate.png",
  update: "kiraUpdateTemplate.png",
};

function loadTemplate(file: string): NativeImage | null {
  const image = nativeImage.createFromPath(resourcePath("tray", file));
  if (image.isEmpty()) return null;
  image.setTemplateImage(true);
  return image;
}

export class TrayController {
  private tray: Tray | null = null;
  private images: Partial<Record<TrayLook, NativeImage>> = {};
  private look: TrayLook | null = null;
  private online = false;
  private label = "KIRA";
  private detail: string | null = null;
  private readonly deps: TrayDeps;

  constructor(deps: TrayDeps) {
    this.deps = deps;
  }

  create(): void {
    if (this.tray) return;
    for (const look of Object.keys(TRAY_FILES) as TrayLook[]) {
      const image = loadTemplate(TRAY_FILES[look]);
      if (image) this.images[look] = image;
    }
    const image = this.images.online ?? nativeImage.createEmpty();
    if (image.isEmpty()) log.warn("tray_icon_missing");
    this.tray = new Tray(image);
    if (image.isEmpty()) this.tray.setTitle("KIRA");
    this.tray.setToolTip("KIRA");
    this.tray.on("click", () => this.tray?.popUpContextMenu());
    this.refresh();
  }

  setStatus(online: boolean, label: string, detail: string | null = null): void {
    this.online = online;
    this.label = label;
    this.detail = detail;
    this.refresh();
  }

  refresh(): void {
    if (!this.tray) return;
    const hk = this.deps.hotkeys();
    const dictating = this.deps.isDictating();
    const update = this.deps.update();
    const ready = update.status === "downloaded";
    const look: TrayLook = dictating ? "dictating" : ready ? "update" : this.online ? "online" : "offline";
    if (look !== this.look) {
      const image = this.images[look] ?? this.images.online;
      if (image) this.tray.setImage(image);
      this.look = look;
    }
    // Update ganz oben: bereit → installieren; beim Laden der Fortschritt.
    const updateItems: MenuItemConstructorOptions[] = ready
      ? [{ label: `Update auf ${update.version ?? "neue Version"} installieren (Neustart)`, click: () => this.deps.onInstallUpdate() }, { type: "separator" }]
      : update.status === "downloading"
        ? [{ label: `Update ${update.version ?? ""} wird geladen … ${update.progress ?? 0} %`, enabled: false }, { type: "separator" }]
        : [];
    const template: MenuItemConstructorOptions[] = [
      ...updateItems,
      {
        label: this.online ? `Verbunden mit ${this.label}` : `Offline – ${this.detail ?? "Instanz nicht erreichbar"}`,
        enabled: false,
      },
      { type: "separator" },
      { label: "KIRA öffnen", click: () => this.deps.onOpen() },
      {
        label: `Schnellfenster (${describeAccelerator(hk.quickWindow)})`,
        click: () => this.deps.onQuick(),
      },
      {
        label: `${dictating ? "Diktat stoppen" : "Diktat starten"} (${describeAccelerator(hk.dictation)})`,
        click: () => this.deps.onDictation(),
      },
      { label: "Letztes Diktat kopieren", enabled: this.deps.hasDictation(), click: () => this.deps.onCopyLastDictation() },
      { label: "Diktat-Verlauf…", click: () => this.deps.onDictationHistory() },
      { type: "separator" },
      { label: "Einstellungen…", click: () => this.deps.onSettings() },
      { label: "Nach Updates suchen…", click: () => this.deps.onUpdates() },
      { type: "separator" },
      { label: "KIRA beenden", click: () => this.deps.onQuit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    this.tray.setToolTip(ready ? `KIRA – Update ${update.version ?? ""} bereit` : this.online ? `KIRA – verbunden mit ${this.label}` : "KIRA – offline");
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
