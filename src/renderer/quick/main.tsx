import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../styles/base.css";
import "./quick.css";
import { App } from "./App";

/**
 * Vorschau ohne App (Browser, Bildschirmfotos): Attrappe von `window.KiraLocal`
 * aus dev-mock.ts – nur, wenn die Brücke fehlt (in der App stellt der Preload
 * sie immer bereit) und nur im Entwicklungsserver oder mit `?mock=…`.
 */
async function boot(): Promise<void> {
  if (!window.KiraLocal && (import.meta.env.DEV || new URLSearchParams(location.search).has("mock"))) {
    const { installQuickMock } = await import("./dev-mock");
    installQuickMock(new URLSearchParams(location.search));
  }
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
