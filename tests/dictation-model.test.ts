import { describe, expect, it } from "vitest";

import { modelCard } from "../src/renderer/lib/dictation-model";
import { canDownloadAssets, formatModelDiagnostics, IDLE_MODEL_DOWNLOAD, needsAssetDownload } from "../src/shared/dictation-model";
import { type HelperSttStatus } from "../src/shared/helper-types";

const missing: HelperSttStatus = {
  available: false,
  engine: "analyzer",
  assets: "missing",
  downloadable: true,
  code: "assets_missing",
  locale: "de-DE",
  reason: "Diktat-Modell fehlt: Für „de-DE“ ist noch keines installiert.",
  diagnostics: {
    macos: "15.6.1",
    arch: "arm64",
    chip: "Apple M3",
    locale: "de-DE",
    preferred: "de-DE,en-US",
    assetState: "supported",
    speech: "notRequired",
    microphone: "granted",
    downloadable: true,
  },
};

describe("Diktat-Modell: wann laden", () => {
  it("lädt nur, wenn der Analyzer das Paket noch nicht hat", () => {
    expect(needsAssetDownload(missing)).toBe(true);
    expect(needsAssetDownload({ ...missing, available: true, assets: "installed" })).toBe(false);
    expect(needsAssetDownload({ ...missing, engine: "legacy", downloadable: false })).toBe(false);
    expect(needsAssetDownload({ ...missing, assets: "downloading", code: "downloading" })).toBe(true);
  });

  it("behandelt einen älteren Helfer ohne downloadable wie den Analyzer", () => {
    expect(canDownloadAssets({ available: false, engine: "analyzer", assets: "missing" })).toBe(true);
    expect(canDownloadAssets({ available: false, engine: null, assets: "missing" })).toBe(false);
    expect(canDownloadAssets({ available: false, engine: "legacy", assets: "missing", downloadable: false })).toBe(false);
  });
});

describe("Diagnosezeile", () => {
  it("nennt System, Modell und Freigaben", () => {
    const line = formatModelDiagnostics(missing, { arch: "arm64" });
    expect(line).toContain("macOS 15.6.1");
    expect(line).toContain("arm64");
    expect(line).toContain("Apple M3");
    expect(line).toContain("Sprache de-DE");
    expect(line).toContain("Modell supported");
    expect(line).toContain("Mikrofon erteilt");
    expect(line).toContain("Spracherkennung nicht nötig");
    expect(line).toContain("Systemsprache de-DE,en-US");
    expect(line).toContain("Download möglich");
  });

  it("bleibt lesbar, wenn der Helfer nichts gemeldet hat", () => {
    expect(formatModelDiagnostics(null, { macos: "26.0", arch: "x86_64", chip: "Intel" })).toContain("x86_64");
    expect(formatModelDiagnostics(null, { macos: "26.0" })).toContain("Modell unbekannt");
  });
});

describe("Karte in den Einstellungen", () => {
  const base = {
    helperRunning: true,
    helperError: null,
    language: "Deutsch (Deutschland)",
    chip: "Apple M3",
    macos: "15.6.1",
    localeCount: 4,
    offline: false,
    download: { ...IDLE_MODEL_DOWNLOAD },
  };

  it("bietet den Download an, solange das Modell fehlt", () => {
    const card = modelCard({ ...base, stt: missing });
    expect(card.title).toBe("Diktat-Modell fehlt");
    expect(card.showDownload).toBe(true);
    expect(card.downloadLabel).toBe("Modell laden");
    expect(card.detail).toContain("noch keines installiert");
  });

  it("zeigt Fortschritt und danach den fertigen Stand", () => {
    const loading = modelCard({
      ...base,
      stt: { ...missing, assets: "downloading" },
      download: { phase: "downloading", progress: 40, error: null, locale: "de-DE" },
    });
    expect(loading.title).toBe("Diktat-Modell wird geladen");
    expect(loading.detail).toContain("40 %");
    expect(loading.downloading).toBe(true);
    expect(loading.showDownload).toBe(false);

    const ready = modelCard({ ...base, stt: { ...missing, available: true, assets: "installed", code: "ok" } });
    expect(ready.tone).toBe("ok");
    expect(ready.detail).toContain("Diktat-Modell Deutsch (Deutschland) geladen");
  });

  it("nennt die Ursache und bietet Erneut laden", () => {
    const card = modelCard({
      ...base,
      offline: true,
      stt: missing,
      download: {
        phase: "failed",
        progress: 10,
        error: "Das Diktat-Modell für „de-DE“ konnte nicht geladen werden: keine Verbindung zu Apple (NSURLErrorDomain -1009).",
        locale: "de-DE",
      },
    });
    expect(card.tone).toBe("err");
    expect(card.downloadLabel).toBe("Erneut laden");
    expect(card.detail).toContain("keine Verbindung zu Apple");
    expect(card.detail).toContain("Ohne Internet");
  });

  it("versteckt den Download, wenn dieser macOS ihn nicht kann", () => {
    const card = modelCard({
      ...base,
      stt: {
        available: false,
        engine: null,
        assets: "missing",
        downloadable: false,
        code: "unsupported_os",
        reason: "Diktat-Modell fehlt: Dieser Mac (Intel, x86_64, macOS 14.6) hat keinen Apple-Chip.",
      },
    });
    expect(card.showDownload).toBe(false);
    expect(card.title).toBe("Spracherkennung nicht verfügbar");
    expect(card.detail).toContain("keinen Apple-Chip");
  });
});
