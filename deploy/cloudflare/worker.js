// A Cloudflare Worker in front of WhatBuild's Cloud Run service, on Cloudflare's free plan.
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
// ANALYTICS_ID, a Google Analytics measurement ID the site's page loads once a visitor accepts, and
// CF_ANALYTICS_TOKEN, a Cloudflare Web Analytics site token: its beacon sets no cookie, so it
// counts every visit to the site's page, those who decline included.

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

function forward(request, url, env) {
  const forwarded = new Request(new URL(url.pathname + url.search, env.ORIGIN), request);
  forwarded.headers.set("X-Forwarded-Host", url.host);
  return fetch(forwarded, { redirect: "manual" });
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

async function sitePage(request, url, env) {
  const page = await env.ASSETS.fetch(new Request(new URL("/site/", url), request));
  const id = /^G-[A-Z0-9]+$/.test(env.ANALYTICS_ID ?? "") ? env.ANALYTICS_ID : null;
  const beacon = /^[0-9a-f]{32}$/.test(env.CF_ANALYTICS_TOKEN ?? "") ? env.CF_ANALYTICS_TOKEN : null;
  const head = [
    id ? `<meta name="whatbuild-analytics" content="${id}" />` : "",
    beacon ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${beacon}"}'></script>` : "",
  ].join("");
  const body = head ? (await page.text()).replace("</head>", `${head}\n</head>`) : page.body;
  const response = new Response(body, page);
  for (const [name, value] of Object.entries(pageHeaders(Boolean(id), Boolean(beacon)))) response.headers.set(name, value);
  if (head) response.headers.delete("Content-Length");
  response.headers.set("Cache-Control", "no-cache");
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = env.SITE_HOST;
    const read = request.method === "GET" || request.method === "HEAD";

    if (site && url.host === `www.${site}`) return Response.redirect(`https://${site}${url.pathname}${url.search}`, 301);
    if (site && url.host === site) {
      if (url.pathname === "/" && read) return sitePage(request, url, env);
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
