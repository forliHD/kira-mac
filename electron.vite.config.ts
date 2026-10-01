import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Drei Bündel: Hauptprozess (CommonJS, Node), zwei Preloads (Instanz-Seiten
// bekommen `index`, lokale Seiten `local`) und die lokalen React-Seiten.
// Die Ausgabe landet unter out/{main,preload,renderer}.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          local: resolve(__dirname, "src/preload/local.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [tailwindcss()],
    // Kein @vitejs/plugin-react: der Fast-Refresh-Preamble ist ein Inline-Skript
    // und bräuchte `unsafe-inline` in der CSP der lokalen Seiten. esbuild setzt
    // den automatischen JSX-Runtime von React 19 auch ohne Plugin.
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    build: {
      rollupOptions: {
        input: {
          onboarding: resolve(__dirname, "src/renderer/onboarding/index.html"),
          settings: resolve(__dirname, "src/renderer/settings/index.html"),
          hud: resolve(__dirname, "src/renderer/hud/index.html"),
          offline: resolve(__dirname, "src/renderer/offline/index.html"),
          quick: resolve(__dirname, "src/renderer/quick/index.html"),
        },
      },
    },
  },
});
