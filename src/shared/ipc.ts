// Kanalnamen der IPC zwischen Hauptprozess und dem Instanz-Preload
// (`window.KiraNative`, Präfix `kira:`). Die Kanäle der lokalen Seiten stehen
// bewusst in einer eigenen Datei (ipc-local.ts): ein Modul, das BEIDE Preloads
// importieren, würde Rollup in einen gemeinsamen Chunk auslagern – und ein
// sandboxed Preload kann keine relativen Dateien nachladen (sein `require`
// kennt nur electron, events, timers, url).

export const IPC = {
  // Instanz-Preload → Hauptprozess (bridge.ts)
  bootstrap: "kira:bootstrap", // sendSync: { allowed, app, capabilities, instance }
  getInfo: "kira:getInfo",
  setSession: "kira:setSession",
  notify: "kira:notify",
  openExternal: "kira:openExternal",
  sttStatus: "kira:sttStatus",
  transcribe: "kira:transcribe",
  // Hauptprozess → Instanz-Preload (CustomEvent "kira:native")
  nativeEvent: "kira:event",
} as const;
