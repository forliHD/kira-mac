import { defineConfig } from "vitest/config";

// Die getesteten Module (sse, instance, helper, dictation, preload/api,
// shared/*) importieren bewusst kein `electron` – so laufen die Tests ohne
// Electron-Binärdatei in Node.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
