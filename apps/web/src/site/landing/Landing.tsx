import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api.ts";
import type { PlanEntry } from "../../lib/limits.ts";
import { BrandMark } from "../../shell/brand.tsx";
import { tooLong } from "../../ui/field.tsx";
import { Glyph } from "../../ui/glyph.tsx";
import { demoLine, signInTo, SiteFoot, sitePath, useSite, useSiteCookies, useSystemTheme, useWays, type SiteButton, type Ways as SiteWays } from "../SitePage.tsx";
import { startOneLine } from "./one-line.ts";
import { startWindow } from "./window.ts";

/**
 * The site's two landing pages. Each tells the same six steps, from what you know about your users
 * to software that ships, as one plain statement per screen beside a picture the scroll moves.
 * Nothing here asks the service anything until someone presses one of its buttons or sends the form.
 */

/** The two landing pages, by their path on the site, carried through sign-in to compare the two (`LANDING_PAGES` in apps/server/src/site.ts). */
type LandingPath = "/" | "/what-to-build/";
/** What the deployment lets a visitor of a landing page do. */
type Ways = SiteWays<LandingPath>;

/**
 * Tells the service that one of the page's buttons was pressed, to compare the landing pages by how
 * many of their visitors act: a count for the day, the page and the button, which names nobody. It
 * is sent so that it outlives the page the press leaves, and a failure is ignored.
 */
function pressed(page: LandingPath, button: SiteButton) {
  void fetch("/api/v1/pressed", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ page, button }) }).catch(() => undefined);
}

/** The page owns the scroll bar's look while it is shown, and, for the dark stage, the theme. */
function usePageChrome(theme: "dark" | null) {
  useSystemTheme(theme === null);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("ld-root");
    if (theme) html.setAttribute("data-theme", theme);
    return () => html.classList.remove("ld-root");
  }, [theme]);
}

function Bar() {
  return (
    <header className="ld-bar">
      <a className="ld-brand" href={sitePath("")} aria-label="WhatBuild, home">
        <BrandMark size={26} />
        <span>WhatBuild</span>
      </a>
      <a className="ld-signin" href="/signin">
        Sign in
      </a>
    </header>
  );
}

/** Where Start using WhatBuild leads: sign-in and on to start an organization, or, where nobody may sign up yet, the form at the foot. */
const startHref = (ways: Ways) => (ways.open ? signInTo("/start", ways.page, "start") : "#start");

/** The waitlist form's email field, which Start using WhatBuild leads to where nobody may sign up yet. */
const EMAIL_FIELD = "ld-email";

/**
 * Start using WhatBuild, where it leads to the form at the foot: the page goes to the form and the
 * email field takes focus, so typing, and a screen reader, start where the button said. Once the
 * form is sent the field is gone, and the link only goes to the thanks; a click that opens a new
 * tab stays a plain link.
 */
function toTheForm(e: MouseEvent<HTMLAnchorElement>) {
  const field = document.getElementById(EMAIL_FIELD);
  if (!field || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (location.hash !== "#start") history.pushState(history.state, "", "#start");
  document.getElementById("start")?.scrollIntoView({ block: "start" });
  field.focus({ preventScroll: true });
}

/** A press of Start using WhatBuild: counted, and, where it leads to the form, the form's field focused. */
const pressStart = (ways: Ways) => (e: MouseEvent<HTMLAnchorElement>) => {
  pressed(ways.page, "start");
  if (!ways.open) toTheForm(e);
};

/**
 * The first thing to do is look: while guests may come in, Explore the demo leads (a guest's
 * sign-in), and Start using WhatBuild follows it. Without guests, Start using WhatBuild is the one action.
 */
function Actions({ ways }: { ways: Ways }) {
  if (!ways.explore)
    return (
      <div className="ld-actions">
        <a className="ld-btn" href={startHref(ways)} onClick={pressStart(ways)}>
          Start using WhatBuild
        </a>
      </div>
    );
  return (
    <div className="ld-actions">
      <a className="ld-btn" href={signInTo("/", ways.page, "explore")} onClick={() => pressed(ways.page, "explore")}>
        Explore the demo
      </a>
      <a className="ld-quiet" href={startHref(ways)} onClick={pressStart(ways)}>
        Start using WhatBuild <Glyph name="arrow-right" size="sm" />
      </a>
    </div>
  );
}

/** A gentle prompt at the foot of the first screen; it fades once the page moves. */
function ScrollCue() {
  return (
    <div className="ld-cue" aria-hidden="true">
      <span>Scroll</span>
      <Glyph name="chevron-down" size="sm" />
    </div>
  );
}

/** The plans in a line, as the deployment prices them: "Free: No charge. Pro: $79 a month." */
function priceLine(plans: PlanEntry[] | undefined): string | null {
  const priced = (plans ?? []).filter((p) => p.price);
  return priced.length ? priced.map((p) => `${p.name}: ${p.price}.`).join(" ") : null;
}

/** The limits the server sets on what someone leaves here. */
const EMAIL_MAX = 320;

/**
 * The last screen asks for one thing. Where anyone may make an account, the demo or Start using WhatBuild; where nobody may
 * yet, an email, to hear when they can. Sending it, or pressing a button, is all on the page that
 * wakes the service. Each says which landing page it came from, to compare the two.
 */
function Close({ ways }: { ways: Ways }) {
  const site = useSite();
  const page = ways.page;
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" } | { status: "error"; message: string }>({ status: "idle" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooLong(email.trim(), EMAIL_MAX)) {
      setState({ status: "error", message: `An email address is at most ${EMAIL_MAX} characters.` });
      return;
    }
    setState({ status: "sending" });
    try {
      await api("POST", "/api/v1/interest", { email, website, page });
      setState({ status: "sent" });
    } catch (error) {
      setState({ status: "error", message: error instanceof ApiError || error instanceof Error ? error.message : "That didn’t send. Try again." });
    }
  };
  const prices = priceLine(site?.plans);
  return (
    <section className="ld-close" id="start" aria-labelledby="start-title">
      <h2 className="ld-close-title" id="start-title">
        Find out what’s worth building.
      </h2>
      {ways.explore ? (
        <>
          <p className="ld-close-lede">{demoLine(ways.mock)}</p>
          <a className="ld-btn ld-btn-big" href={signInTo("/", page, "explore")} onClick={() => pressed(page, "explore")}>
            Explore the demo
          </a>
          <a className="ld-quiet" href={signInTo("/start", page, "start")} onClick={() => pressed(page, "start")}>
            Or start using WhatBuild <Glyph name="arrow-right" size="sm" />
          </a>
        </>
      ) : ways.open ? (
        <>
          <p className="ld-close-lede">Sign in and start your own organization.</p>
          <a className="ld-btn ld-btn-big" href={signInTo("/start", page, "start")} onClick={() => pressed(page, "start")}>
            Start using WhatBuild
          </a>
        </>
      ) : (
        <p className="ld-close-lede">WhatBuild is in private preview. Leave your email and we’ll write as soon as you can start.</p>
      )}
      {ways.open ? null : state.status === "sent" ? (
        <p className="ld-thanks" role="status">
          Thank you. We’ll write to {email.trim()} as soon as you can start.
        </p>
      ) : (
        <form className="ld-join" onSubmit={submit}>
          <label className="ld-join-label" htmlFor={EMAIL_FIELD}>
            Your email
          </label>
          <div className="ld-join-row">
            <input id={EMAIL_FIELD} className="ld-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="ld-btn" disabled={state.status === "sending"}>
              {state.status === "sending" ? "Sending…" : "Request access"}
            </button>
          </div>
          {/* People never see this field; bots fill it in and are ignored. */}
          <div className="site-trap" aria-hidden="true">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
          {state.status === "error" ? (
            <p className="ld-error" role="alert">
              {state.message}
            </p>
          ) : null}
        </form>
      )}
      {prices ? (
        <p className="ld-fine">
          {prices} <a href={sitePath("plans")}>Compare plans</a>
        </p>
      ) : null}
    </section>
  );
}

function Frame({ className, ways, children }: { className: string; ways: Ways; children: ReactNode }) {
  const { openCookies, notice } = useSiteCookies();
  return (
    <div className={`ld ${className}`}>
      <a className="ld-skip" href="#start">
        Skip to the end
      </a>
      <Bar />
      <main id="main">
        {children}
        <Close ways={ways} />
      </main>
      <SiteFoot className="ld-foot" home explore={ways.open || ways.explore} onCookies={openCookies} />
      {notice}
    </div>
  );
}

const HERO_SUB = "WhatBuild is the workspace where you and your agents turn what you know about your users into a product concept, as fast as your coding agents can build it.";

/** The six steps' headlines and the sentences under them, the same on both pages. */
const STEPS: [string, string][] = [
  ["Everything you know about your users, in one place.", "Each interview, email, spreadsheet and deck goes in once. From then on, everyone who works on the product has it, and so does every agent."],
  ["Your agents work on the evidence itself.", "They catch duplicates, add notes and write a digest of every piece, which makes it more useful for shaping the product concept."],
  ["Explore product concepts.", "Your agents draw each one as mockups on a canvas, where you compare them and narrow to what’s worth building."],
  ["Tell the story of what you are building.", "Stay aligned with your stakeholders and keep your momentum. Your agents have the same context as everyone else, because it is all in WhatBuild."],
  ["Your coding agent builds straight from the concept.", "It connects to the same workspace, so the concept, the mockups and the evidence behind them are its context as it writes code."],
];

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * The front page: six steps of words scroll up on the left, and the picture on the right stays put
 * and changes as each passes. On a narrow window the picture takes the top and the words the foot.
 */
export function LandingOneLine() {
  const ways = useWays("/");
  const root = useRef<HTMLDivElement>(null);
  usePageChrome(null);
  useEffect(() => startOneLine(root.current!), []);
  return (
    <Frame className="ld-one" ways={ways}>
      <section className="ld-journey" aria-label="What WhatBuild does" ref={root}>
        <div className="ld-graphic" aria-hidden="true">
          <div className="ld-stage">
            <svg className="ld-svg ld-ties" viewBox="0 0 1440 900" data-ld="ties" />
            <div className="ld-lane" data-ld="lane">
              <div className="ld-ship" data-ld="ship">
                <Check />
              </div>
            </div>
            <div data-ld="tiles" />
            <svg className="ld-svg ld-arcs" viewBox="0 0 1440 900" data-ld="arcs" />
            <div data-ld="frames" />
            <div className="ld-frame ld-concept" data-ld="concept">
              <span className="ld-ring" />
            </div>
            <div className="ld-page" data-ld="page">
              <span className="ld-live" />
            </div>
            <div data-ld="readers" />
            <div className="ld-agent" data-ld="agent" />
          </div>
        </div>
        <div className="ld-steps">
          <div className="ld-step ld-step-hero">
            <div className="ld-copy">
              <h1 className="ld-h1">
                Product engineering <br className="ld-br" />
                at the speed of <br className="ld-br" />
                AI engineering.
              </h1>
              <p className="ld-sub">{HERO_SUB}</p>
              <Actions ways={ways} />
            </div>
            <ScrollCue />
          </div>
          {STEPS.map(([title, sub]) => (
            <div className="ld-step" key={title}>
              <div className="ld-copy">
                <h2 className="ld-h2">{title}</h2>
                <p className="ld-sub">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </Frame>
  );
}

/**
 * The second landing page, at /what-to-build/: WhatBuild's window on a dark stage, pinned while the
 * scroll runs each scene, so someone who only scrolls sees every one.
 */
export function LandingWindow() {
  const ways = useWays("/what-to-build/");
  const root = useRef<HTMLDivElement>(null);
  usePageChrome("dark");
  useEffect(() => {
    document.title = "WhatBuild: what to build?";
    return startWindow(root.current!);
  }, []);
  const bars = ["46%", "72%", "64%", "38%", "58%"];
  return (
    <Frame className="ld-win" ways={ways}>
      <section className="ld-journey" aria-label="What WhatBuild does" ref={root}>
        <div className="ld-pin">
          <div className="ld-stage" aria-hidden="true">
            <svg className="ld-svg ld-ties" viewBox="0 0 1440 900" data-ld="ties" />
            <div className="ld-space">
              <div className="ld-rig" data-ld="rig">
                <div className="ld-agentl" data-ld="agentl">
                  {bars.map((w) => (
                    <b key={w} style={{ width: w }} />
                  ))}
                  <span className="ld-cursor" />
                </div>
                <div className="ld-face">
                  <div className="ld-chrome">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="ld-side">
                    {["70%", "84%", "60%", "76%"].map((w, i) => (
                      <b key={w} className={i === 0 ? "ld-on" : undefined} style={{ width: w }} />
                    ))}
                  </div>
                  <div className="ld-content" data-ld="content" />
                </div>
                <div className="ld-face ld-back">
                  <div className="ld-chrome">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="ld-side">
                    <b className="ld-on" style={{ width: "58%" }} />
                  </div>
                  <div className="ld-content">
                    <div className="ld-page ld-page-big">
                      <span className="ld-live" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div data-ld="fly" />
            <div data-ld="frames" />
            <div data-ld="readers" />
            <span className="ld-label ld-label-agent" data-ld="label-agent">
              Your agent works here
            </span>
            <span className="ld-label ld-label-you" data-ld="label-you">
              You see it here
            </span>
            <div className="ld-buildline" data-ld="buildline" />
            <div className="ld-mover" data-ld="mover" />
            <div className="ld-agent ld-builder" data-ld="builder" />
            <div className="ld-goal" data-ld="goal">
              <Check />
            </div>
          </div>
          <div className="ld-heads">
            <div className="ld-hd ld-hd-hero" data-h="0">
              <h1 className="ld-huge">What to build?</h1>
              <p className="ld-deck">Product engineering at the speed of AI engineering.</p>
              <p className="ld-sub">{HERO_SUB}</p>
              <Actions ways={ways} />
            </div>
            {STEPS.map(([title, sub], i) => (
              <div className="ld-hd" data-h={i + 1} key={title}>
                <h2 className="ld-h2">{title}</h2>
                <p className="ld-sub">{sub}</p>
              </div>
            ))}
          </div>
          <ScrollCue />
        </div>
      </section>
    </Frame>
  );
}
