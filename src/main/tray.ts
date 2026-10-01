// Menüleisten-Symbol: Status (verbunden/offline), Öffnen, Schnellfenster,
// Diktat starten/stoppen, Einstellungen, Nach Updates suchen, Beenden.

import { Menu, type MenuItemConstructorOptions, Tray, nativeImage } from "electron";

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
}

export class TrayController {
  private tray: Tray | null = null;
  private online = false;
  private label = "KIRA";
  private detail: string | null = null;
  private readonly deps: TrayDeps;

  constructor(deps: TrayDeps) {
    this.deps = deps;
  }

  create(): void {
    if (this.tray) return;
    let image = nativeImage.createFromPath(resourcePath("tray", "kiraTemplate.png"));
    if (image.isEmpty()) {
      log.warn("tray_icon_missing");
      image = nativeImage.createEmpty();
    } else {
      image.setTemplateImage(true);
    }
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
    const template: MenuItemConstructorOptions[] = [
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
      { type: "separator" },
      { label: "Einstellungen…", click: () => this.deps.onSettings() },
      { label: "Nach Updates suchen…", click: () => this.deps.onUpdates() },
      { type: "separator" },
      { label: "KIRA beenden", click: () => this.deps.onQuit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    this.tray.setToolTip(this.online ? `KIRA – verbunden mit ${this.label}` : "KIRA – offline");
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
