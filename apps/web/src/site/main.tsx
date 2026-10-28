import "@fontsource-variable/inter/opsz.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/ui.css";
import "../styles/shell.css";
import "../styles/screens/overview.css";
import "../styles/screens/site.css";
import "../styles/screens/plans.css";
import "../styles/screens/maintenance.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MAINTENANCE, SiteMaintenancePage } from "./SiteMaintenancePage.tsx";
import { SitePage, SitePlansPage } from "./SitePage.tsx";
import { SitePrivacyPage } from "./SitePrivacyPage.tsx";

/**
 * The public site: its own small bundle, with none of the app's routing, session or data. Its page is
 * chosen by its address, unless whoever serves it marked it down for maintenance.
 */
const page = MAINTENANCE ? "maintenance" : /\/(plans|privacy)\/?$/.exec(location.pathname)?.[1];
createRoot(document.getElementById("root")!).render(
  <StrictMode>{page === "maintenance" ? <SiteMaintenancePage /> : page === "plans" ? <SitePlansPage /> : page === "privacy" ? <SitePrivacyPage /> : <SitePage />}</StrictMode>,
);
