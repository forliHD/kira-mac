import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../styles/base.css";
import "../styles/glass.css";
import "./settings.css";
import { installDevMock } from "../lib/dev-mock";
import { App } from "./App";

installDevMock("settings");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
