import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { pageView, startAnalytics, useCookieChoice } from "../lib/analytics.ts";
import { api } from "../lib/api.ts";
import { BrandMark } from "../shell/brand.tsx";
import { CookieChoice } from "../shell/CookieChoice.tsx";
import { Journey } from "../shell/journey.tsx";
import { Button, buttonClass } from "../ui/button.tsx";
import { Callout, ErrorCallout } from "../ui/feedback.tsx";
import { FormGrid, TextArea, TextField } from "../ui/field.tsx";
import { Glyph } from "../ui/glyph.tsx";
import { Sheet, SheetBody, SheetHeader } from "../ui/layout.tsx";
import { LIMITS } from "@whatbuild/core/plans";
import type { PlansCatalogue } from "../lib/limits.ts";
import { PlanComparison } from "../routes/plan-comparison.tsx";

const EMPTY = { email: "", name: "", organization: "", note: "", website: "" };

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
const WRITTEN: (PlansCatalogue & { guests?: { self_serve: boolean; open: boolean }; privacy?: SitePrivacy }) | null = (() => {
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

/**
 * What every page of the public site shares: the canvas without the app's panel, the theme the
 * system asks for, analytics once a visitor accepts, and the footer.
 */
export function SiteFrame({ children, home, explore }: { children: ReactNode; home?: boolean; explore?: boolean }) {
  const site = useSite();
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const choice = useCookieChoice();
  const accepted = Boolean(ANALYTICS_ID) && choice === "accepted";

  // The theme follows the system here: the site has no setting for it.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.setAttribute("data-theme", media.matches ? "dark" : "light");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!accepted || !ANALYTICS_ID) return;
    startAnalytics(ANALYTICS_ID);
    pageView(location.pathname);
  }, [accepted]);

  return (
    <div className="site">
      <main id="main" className="overview site-main">
        {children}
        <footer className="site-foot">
          <span>
            {explore ? "Been here before?" : "Already invited?"} <a href="/signin">Sign in</a>
          </span>
          <span className="site-foot-end">
            {home ? site?.plans?.length ? <a href={sitePath("plans")}>Plans</a> : null : <a href={sitePath("")}>WhatBuild</a>}
            <a href={sitePath("privacy")}>Privacy</a>
            {ANALYTICS_ID ? (
              <button type="button" className="site-foot-link" onClick={() => setCookiesOpen(true)}>
                Cookies
              </button>
            ) : null}
            <a href="https://github.com/alejandroerickson/what-build">Source on GitHub</a>
          </span>
        </footer>
      </main>
      {ANALYTICS_ID ? (
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
      ) : null}
    </div>
  );
}

/**
 * A page of the site by name, wherever the site is served: at its own domain's root, or under
 * /site/ on the app's origin when the deployment names no site domain (as in development).
 */
export function sitePath(page: "" | "plans" | "privacy"): string {
  const base = location.pathname.startsWith("/site/") ? "/site/" : "/";
  return page ? `${base}${page}/` : base;
}

/**
 * The public site's front page, at the site's own domain: the overview's intro, then a form to hear
 * when WhatBuild opens. Everything else on that domain belongs to the app, so "Sign in" is a plain
 * link the server sends on to it.
 */
export function SitePage() {
  const site = useSite();
  // While anyone may sign up as a guest, the way in is to explore the example; the form is for a team's own organization.
  const explore = Boolean(site?.guests?.self_serve && site.guests.open);
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" } | { status: "error"; error: unknown }>({ status: "idle" });
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ status: "sending" });
    try {
      await api("POST", "/api/v1/interest", form);
      setState({ status: "sent" });
    } catch (error) {
      setState({ status: "error", error });
    }
  };

  return (
    <SiteFrame home explore={explore}>
        <Sheet className="overview-intro" labelledBy="site-title">
          <div className="overview-head">
            <h1 id="site-title" className="overview-lockup">
              <BrandMark size={34} />
              <span>WhatBuild</span>
            </h1>
          </div>
          <div className="overview-pitch">
            <p className="overview-question">What to build?</p>
            <p className="overview-tagline">Product discovery at the speed of AI Engineering.</p>
            <p className="overview-about">
              WhatBuild accelerates collaborative agentic discovery, facilitates alignment, and tells the story of your build. At the
              finish line, WhatBuild provides context to your ticket-creation agent so that your team can hit the ground running.
            </p>
            {explore ? (
              <span className="site-ways-in">
                <a href="/signin?next=%2F" className="overview-agent-link">
                  <Glyph name="arrow-right" size="sm" />
                  Explore a real discovery
                </a>
                <a href="#interest" className="site-quiet-link">
                  Start your team&rsquo;s own
                </a>
              </span>
            ) : (
              <a href="#interest" className="overview-agent-link">
                <Glyph name="arrow-right" size="sm" />
                Hear when it opens
              </a>
            )}
          </div>
          <Journey />
        </Sheet>

        <Sheet className="site-interest" labelledBy="interest-title">
          <span id="interest" className="site-anchor" />
          <SheetHeader level={2} id="interest-title" title={explore ? "Your team’s own organization" : "In private preview"} />
          <SheetBody className="site-interest-body">
            {state.status === "sent" ? (
              <Callout inset tone="positive" title="Thank you">
                We’ll write to {form.email.trim()} when WhatBuild opens to more teams.
              </Callout>
            ) : (
              <form className="site-form" onSubmit={submit}>
                <p className="site-lede">
                  {explore
                    ? "Teams are let in a few at a time. Leave your email and we’ll write when yours can start; meanwhile, explore the example as a guest. We use your email for nothing else."
                    : "Leave your email and we’ll write when your team can start. We use it for nothing else."}
                </p>
                <FormGrid>
                  <TextField label="Email" type="email" autoComplete="email" required maxLength={320} value={form.email} onChange={set("email")} />
                  <TextField label="Name" optional autoComplete="name" maxLength={200} value={form.name} onChange={set("name")} />
                  <TextField label="Team or company" optional autoComplete="organization" maxLength={200} value={form.organization} onChange={set("organization")} />
                  <TextArea label="What are you deciding?" optional rows={3} maxLength={2000} value={form.note} onChange={set("note")} />
                </FormGrid>
                {/* People never see this field; bots fill it in and are ignored. */}
                <div className="site-trap" aria-hidden="true">
                  <label>
                    Website
                    <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
                  </label>
                </div>
                {state.status === "error" ? <ErrorCallout inset error={state.error} /> : null}
                <div className="site-actions">
                  <Button type="submit" variant="primary" busy={state.status === "sending"} busyLabel="Sending…">
                    Keep me posted
                  </Button>
                </div>
              </form>
            )}
          </SheetBody>
        </Sheet>
    </SiteFrame>
  );
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
          Sign in and explore a real discovery in the example organization, as a guest: read it, search it and point your agent at it.{" "}
          <a href="/signin?next=%2F">Explore the example</a>. Teams are let in a few at a time; <a href={`${sitePath("")}#interest`}>hear when yours can start</a>.
        </Callout>
      ) : (
        <Callout tone="info" title="In private preview">
          Teams are let in a few at a time. <a href={`${sitePath("")}#interest`}>Hear when yours can start</a>.
        </Callout>
      )}
    </SiteFrame>
  );
}
