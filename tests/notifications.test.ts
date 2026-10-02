import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mitteilungs-Stream ohne Anmeldung (Live 02.10.): Statt den Server alle
// 10–20 s anzufragen, wartet der Stream auf loginChanged() – die
// Verbindungsprüfung (reconnectNow im Minutentakt) weckt ihn nicht.

vi.mock("electron", () => ({ Notification: class {} }));
vi.mock("../src/main/log", () => ({
  scoped: () => ({ debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined }),
}));

import { LOGIN_WAIT_MS, NotificationClient } from "../src/main/notifications";
import { type Session } from "../src/main/session";

function fakeSession(status: () => number) {
  const calls: string[] = [];
  const respond = async (path: string): Promise<Response> => {
    calls.push(path);
    return new Response("{}", { status: status() });
  };
  const session = {
    fetchWithSessionRetry: vi.fn(respond),
    fetch: vi.fn(respond),
    requestFreshSession: vi.fn(async () => false),
  } as unknown as Session;
  return { session, calls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("NotificationClient ohne Anmeldung", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("wartet auf loginChanged statt im Takt anzufragen", async () => {
    let status = 401;
    const { session, calls } = fakeSession(() => status);
    const client = new NotificationClient({
      session,
      deviceId: "dev-1",
      isMainFocused: () => false,
      showMain: () => undefined,
      sendToDashboard: () => false,
      navigateFallback: () => undefined,
    });
    client.start();
    await flush();
    expect(calls).toEqual(["/api/push/subscribe"]); // kein Stream-Versuch mit 401
    expect(client.isWaitingForLogin).toBe(true);

    // Die Verbindungsprüfung (jede Minute) weckt nicht.
    client.reconnectNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);

    // Anmeldung → sofort neuer Versuch.
    status = 200;
    client.loginChanged();
    await flush();
    expect(client.isWaitingForLogin).toBe(false);
    expect(calls.slice(0, 3)).toEqual(["/api/push/subscribe", "/api/push/subscribe", "/api/push/stream?endpoint=kira-app%3A%2F%2Fdev-1"]);
    await client.stop();
  });

  it("versucht es nach der Wartezeit still noch einmal", async () => {
    const { session, calls } = fakeSession(() => 401);
    const client = new NotificationClient({
      session,
      deviceId: "dev-2",
      isMainFocused: () => false,
      showMain: () => undefined,
      sendToDashboard: () => false,
      navigateFallback: () => undefined,
    });
    client.start();
    await flush();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LOGIN_WAIT_MS - 1_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(calls).toHaveLength(2);
    await client.stop();
  });
});
