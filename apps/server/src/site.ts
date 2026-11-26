import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppError, invalid, newId, type Db } from "@whatbuild/core";
import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import type { ServerConfig } from "./config.ts";
import { pageHeaders, siteCatalogue } from "./public-routes.ts";

/** What the site's own origin serves; any other path there belongs to the app and is sent to it. */
const SITE_PATHS = new Set(["/", "/plans", "/plans/", "/privacy", "/privacy/", "/what-to-build", "/what-to-build/", "/api/v1/interest", "/api/v1/pressed", "/api/v1/plans", "/favicon.svg", "/theme-boot.js", "/social-card.png", "/health"]);

/** The site's pages, by their path on its own domain, and where each is in the build. */
const SITE_PAGES: Record<string, string> = {
  "/": "index.html",
  "/plans": "plans/index.html",
  "/plans/": "plans/index.html",
  "/privacy": "privacy/index.html",
  "/privacy/": "privacy/index.html",
  "/what-to-build": "what-to-build/index.html",
  "/what-to-build/": "what-to-build/index.html",
};

/** The landing pages, by their path on the site (`LandingPath` in apps/web/src/site/landing/Landing.tsx). */
export const LANDING_PAGES = ["/", "/what-to-build/"] as const;
/** A landing page's buttons: Explore the demo, and Start using WhatBuild. */
export const LANDING_BUTTONS = ["explore", "start"] as const;

/** An attribute's value, written into HTML. */
const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A page's own address in the build, from the site's root: its canonical link and og:url. */
const PAGE_ADDRESS = /(<link rel="canonical" href="|<meta property="og:url" content=")\//g;
/** Its social card's address in the build, from the root: og:image and twitter:image. */
const CARD_ADDRESS = /(<meta (?:property="og:image"|name="twitter:image") content=")\//g;

/**
 * A page of the site, carrying the deployment's Google Analytics ID for the page to load once a
 * visitor accepts, and what only the deployment knows of its plans, its guests and who runs it
 * (`whatbuild-site`, from `/api/v1/plans`): written in by whoever serves the page, so the page asks
 * the service nothing. Its own address and its social card's are made whole, since a link preview
 * (LinkedIn, X, Slack, iMessage) needs the whole address: the page's where the site's pages are
 * (`pages`), the card's on the origin that serves the build's files (`files`).
 */
function sitePage(path: string, analyticsId: string | null, site: unknown, at: { pages: string; files: string }): string {
  const page = readFileSync(path, "utf8").replace(PAGE_ADDRESS, `$1${at.pages}/`).replace(CARD_ADDRESS, `$1${at.files}/`);
  const head = [
    analyticsId ? `<meta name="whatbuild-analytics" content="${attr(analyticsId)}" />` : "",
    site ? `<meta name="whatbuild-site" content="${attr(JSON.stringify(site))}" />` : "",
  ].filter(Boolean).join("\n");
  return head ? page.replace("</head>", `${head}\n</head>`) : page;
}

/** New requests to hear from us accepted per hour across the whole site, a crude guard against floods. */
const INTEREST_PER_HOUR = 200;
/** Presses of the landing pages' buttons counted per hour by one process, a crude guard against floods; past it they are dropped. */
const PRESSES_PER_HOUR = 2000;
const Pressed = z.strictObject({ page: z.enum(LANDING_PAGES), button: z.enum(LANDING_BUTTONS) });

const Interest = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  organization: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  // Which of the site's pages it was sent from, to compare the landing pages; anything else is dropped.
  page: z.string().max(200).optional(),
  // A field people never see. Anything that fills it in is a bot, and is thanked and ignored.
  website: z.string().max(2000).optional(),
});

/**
 * The public site: two landing pages that say what WhatBuild is and take requests to hear when it
 * opens (the front page, and the dark stage at /what-to-build/), and count the presses of their
 * buttons; a page of the plans it offers; and the privacy page.
 * The same image serves it, chosen by the Host (or X-Forwarded-Host) header: requests for WHATBUILD_SITE_URL's host get
 * the site, `www.` redirects to it, and every other path on it goes to the app at
 * WHATBUILD_PUBLIC_URL. On the app's origin the pages are at /site/, /site/plans/, /site/privacy/
 * and /site/what-to-build/, which is where a deployment without WHATBUILD_SITE_URL has them.
 */
export function siteRoutes(deps: { db: Db; config: ServerConfig }) {
  const { db, config } = deps;
  const app = new Hono();
  const site = config.siteUrl ? new URL(config.siteUrl) : null;
  const appHost = new URL(config.publicBaseUrl).host;
  const ownSite = site && site.host !== appHost ? site : null;
  const dist = config.webDist ? join(resolve(config.webDist), "site") : null;
  // Where the site's pages are, which their canonical links name, from either origin: its own
  // domain, or /site/ on the app's without one. Either origin serves the build's files.
  const at = ownSite ? { pages: ownSite.origin, files: ownSite.origin } : { pages: `${config.publicBaseUrl}/site`, files: config.publicBaseUrl };

  /** The site's page at `path` on its own domain, with what only the deployment knows written in; null when the build has no such page. */
  const page = async (path: string) => {
    const file = dist && SITE_PAGES[path] ? join(dist, SITE_PAGES[path]) : null;
    if (!file || !existsSync(file)) return null;
    return sitePage(file, config.analyticsId, await siteCatalogue(db, config).catch(() => null), at);
  };
  const pageResponse = (html: string) => new Response(html, { status: 200, headers: { ...pageHeaders(Boolean(config.analyticsId)), "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });

  if (ownSite)
    app.use("*", async (c, next) => {
      // A proxy that must send Cloud Run its run.app name (deploy/cloudflare/worker.js) passes the
      // domain the browser asked for here. Trusting it is safe: it only chooses which public page to show.
      const host = (c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "").toLowerCase();
      const url = new URL(c.req.url);
      if (host === `www.${ownSite.host}`) return c.redirect(`${ownSite.origin}${url.pathname}${url.search}`, 301);
      if (host !== ownSite.host) return next();
      const html = c.req.method === "GET" || c.req.method === "HEAD" ? await page(c.req.path) : null;
      if (html) return pageResponse(html);
      if (SITE_PATHS.has(c.req.path) || c.req.path.startsWith("/assets/")) return next();
      // Temporary, not permanent: the site may grow pages of its own at these paths.
      return c.redirect(`${config.publicBaseUrl}${url.pathname}${url.search}`, 302);
    });

  // The site's pages on the app's origin: /site/ is the site's /, /site/privacy/ its /privacy/.
  app.get("/site/*", async (c, next) => {
    const html = await page(c.req.path.slice("/site".length));
    return html ? pageResponse(html) : next();
  });

  /**
   * A landing page's button was pressed: one more for its UTC day, page and button, to compare the
   * landing pages by how many visitors each moves to act (okf/operations/analytics.md). It names
   * nobody, and nothing reads it back over HTTP.
   */
  const flood = { hour: "", presses: 0 };
  app.post("/api/v1/pressed", async (c) => {
    const body = Pressed.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", `Send page, a landing page (${LANDING_PAGES.join(" or ")}), and button, the one pressed (${LANDING_BUTTONS.join(" or ")}).`);
    const now = new Date().toISOString();
    if (flood.hour !== now.slice(0, 13)) Object.assign(flood, { hour: now.slice(0, 13), presses: 0 });
    if (++flood.presses > PRESSES_PER_HOUR) return c.json({ received: true });
    await db
      .insertInto("landing_presses")
      .values({ day: now.slice(0, 10), page: body.data.page, button: body.data.button })
      .onConflict((oc) => oc.columns(["day", "page", "button"]).doUpdateSet({ presses: sql<number>`landing_presses.presses + 1` }))
      .execute();
    return c.json({ received: true });
  });

  /** Ask to hear when WhatBuild opens. The same answer for a new address, a repeat and a bot. */
  app.post("/api/v1/interest", async (c) => {
    const body = Interest.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter an email address.");
    const { email, name, organization, note, website } = body.data;
    const page = body.data.page && /^\/[a-z0-9/-]*$/.test(body.data.page) ? body.data.page : null;
    if (website) return c.json({ received: true });
    const recent = await db
      .selectFrom("interest")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("created_at", ">", new Date(Date.now() - 3600_000).toISOString())
      .executeTakeFirst();
    if (Number(recent?.n ?? 0) >= INTEREST_PER_HOUR) throw new AppError(429, "rate_limited", "Too many requests right now. Try again in an hour.");
    const fields = { name: name || null, organization: organization || null, note: note || null };
    await db
      .insertInto("interest")
      .values({ interest_id: newId(), email, ...fields, page })
      .onConflict((oc) =>
        oc.expression(sql`lower(email)`).doUpdateSet({
          name: sql`coalesce(excluded.name, interest.name)`,
          organization: sql`coalesce(excluded.organization, interest.organization)`,
          note: sql`coalesce(excluded.note, interest.note)`,
          page: sql`coalesce(interest.page, excluded.page)`,
          updated_at: sql`now()`,
        }),
      )
      .execute();
    return c.json({ received: true });
  });

  return app;
}
