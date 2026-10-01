import "@fontsource-variable/inter/opsz.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/ui.css";
import "../styles/shell.css";
import "../styles/screens/overview.css";
import "../styles/screens/site.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SitePage } from "./SitePage.tsx";

/** The public site: its own small bundle, with none of the app's routing, session or data. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SitePage />
  </StrictMode>,
);
