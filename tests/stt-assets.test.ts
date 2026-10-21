import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { SttAssets, type SttAssetClient } from "../src/main/stt-assets";
import { type HelperEvent, type HelperSttStatus } from "../src/shared/helper-types";
import { type Logger } from "../src/shared/logger";

class FakeHelper extends EventEmitter implements SttAssetClient {
  readonly calls: string[] = [];
  status: HelperSttStatus = {
    available: false,
    engine: "analyzer",
    assets: "missing",
    downloadable: true,
    locale: "de-DE",
    reason: "Diktat-Modell fehlt: Für „de-DE“ ist noch keines installiert.",
    diagnostics: {
      macos: "26.1",
      arch: "arm64",
      chip: "Apple M4",
      locale: "de-DE",
      assetState: "supported",
      speech: "notRequired",
      microphone: "denied",
      downloadable: true,
    },
  };
  prepareError: string | null = null;
  /** Hält prepare auf, damit ein zweiter Aufruf denselben Lauf trifft. */
  gate: Promise<void> | null = null;
  release: (() => void) | null = null;

  request<T = unknown>(cmd: string): Promise<T> {
    this.calls.push(cmd);
    if (cmd === "stt.status") return Promise.resolve(this.status as unknown as T);
    if (cmd === "stt.prepare") {
      if (this.prepareError) return Promise.reject(new Error(this.prepareError));
      const finish = (): T => {
        this.status = { ...this.status, available: true, assets: "installed", code: "ok", reason: undefined };
        return { assets: "installed" } as unknown as T;
      };
      if (this.gate) return this.gate.then(() => finish());
      this.emit("event", { event: "stt.progress", data: { locale: "de-DE", fraction: 0.4 } });
      return Promise.resolve(finish());
    }
    return Promise.resolve({} as T);
  }

  hold(): void {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  override on(event: "event", listener: (ev: HelperEvent) => void): this {
    return super.on(event, listener);
  }

  override off(event: "event", listener: (ev: HelperEvent) => void): this {
    return super.off(event, listener);
  }
}

function logger(): { log: Logger; lines: Array<{ level: string; event: string; data?: Record<string, unknown> }> } {
  const lines: Array<{ level: string; event: string; data?: Record<string, unknown> }> = [];
  const push = (level: string) => (event: string, data?: unknown) => {
    lines.push({ level, event, data: data as Record<string, unknown> | undefined });
  };
  return { log: { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") }, lines };
}

describe("SttAssets", () => {
  it("lädt ein fehlendes Modell, meldet Fortschritt und protokolliert die Diagnose", async () => {
    const helper = new FakeHelper();
    const { log, lines } = logger();
    const assets = new SttAssets(helper, log);
    const seen: number[] = [];
    assets.on("change", (download) => {
      if (download.progress !== null) seen.push(download.progress);
    });
    await assets.ensure("de-DE");
    expect(helper.calls.filter((c) => c === "stt.prepare")).toHaveLength(1);
    expect(assets.snapshot().phase).toBe("idle");
    expect(seen).toContain(40);
    const model = lines.find((l) => l.event === "dictation_model");
    expect(model?.data).toMatchObject({
      locale: "de-DE",
      assets: "missing",
      arch: "arm64",
      chip: "Apple M4",
      macos: "26.1",
      microphone: "denied",
      assetState: "supported",
    });
  });

  it("teilt einen laufenden Download und versucht automatisch nur einmal", async () => {
    const helper = new FakeHelper();
    helper.hold();
    const assets = new SttAssets(helper);
    const first = assets.download("de-DE");
    const second = assets.download("de-DE");
    helper.release?.();
    await Promise.all([first, second]);
    expect(helper.calls.filter((c) => c === "stt.prepare")).toHaveLength(1);

    helper.status = { ...helper.status, available: false, assets: "missing", reason: "Diktat-Modell fehlt." };
    helper.prepareError = "Das Diktat-Modell für „de-DE“ konnte nicht geladen werden: macOS hat den Zugriff verweigert (NSCocoaErrorDomain 257).";
    await assets.ensureAutomatic("de-DE");
    await assets.ensureAutomatic("de-DE");
    expect(helper.calls.filter((c) => c === "stt.prepare")).toHaveLength(2);
    expect(assets.snapshot().phase).toBe("failed");
    expect(assets.snapshot().error).toMatch(/Zugriff verweigert/);
  });

  it("lässt ein installiertes Modell in Ruhe und wirft, wenn kein Download möglich ist", async () => {
    const helper = new FakeHelper();
    helper.status = { available: true, engine: "analyzer", assets: "installed", downloadable: true, locale: "de-DE" };
    const assets = new SttAssets(helper);
    await assets.ensure("de-DE");
    expect(helper.calls).toEqual(["stt.status"]);

    helper.status = {
      available: false,
      engine: null,
      assets: "missing",
      downloadable: false,
      reason: "Diktat-Modell fehlt: Dieser Mac hat keinen Apple-Chip.",
    };
    await expect(assets.ensure("de-DE")).rejects.toThrow(/keinen Apple-Chip/);
    expect(helper.calls.filter((c) => c === "stt.prepare")).toHaveLength(0);
  });

  it("gibt den Fortschritt an den Aufrufer weiter", async () => {
    const helper = new FakeHelper();
    const assets = new SttAssets(helper);
    const onProgress = vi.fn();
    await assets.ensure("de-DE", onProgress);
    expect(onProgress).toHaveBeenCalledWith(0.4);
  });
});
