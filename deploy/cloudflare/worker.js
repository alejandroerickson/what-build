// A Cloudflare Worker in front of WhatBuild's Cloud Run service, written for Cloudflare's free plan.
//
// The public site is served here, from the built web app (apps/web/dist), so nothing that visits
// it, crawlers included, wakes the service; only a request to hear from us is passed on. The app's
// own domain is passed on whole, but for paths it never serves, which scanners probe and which are
// answered here. Cloud Run picks the service by the Host header, which only
// Cloudflare Enterprise can rewrite, so each request goes to the service's run.app name and the
// domain the browser asked for travels in X-Forwarded-Host. Cookies, redirects and streamed
// responses pass through untouched. See okf/operations/cloud-run.md, "A custom domain".
//
// Settings (wrangler --var): ORIGIN, the service's run.app URL; SITE_HOST, the site's domain
// (e.g. example.com); APP_URL, the app's origin (e.g. https://app.example.com); and, optionally,
// ANALYTICS_ID, a Google Analytics measurement ID the site's pages load once a visitor accepts, and
// CF_ANALYTICS_TOKEN, a Cloudflare Web Analytics site token: its beacon sets no cookie, so it
// counts every visit to the site's pages, those who decline included; and MAINTENANCE, which closes
// both domains behind a page that says WhatBuild is down for maintenance, until the day it names
// (e.g. 2027-01-15), if it names one. One secret (wrangler secret
// put): EDGE_KEY, the service's WHATBUILD_EDGE_KEY, sent with every request passed on, so the
// service refuses whoever goes around this Worker to its run.app address
// (apps/server/src/edge-key.ts).

/** The site's own paths. Every other path on its domain belongs to the app. */
const SITE_FILES = /^\/(assets\/.+|favicon\.svg|theme-boot\.js)$/;

/**
 * Paths the app never serves, which scanners ask for by the hundred: a first part that is a dotfile
 * (/.env, /.git/config) other than /.well-known, or a file of a type no WhatBuild has at its root
 * (/xmlrpc.php, /info.php.bak, /service-account.json). An organization's name, the only other first
 * part, has no dot, and the app's own root files are .svg, .js, .md and .zip. Answered here, they
 * never wake the service or its database.
 */
const NOT_THE_APPS = /^\/(?:\.(?!well-known(?:\/|$))|[^/]*\.(?:php\d*|phtml|aspx?|jsp|cgi|env|ini|bak|old|save|orig|swp|sql|json|ya?ml|log|conf|config)(?:[.~][^/]*)?(?:\/|$))/i;

/**
 * The server's headers for its pages (PAGE_SECURITY_HEADERS in apps/server/src/public-routes.ts,
 * with RESPONSE_HEADERS in apps/server/src/app.ts and PERMISSIONS_POLICY in packages/core/src/story-html.ts).
 */
const PAGE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Permissions-Policy":
    "accelerometer=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

function forward(request, url, env, init = {}) {
  const forwarded = new Request(new URL(url.pathname + url.search, env.ORIGIN), request);
  forwarded.headers.set("X-Forwarded-Host", url.host);
  if (env.EDGE_KEY) forwarded.headers.set("X-WhatBuild-Edge-Key", env.EDGE_KEY);
  else forwarded.headers.delete("X-WhatBuild-Edge-Key");
  return fetch(forwarded, { redirect: "manual", ...init });
}

/** Google Analytics' hosts, by directive (ANALYTICS_SOURCES in apps/server/src/public-routes.ts). */
const ANALYTICS_SOURCES = {
  "script-src": "https://*.googletagmanager.com",
  "img-src": "https://*.google-analytics.com https://*.googletagmanager.com",
  "connect-src": "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
};

/** Cloudflare Web Analytics' hosts: its beacon script, and where it reports. */
const BEACON_SOURCES = {
  "script-src": "https://static.cloudflareinsights.com",
  "connect-src": "https://cloudflareinsights.com",
};

function pageHeaders(analytics, beacon) {
  const sources = [analytics ? ANALYTICS_SOURCES : {}, beacon ? BEACON_SOURCES : {}];
  const csp = PAGE_HEADERS["Content-Security-Policy"].split("; ").map((d) => {
    const extra = sources.map((s) => s[d.split(" ")[0]]).filter(Boolean);
    return extra.length ? `${d} ${extra.join(" ")}` : d;
  });
  return { ...PAGE_HEADERS, "Content-Security-Policy": csp.join("; ") };
}

/** An attribute's value, written into HTML. */
const attr = (v) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The site's pages, by path, and where each is in the build. */
const SITE_PAGES = { "/": "/site/", "/plans": "/site/plans/", "/plans/": "/site/plans/", "/privacy": "/site/privacy/", "/privacy/": "/site/privacy/" };

/** How long Cloudflare keeps the service's answer about plans, guests and who runs it: it wakes the service at most this often. */
const CATALOGUE_SECONDS = 3600;

/**
 * What only the service knows of its plans (their limits and prices, as an instance owner set them),
 * of its guests (whether anyone may come in) and of who runs it and who else handles people's data,
 * which the privacy page says: asked of the service through Cloudflare's cache, so a visit wakes it
 * at most once an hour. Null when the service does not answer; the pages then show the plans as the
 * build has them, and the privacy page says it could not load.
 */
async function catalogue(url, env) {
  try {
    const res = await forward(new Request(new URL("/api/v1/plans", url)), new URL("/api/v1/plans", url), env, { cf: { cacheTtl: CATALOGUE_SECONDS, cacheEverything: true } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function sitePage(request, url, env) {
  const page = await env.ASSETS.fetch(new Request(new URL(SITE_PAGES[url.pathname], url), request));
  const id = /^G-[A-Z0-9]+$/.test(env.ANALYTICS_ID ?? "") ? env.ANALYTICS_ID : null;
  const beacon = /^[0-9a-f]{32}$/.test(env.CF_ANALYTICS_TOKEN ?? "") ? env.CF_ANALYTICS_TOKEN : null;
  const site = await catalogue(url, env);
  const head = [
    id ? `<meta name="whatbuild-analytics" content="${id}" />` : "",
    site ? `<meta name="whatbuild-site" content="${attr(site)}" />` : "",
    beacon ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${beacon}"}'></script>` : "",
  ].join("");
  const body = head ? (await page.text()).replace("</head>", `${head}\n</head>`) : page.body;
  const response = new Response(body, page);
  for (const [name, value] of Object.entries(pageHeaders(Boolean(id), Boolean(beacon)))) response.headers.set(name, value);
  if (head) response.headers.delete("Content-Length");
  response.headers.set("Cache-Control", "no-cache");
  return response;
}

/** What an agent or a script gets instead of the maintenance page: the API's own error shape. */
const MACHINE_PATHS = /^\/(?:api|mcp|oauth|auth|\.well-known)(?:\/|$)/;

/**
 * While MAINTENANCE is set, every address on both domains answers 503 here and nothing reaches the
 * service: a page asked for by a browser gets the site's page marked for maintenance, anything else
 * the API's error shape. A day (2027-01-15) is when the page says WhatBuild will be back, and sets
 * Retry-After; any other value says only that it is down.
 */
async function maintenance(request, url, env) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(env.MAINTENANCE) && !Number.isNaN(Date.parse(`${env.MAINTENANCE}T00:00:00Z`)) ? env.MAINTENANCE : null;
  const left = day ? Math.ceil((Date.parse(`${day}T00:00:00Z`) - Date.now()) / 1000) : 0;
  const headers = { "Retry-After": String(Math.max(left, 300)), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const read = request.method === "GET" || request.method === "HEAD";
  if (!read || MACHINE_PATHS.test(url.pathname) || !(request.headers.get("Accept") ?? "").includes("text/html")) {
    const message = `WhatBuild is down for maintenance${day ? ` until ${day}` : ""}. Try again later.`;
    return Response.json({ error: { code: "maintenance", status: 503, message } }, { status: 503, headers });
  }
  const page = await env.ASSETS.fetch(new Request(new URL(SITE_PAGES["/"], url), request));
  const head = `<meta name="whatbuild-maintenance" content="${attr(day ?? "")}" />\n<meta name="robots" content="noindex" />\n</head>`;
  const body = (await page.text()).replace(/<title>[^<]*<\/title>/, "<title>Down for maintenance · WhatBuild</title>").replace("</head>", head);
  return new Response(request.method === "HEAD" ? null : body, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", ...PAGE_HEADERS, ...headers } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = env.SITE_HOST;
    const read = request.method === "GET" || request.method === "HEAD";

    if (site && url.host === `www.${site}`) return Response.redirect(`https://${site}${url.pathname}${url.search}`, 301);
    if (env.MAINTENANCE) {
      if (SITE_FILES.test(url.pathname) && read) return env.ASSETS.fetch(request);
      return maintenance(request, url, env);
    }
    if (site && url.host === site) {
      if (Object.hasOwn(SITE_PAGES, url.pathname) && read) return sitePage(request, url, env);
      if (SITE_FILES.test(url.pathname) && read) return env.ASSETS.fetch(request);
      if (url.pathname === "/api/v1/interest") return forward(request, url, env);
      // Temporary, not permanent: the site may grow pages of its own at these paths.
      return Response.redirect(`${env.APP_URL}${url.pathname}${url.search}`, 302);
    }

    // The app.
    if (NOT_THE_APPS.test(url.pathname)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...PAGE_HEADERS } });
    // Its hashed files are the same wherever they are served, so take them from here when this
    // deployment has them, and from the service when it does not (a newer build).
    if (url.pathname.startsWith("/assets/") && read) {
      const file = await env.ASSETS.fetch(request);
      if (file.status === 200) return file;
    }
    return forward(request, url, env);
  },
};
