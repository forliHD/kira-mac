// Teil von `window.KiraLocal` für lokale Seiten, die im HAUPTFENSTER laden
// (die Offline-Seite): Das Hauptfenster hat den Instanz-Preload, der deshalb
// auf file://-Seiten der App diesen Teil bereitstellt.
//
// Die Kanalnamen stehen hier als Literale und NICHT als Import aus
// shared/ipc-local.ts: Ein von beiden Preloads importiertes Modul würde Rollup
// in einen gemeinsamen Chunk legen, und ein Sandbox-Preload kann keine
// relativen Chunks laden. tests/preload-local-subset.test.ts hält die
// Literale mit LOCAL_IPC gleich.

import { type KiraLocalApi, type LocalEvent, type LocalState } from "../shared/local-api";

export const SUBSET_CHANNELS = {
  getState: "local:getState",
  retry: "local:retry",
  openSettings: "local:openSettings",
  openMain: "local:openMain",
  openLink: "local:openLink",
  event: "local:event",
} as const;

export type OfflinePageApi = Pick<KiraLocalApi, "getState" | "retry" | "openSettings" | "openMain" | "openLink" | "on">;

export interface SubsetIo {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  subscribe: (channel: string, handler: (payload: unknown) => void) => () => void;
}

export function createLocalSubset(io: SubsetIo): OfflinePageApi {
  return {
    getState: () => io.invoke(SUBSET_CHANNELS.getState) as Promise<LocalState>,
    retry: () => io.invoke(SUBSET_CHANNELS.retry) as Promise<void>,
    openSettings: () => io.invoke(SUBSET_CHANNELS.openSettings) as Promise<void>,
    openMain: () => io.invoke(SUBSET_CHANNELS.openMain) as Promise<void>,
    openLink: (url: string) => io.invoke(SUBSET_CHANNELS.openLink, url) as Promise<void>,
    on: (listener: (event: LocalEvent) => void) =>
      io.subscribe(SUBSET_CHANNELS.event, (payload) => {
        if (payload && typeof payload === "object" && typeof (payload as LocalEvent).type === "string") listener(payload as LocalEvent);
      }),
  };
}

/** Lokale Seite der App (gepackt file://…/out/renderer/<seite>/index.html,
 *  in der Entwicklung der Vite-Server)? Andere file://-Seiten bekommen nichts. */
export function isLocalAppPage(href: string, devServer: string | undefined): boolean {
  if (href.startsWith("file://")) return /\/out\/renderer\/[a-z]+\/index\.html(?:[?#].*)?$/.test(href);
  return Boolean(devServer && href.startsWith(devServer));
}
