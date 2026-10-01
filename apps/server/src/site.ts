import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppError, invalid, newId, type Db } from "@whatbuild/core";
import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import type { ServerConfig } from "./config.ts";
import { pageHeaders } from "./public-routes.ts";

/** What the site's own origin serves; any other path there belongs to the app and is sent to it. */
const SITE_PATHS = new Set(["/", "/api/v1/interest", "/favicon.svg", "/theme-boot.js", "/health"]);

/** The site's page, carrying the deployment's Google Analytics ID for the page to load once a visitor accepts. */
function sitePage(path: string, analyticsId: string | null): string {
  const page = readFileSync(path, "utf8");
  return analyticsId ? page.replace("</head>", `<meta name="whatbuild-analytics" content="${analyticsId}" />\n</head>`) : page;
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
 * The public site: one page that says what WhatBuild is and takes requests to hear when it opens.
 * The same image serves it, chosen by the Host (or X-Forwarded-Host) header: requests for WHATBUILD_SITE_URL's host get
 * the site, `www.` redirects to it, and every other path on it goes to the app at
 * WHATBUILD_PUBLIC_URL. Without WHATBUILD_SITE_URL the page is still at /site/ on the app's origin.
 */
export function siteRoutes(deps: { db: Db; config: ServerConfig }) {
  const { db, config } = deps;
  const app = new Hono();
  const site = config.siteUrl ? new URL(config.siteUrl) : null;
  const appHost = new URL(config.publicBaseUrl).host;
  const pagePath = config.webDist ? join(resolve(config.webDist), "site", "index.html") : null;

  if (site && site.host !== appHost)
    app.use("*", async (c, next) => {
      // A proxy that must send Cloud Run its run.app name (deploy/cloudflare/worker.js) passes the
      // domain the browser asked for here. Trusting it is safe: it only chooses which public page to show.
      const host = (c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "").toLowerCase();
      const url = new URL(c.req.url);
      if (host === `www.${site.host}`) return c.redirect(`${site.origin}${url.pathname}${url.search}`, 301);
      if (host !== site.host) return next();
      if (c.req.path === "/" && pagePath && existsSync(pagePath) && (c.req.method === "GET" || c.req.method === "HEAD"))
        return c.body(sitePage(pagePath, config.analyticsId), 200, { ...pageHeaders(Boolean(config.analyticsId)), "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      if (SITE_PATHS.has(c.req.path) || c.req.path.startsWith("/assets/")) return next();
      // Temporary, not permanent: the site may grow pages of its own at these paths.
      return c.redirect(`${config.publicBaseUrl}${url.pathname}${url.search}`, 302);
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
