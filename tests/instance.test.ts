import { describe, expect, it } from "vitest";

import {
  compareVersions,
  describeResolveFailure,
  instanceCandidates,
  instanceOrigins,
  isInstanceUrl,
  normalizeInstanceUrl,
  originOf,
  probeHealth,
  resolveInstance,
  sameOrigin,
  serverHasBridge,
} from "../src/main/instance";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("normalizeInstanceUrl", () => {
  it("macht aus Hostnamen eine https-Origin, aus LAN-Adressen http", () => {
    expect(normalizeInstanceUrl("kira.example.de")).toBe("https://kira.example.de");
    expect(normalizeInstanceUrl("192.168.178.166")).toBe("http://192.168.178.166");
    expect(normalizeInstanceUrl("10.0.0.5:8420")).toBe("http://10.0.0.5:8420");
    expect(normalizeInstanceUrl("kira.local")).toBe("http://kira.local");
    expect(normalizeInstanceUrl("localhost:8420")).toBe("http://localhost:8420");
  });

  it("behält ein explizites Schema und wirft Pfad, Query und Fragment weg", () => {
    expect(normalizeInstanceUrl("https://192.168.178.166/chat?x=1#y")).toBe("https://192.168.178.166");
    expect(normalizeInstanceUrl("http://Kira.Example.DE/")).toBe("http://kira.example.de");
    expect(normalizeInstanceUrl("  https://kira.example.de/  ")).toBe("https://kira.example.de");
  });

  it("lehnt Nicht-http(s), Zugangsdaten und Leeres ab", () => {
    expect(normalizeInstanceUrl("")).toBeNull();
    expect(normalizeInstanceUrl(null)).toBeNull();
    expect(normalizeInstanceUrl("ftp://kira.example.de")).toBeNull();
    expect(normalizeInstanceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeInstanceUrl("https://user:pw@kira.example.de")).toBeNull();
    expect(normalizeInstanceUrl("nicht eine url")).toBeNull();
  });
});

describe("Origin-Vergleich", () => {
  const origins = ["http://192.168.178.166", "https://kira.example.de"];

  it("sameOrigin vergleicht Schema, Host und Port", () => {
    expect(sameOrigin("https://kira.example.de/chat", "https://KIRA.example.de")).toBe(true);
    expect(sameOrigin("http://kira.example.de", "https://kira.example.de")).toBe(false);
    expect(sameOrigin("https://kira.example.de:8443", "https://kira.example.de")).toBe(false);
    expect(sameOrigin(null, "https://kira.example.de")).toBe(false);
  });

  it("isInstanceUrl erkennt beide Instanz-Origins und nichts anderes", () => {
    expect(isInstanceUrl("http://192.168.178.166/documents/3", origins)).toBe(true);
    expect(isInstanceUrl("https://kira.example.de/chat", origins)).toBe(true);
    expect(isInstanceUrl("https://evil.example.de/", origins)).toBe(false);
    expect(isInstanceUrl("https://kira.example.de.evil.com/", origins)).toBe(false);
    expect(isInstanceUrl("blob:https://kira.example.de/uuid", origins)).toBe(false);
    expect(isInstanceUrl("file:///Users/x/out/renderer/settings/index.html", origins)).toBe(false);
    expect(isInstanceUrl("", origins)).toBe(false);
  });

  it("originOf liefert nur http(s)-Origins", () => {
    expect(originOf("https://kira.example.de/x")).toBe("https://kira.example.de");
    expect(originOf("blob:https://kira.example.de/uuid")).toBeNull();
    expect(originOf("about:blank")).toBeNull();
  });
});

describe("Kandidaten und Versionen", () => {
  it("ordnet intern vor extern und lässt Duplikate weg", () => {
    const cands = instanceCandidates({ internalUrl: "192.168.178.166", externalUrl: "https://kira.example.de" });
    expect(cands).toEqual([
      { kind: "internal", origin: "http://192.168.178.166" },
      { kind: "external", origin: "https://kira.example.de" },
    ]);
    expect(instanceOrigins({ internalUrl: "https://kira.example.de", externalUrl: "kira.example.de" })).toEqual(["https://kira.example.de"]);
    expect(instanceCandidates({ internalUrl: null, externalUrl: null })).toEqual([]);
  });

  it("vergleicht Versionen numerisch und erkennt die Brücke ab 3.297.0", () => {
    expect(compareVersions("3.297.0", "3.296.1")).toBe(1);
    expect(compareVersions("3.10.0", "3.9.9")).toBe(1);
    expect(compareVersions("3.297.0", "3.297.0")).toBe(0);
    expect(serverHasBridge("3.297.0")).toBe(true);
    expect(serverHasBridge("3.300.2")).toBe(true);
    expect(serverHasBridge("3.296.1")).toBe(false);
    expect(serverHasBridge(null)).toBe(false);
    expect(serverHasBridge("dev")).toBe(false);
  });
});

describe("probeHealth", () => {
  it("liest die Version aus /api/health", async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      expect(url).toBe("http://192.168.178.166/api/health");
      return jsonResponse(200, { status: "healthy", version: "3.297.0" });
    };
    const p = await probeHealth("http://192.168.178.166", fetchImpl);
    expect(p.ok).toBe(true);
    expect(p.version).toBe("3.297.0");
    expect(p.error).toBeNull();
  });

  it("meldet 503 als nicht bereit und Netzfehler mit deutscher Ursache", async () => {
    const down = await probeHealth("http://x", async () => jsonResponse(503, { status: "unhealthy", version: "3.297.0" }));
    expect(down.ok).toBe(false);
    expect(down.error).toMatch(/nicht bereit/);
    const refused = await probeHealth("http://x", async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/abgelehnt/);
  });

  it("wertet eine Access-Umleitung (302/401/403) als erreichbar", async () => {
    const p = await probeHealth("https://kira.example.de", async () => new Response("", { status: 403 }));
    expect(p.ok).toBe(true);
    expect(p.version).toBeNull();
  });

  it("bricht nach dem Zeitlimit ab", async () => {
    const p = await probeHealth(
      "http://x",
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      30,
    );
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/Keine Antwort/);
  });
});

describe("resolveInstance", () => {
  const cands = [
    { kind: "internal" as const, origin: "http://192.168.178.166" },
    { kind: "external" as const, origin: "https://kira.example.de" },
  ];

  it("nimmt intern, wenn beide antworten", async () => {
    const r = await resolveInstance(cands, async () => jsonResponse(200, { version: "3.297.0" }));
    expect(r.resolved?.kind).toBe("internal");
    expect(r.resolved?.serverHasBridge).toBe(true);
  });

  it("fällt auf extern zurück, wenn intern nicht erreichbar ist", async () => {
    const r = await resolveInstance(cands, async (url) => {
      if (url.startsWith("http://192.168")) throw new Error("ENETUNREACH");
      return jsonResponse(200, { version: "3.296.1" });
    });
    expect(r.resolved?.kind).toBe("external");
    expect(r.resolved?.serverHasBridge).toBe(false);
    expect(r.probes[0]?.error).toMatch(/nicht erreichbar/);
  });

  it("liefert null und eine Begründung, wenn keiner antwortet", async () => {
    const r = await resolveInstance(cands, async () => {
      throw new Error("ENOTFOUND");
    });
    expect(r.resolved).toBeNull();
    expect(describeResolveFailure(r)).toMatch(/^Instanz nicht erreichbar: intern http:\/\/192\.168\.178\.166: .*; extern https:\/\/kira\.example\.de: /);
  });
});
