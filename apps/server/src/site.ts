import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppError, invalid, newId, type Db } from "@whatbuild/core";
import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import type { ServerConfig } from "./config.ts";
import { pageHeaders, siteCatalogue } from "./public-routes.ts";

/** What the site's own origin serves; any other path there belongs to the app and is sent to it. */
const SITE_PATHS = new Set(["/", "/plans", "/plans/", "/privacy", "/privacy/", "/api/v1/interest", "/api/v1/plans", "/favicon.svg", "/theme-boot.js", "/health"]);

/** The site's pages, by their path on its own domain, and where each is in the build. */
const SITE_PAGES: Record<string, string> = { "/": "index.html", "/plans": "plans/index.html", "/plans/": "plans/index.html", "/privacy": "privacy/index.html", "/privacy/": "privacy/index.html" };

/** An attribute's value, written into HTML. */
const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A page of the site, carrying the deployment's Google Analytics ID for the page to load once a
 * visitor accepts, and what only the deployment knows of its plans, its guests and who runs it
 * (`whatbuild-site`, from `/api/v1/plans`): written in by whoever serves the page, so the page asks
 * the service nothing.
 */
function sitePage(path: string, analyticsId: string | null, site: unknown): string {
  const page = readFileSync(path, "utf8");
  const head = [
    analyticsId ? `<meta name="whatbuild-analytics" content="${attr(analyticsId)}" />` : "",
    site ? `<meta name="whatbuild-site" content="${attr(JSON.stringify(site))}" />` : "",
  ].filter(Boolean).join("\n");
  return head ? page.replace("</head>", `${head}\n</head>`) : page;
}

/** New requests to hear from us accepted per hour across the whole site, a crude guard against floods. */
const INTEREST_PER_HOUR = 200;

const Interest = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  organization: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  // A field people never see. Anything that fills it in is a bot, and is thanked and ignored.
  website: z.string().max(2000).optional(),
});

/**
 * The public site: a page that says what WhatBuild is and takes requests to hear when it opens, a
 * page of the plans it offers, and the privacy page.
 * The same image serves it, chosen by the Host (or X-Forwarded-Host) header: requests for WHATBUILD_SITE_URL's host get
 * the site, `www.` redirects to it, and every other path on it goes to the app at
 * WHATBUILD_PUBLIC_URL. On the app's origin the pages are at /site/, /site/plans/ and
 * /site/privacy/, which is where a deployment without WHATBUILD_SITE_URL has them.
 */
export function siteRoutes(deps: { db: Db; config: ServerConfig }) {
  const { db, config } = deps;
  const app = new Hono();
  const site = config.siteUrl ? new URL(config.siteUrl) : null;
  const appHost = new URL(config.publicBaseUrl).host;
  const ownSite = site && site.host !== appHost ? site : null;
  const dist = config.webDist ? join(resolve(config.webDist), "site") : null;

  /** The site's page at `path` on its own domain, with what only the deployment knows written in; null when the build has no such page. */
  const page = async (path: string) => {
    const file = dist && SITE_PAGES[path] ? join(dist, SITE_PAGES[path]) : null;
    if (!file || !existsSync(file)) return null;
    return sitePage(file, config.analyticsId, await siteCatalogue(db, config).catch(() => null));
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

  /** Ask to hear when WhatBuild opens. The same answer for a new address, a repeat and a bot. */
  app.post("/api/v1/interest", async (c) => {
    const body = Interest.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter an email address.");
    const { email, name, organization, note, website } = body.data;
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
      .values({ interest_id: newId(), email, ...fields })
      .onConflict((oc) =>
        oc.expression(sql`lower(email)`).doUpdateSet({
          name: sql`coalesce(excluded.name, interest.name)`,
          organization: sql`coalesce(excluded.organization, interest.organization)`,
          note: sql`coalesce(excluded.note, interest.note)`,
          updated_at: sql`now()`,
        }),
      )
      .execute();
    return c.json({ received: true });
  });

  return app;
}
