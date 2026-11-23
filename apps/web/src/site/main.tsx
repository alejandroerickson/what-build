import "@fontsource-variable/inter/opsz.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/ui.css";
import "../styles/shell.css";
import "../styles/screens/overview.css";
import "../styles/screens/site.css";
import "../styles/screens/plans.css";
import "../styles/screens/maintenance.css";
import "../styles/screens/landing.css";
import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { MAINTENANCE, SiteMaintenancePage } from "./SiteMaintenancePage.tsx";
import { LandingOneLine, LandingWindow } from "./landing/Landing.tsx";
import { SitePlansPage } from "./SitePage.tsx";
import { SitePrivacyPage } from "./SitePrivacyPage.tsx";

/**
 * The public site: its own small bundle, with none of the app's routing, session or data. Its page is
 * chosen by its address, unless whoever serves it marked it down for maintenance.
 */
const page = MAINTENANCE ? "maintenance" : /\/(plans|privacy|what-to-build)\/?$/.exec(location.pathname)?.[1];
const PAGES: Record<string, ComponentType> = { maintenance: SiteMaintenancePage, plans: SitePlansPage, privacy: SitePrivacyPage, "what-to-build": LandingWindow };
const Page = (page && PAGES[page]) || LandingOneLine;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
