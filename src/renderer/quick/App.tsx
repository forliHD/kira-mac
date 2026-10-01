// Platzhalter – die Oberfläche des Schnellfensters entsteht nach dem Design
// (Liquid Glass, siehe docs/design/…). Zustand kommt per `local:event` "quick".
import { type ReactNode } from "react";

export function App(): ReactNode {
  return <main className="k-drag h-screen" />;
}
