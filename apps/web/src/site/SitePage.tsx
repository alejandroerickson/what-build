import { useEffect, useState, type ReactNode } from "react";
import { pageView, startAnalytics, useCookieChoice } from "../lib/analytics.ts";
import { api } from "../lib/api.ts";
import { BrandMark } from "../shell/brand.tsx";
import { CookieChoice } from "../shell/CookieChoice.tsx";
import { buttonClass } from "../ui/button.tsx";
import { Callout } from "../ui/feedback.tsx";
import { Sheet } from "../ui/layout.tsx";
import { LIMITS } from "@whatbuild/core/plans";
import type { PlansCatalogue } from "../lib/limits.ts";
import { PlanComparison } from "../routes/plan-comparison.tsx";

/** The Google Analytics measurement ID, which whoever serves the page writes into it; null for none. */
export const ANALYTICS_ID = document.querySelector<HTMLMetaElement>('meta[name="whatbuild-analytics"]')?.content || null;

/** What the privacy page says that only the deployment knows (`privacy` in `/api/v1/plans`). */
export interface SitePrivacy {
  operator: string | null;
  contact: string | null;
  /** Who else handles it, as a paragraph the deployment wrote; null when it has said nothing. */
  providers: string | null;
  /** Whether the app loads Google Analytics for those who accept it. */
  analytics: boolean;
}

/**
 * What only the deployment knows of its plans, its guests and who runs it (`/api/v1/plans`), which
 * whoever serves the page writes into it, so a visit asks the service nothing; null when it wrote nothing.
 */
const WRITTEN:
  | (PlansCatalogue & {
      guests?: { self_serve: boolean; open: boolean };
      /** Whether anyone may make an account, as a guest or to start an organization. */
      sign_up?: boolean;
      /** The bot check's site key, for the waitlist's form; null where the deployment asks for none. */
      bot_check?: { site_key: string } | null;
      /** The example organization, as the deployment describes it: its name, its first product and that product's first sentence. */
      example_about?: { organization: string; product: string; about: string } | null;
      privacy?: SitePrivacy;
    })
  | null = (() => {
  try {
    const raw = document.querySelector<HTMLMetaElement>('meta[name="whatbuild-site"]')?.content;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
})();

/**
 * The plans, guests and privacy facts as the deployment has them: written into the page, or in
 * development, where Vite serves the page and writes nothing, asked of the local server. They are
 * the deployment's alone, so a page that could not be told them shows none.
 */
export function useSite() {
  const [site, setSite] = useState(WRITTEN);
  useEffect(() => {
    if (!site && import.meta.env.DEV) api<NonNullable<typeof WRITTEN>>("GET", "/api/v1/plans").then(setSite, () => {});
  }, [site]);
  return site;
}

/** The theme the system asks for, kept current: the site has no setting for it. */
export function useSystemTheme(follow = true) {
  useEffect(() => {
    if (!follow) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.setAttribute("data-theme", media.matches ? "dark" : "light");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [follow]);
}

/** Analytics once a visitor accepts, and the cookie notice, which every page of the site carries. */
export function useSiteCookies() {
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const choice = useCookieChoice();
  const accepted = Boolean(ANALYTICS_ID) && choice === "accepted";
  useEffect(() => {
    if (!accepted || !ANALYTICS_ID) return;
    startAnalytics(ANALYTICS_ID);
    pageView(location.pathname);
  }, [accepted]);
  const notice = ANALYTICS_ID ? (
    <CookieChoice
      lead="Analytics cookies?"
      ask="They show us how this site is used. A cookie remembers your answer either way."
      link={
        <a href="/cookies" className={buttonClass("quiet", "sm")}>
          Cookies
        </a>
      }
      open={cookiesOpen}
      onClose={() => setCookiesOpen(false)}
    />
  ) : null;
  return { openCookies: () => setCookiesOpen(true), notice };
}

/** The site's footer: signing in, its other pages, the cookie question and the source. */
export function SiteFoot({ className, home, explore, onCookies }: { className?: string; home?: boolean; explore?: boolean; onCookies: () => void }) {
  const site = useSite();
  return (
    <footer className={className ? `site-foot ${className}` : "site-foot"}>
      <span>
        {explore ? "Been here before?" : "Already invited?"} <a href="/signin">Sign in</a>
      </span>
      <span className="site-foot-end">
        {home ? site?.plans?.length ? <a href={sitePath("plans")}>Plans</a> : null : <a href={sitePath("")}>WhatBuild</a>}
        <a href={sitePath("privacy")}>Privacy</a>
        {ANALYTICS_ID ? (
          <button type="button" className="site-foot-link" onClick={onCookies}>
            Cookies
          </button>
        ) : null}
        <a href="https://github.com/alejandroerickson/what-build">Source on GitHub</a>
      </span>
    </footer>
  );
}

/**
 * What the site's plans and privacy pages share: the canvas without the app's panel, the theme the
 * system asks for, analytics once a visitor accepts, and the footer.
 */
export function SiteFrame({ children, home, explore }: { children: ReactNode; home?: boolean; explore?: boolean }) {
  useSystemTheme();
  const { openCookies, notice } = useSiteCookies();
  return (
    <div className="site">
      <main id="main" className="overview site-main">
        {children}
        <SiteFoot home={home} explore={explore} onCookies={openCookies} />
      </main>
      {notice}
    </div>
  );
}

/**
 * A page of the site by name, wherever the site is served: at its own domain's root, or under
 * /site/ on the app's origin when the deployment names no site domain (as in development).
 */
export function sitePath(page: "" | "plans" | "privacy" | "what-to-build"): string {
  const base = location.pathname.startsWith("/site/") ? "/site/" : "/";
  return page ? `${base}${page}/` : base;
}

/**
 * The site's plans page: the plans side by side in the few numbers anyone reads at a glance, every
 * limit behind a disclosure, and the way to hear when WhatBuild opens.
 */
export function SitePlansPage() {
  const site = useSite();
  useEffect(() => {
    document.title = "Plans · WhatBuild";
  }, []);
  const plans = site?.plans ?? [];
  const explore = Boolean(site?.guests?.self_serve && site.guests.open);
  return (
    <SiteFrame explore={explore}>
      <Sheet className="site-plans-intro" labelledBy="plans-title">
        <a href={sitePath("")} className="site-lockup" aria-label="WhatBuild, home">
          <BrandMark size={22} />
          <span>WhatBuild</span>
        </a>
        <h1 id="plans-title" className="site-plans-title">
          Plans
        </h1>
        <p className="site-plans-lede">
          {plans.length > 1 ? `Start on ${plans[0]!.name}, and move your team to ${plans[1]!.name} when it’s ready. ` : ""}Every plan works with the agent you already use:
          WhatBuild runs no AI of its own, so there are no credits to buy.
        </p>
      </Sheet>
      <Sheet labelledBy="plans-compare-title">
        <h2 id="plans-compare-title" className="visually-hidden">
          The plans side by side
        </h2>
        <PlanComparison plans={plans} limits={site?.limits ?? LIMITS} fileMaxBytes={site?.file_max_bytes ?? Number.POSITIVE_INFINITY} />
      </Sheet>
      {explore ? (
        <Callout tone="info" title="Try it first">
          Sign in and explore the demo as a guest: read it, search it and point your agent at it.{" "}
          <a href="/signin?next=%2F">Explore the example</a>. People are let in a few at a time; <a href={`${sitePath("")}#start`}>hear when you can start</a>.
        </Callout>
      ) : (
        <Callout tone="info" title="In private preview">
          People are let in a few at a time. <a href={`${sitePath("")}#start`}>Hear when you can start</a>.
        </Callout>
      )}
    </SiteFrame>
  );
}
