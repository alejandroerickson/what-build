import { useEffect, useState, type FormEvent } from "react";
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

const EMPTY = { email: "", name: "", organization: "", note: "", website: "" };

/** The Google Analytics measurement ID, which whoever serves the page writes into it; null for none. */
const ANALYTICS_ID = document.querySelector<HTMLMetaElement>('meta[name="whatbuild-analytics"]')?.content || null;

/**
 * The public site's one page, at the site's own domain: the overview's intro, then a form to hear
 * when WhatBuild opens. Everything else on that domain belongs to the app, so "Sign in" is a plain
 * link the server sends on to it.
 */
export function SitePage() {
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" } | { status: "error"; error: unknown }>({ status: "idle" });
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const choice = useCookieChoice();
  const accepted = Boolean(ANALYTICS_ID) && choice === "accepted";
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

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
    <div className="site">
      <main id="main" className="overview site-main">
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
            <a href="#interest" className="overview-agent-link">
              <Glyph name="arrow-right" size="sm" />
              Hear when it opens
            </a>
          </div>
          <Journey />
        </Sheet>

        <Sheet className="site-interest" labelledBy="interest-title">
          <span id="interest" className="site-anchor" />
          <SheetHeader level={2} id="interest-title" title="In private preview" />
          <SheetBody className="site-interest-body">
            {state.status === "sent" ? (
              <Callout inset tone="positive" title="Thank you">
                We’ll write to {form.email.trim()} when WhatBuild opens to more teams.
              </Callout>
            ) : (
              <form className="site-form" onSubmit={submit}>
                <p className="site-lede">
                  Leave your email and we’ll write when your team can start. We use it for nothing else.
                </p>
                <FormGrid>
                  <TextField label="Email" type="email" autoComplete="email" required maxLength={320} value={form.email} onChange={set("email")} />
                  <TextField label="Name" optional autoComplete="name" maxLength={200} value={form.name} onChange={set("name")} />
                  <TextField label="Team or company" optional autoComplete="organization" maxLength={200} value={form.organization} onChange={set("organization")} />
                  <TextArea label="What are you deciding?" optional rows={3} maxLength={2000} value={form.note} onChange={set("note")} hint="The product question on your team’s mind." />
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

        <footer className="site-foot">
          <span>
            Already invited? <a href="/signin">Sign in</a>
          </span>
          <span className="site-foot-end">
            <a href="/privacy">Privacy</a>
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
