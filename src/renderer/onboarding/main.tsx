import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../styles/base.css";
import "../styles/glass.css";
import "./onboarding.css";
import { installDevMock } from "../lib/dev-mock";
import { App } from "./App";

installDevMock("onboarding");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
