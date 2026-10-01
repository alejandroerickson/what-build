// A Cloudflare Worker in front of WhatBuild's Cloud Run service, on Cloudflare's free plan.
//
// The public site is served here, from the built web app (apps/web/dist), so nothing that visits
// it, crawlers included, wakes the service; only a request to hear from us is passed on. The app's
// own domain is passed on whole. Cloud Run picks the service by the Host header, which only
// Cloudflare Enterprise can rewrite, so each request goes to the service's run.app name and the
// domain the browser asked for travels in X-Forwarded-Host. Cookies, redirects and streamed
// responses pass through untouched. See okf/operations/cloud-run.md, "A custom domain".
//
// Settings (wrangler --var): ORIGIN, the service's run.app URL; SITE_HOST, the site's domain
// (e.g. example.com); APP_URL, the app's origin (e.g. https://app.example.com).

/** The site's own paths. Every other path on its domain belongs to the app. */
const SITE_FILES = /^\/(assets\/.+|favicon\.svg|theme-boot\.js)$/;

/** The server's headers for its pages (PAGE_SECURITY_HEADERS in apps/server/src/public-routes.ts). */
const PAGE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

function forward(request, url, env) {
  const forwarded = new Request(new URL(url.pathname + url.search, env.ORIGIN), request);
  forwarded.headers.set("X-Forwarded-Host", url.host);
  return fetch(forwarded, { redirect: "manual" });
}

async function sitePage(request, url, env) {
  const page = await env.ASSETS.fetch(new Request(new URL("/site/", url), request));
  const response = new Response(page.body, page);
  for (const [name, value] of Object.entries(PAGE_HEADERS)) response.headers.set(name, value);
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

    // The app. Its hashed files are the same wherever they are served, so take them from here when
    // this deployment has them, and from the service when it does not (a newer build).
    if (url.pathname.startsWith("/assets/") && read) {
      const file = await env.ASSETS.fetch(request);
      if (file.status === 200) return file;
    }
    return forward(request, url, env);
  },
};
