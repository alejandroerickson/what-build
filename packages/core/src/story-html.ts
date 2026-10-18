import { EXTERNAL_URL, MOCKUP_PAGE_RULES, STORY_PAGE_RULES, type PageRules } from "./html-rules.ts";

// A page's rules, for a Story page and a mockup page, live in html-rules.ts, and the sandbox each is
// shown in in page-sandbox.ts; this module keeps the Story's stylesheet rules and the headers every
// page is served with.
export { MOCKUP_PAGE_SANDBOX, STORY_PAGE_SANDBOX } from "./page-sandbox.ts";
export { inspectMockupHtml, inspectPageHtml, inspectStoryHtml, MOCKUP_PAGE_RULES, STORY_HTML_MAX, STORY_MAX_SCRIPTS, STORY_PAGE_RULES, STORY_SCRIPT_BUDGET, type PageRules } from "./html-rules.ts";

export const STORY_CSS_MAX = 200_000;

/** Validate a Story style's stylesheet: the rules a page's <style> block must meet, plus a size limit. */
export function inspectStoryCss(css: string): string[] {
  const problems: string[] = [];
  if (css.length > STORY_CSS_MAX) problems.push(`The stylesheet is ${css.length.toLocaleString("en-US")} characters; the limit is ${STORY_CSS_MAX.toLocaleString("en-US")}.`);
  if (/@import/i.test(css)) problems.push("@import is not allowed: a Story style is one self-contained stylesheet.");
  if (EXTERNAL_URL.test(css)) problems.push("The stylesheet loads an external resource with url(); embed fonts and images as data: URIs.");
  if (/<\/style/i.test(css)) problems.push("The stylesheet contains </style, which would end the <style> element it is pasted into.");
  return problems;
}

/**
 * The browser features no WhatBuild page uses, turned off for the page and every frame in it. The
 * app's own, full screen for images and video and writing to the clipboard, keep their defaults.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer", "browsing-topics", "camera", "display-capture", "geolocation", "gyroscope", "hid", "idle-detection", "magnetometer",
  "microphone", "midi", "payment", "publickey-credentials-get", "screen-wake-lock", "serial", "usb", "xr-spatial-tracking",
].map((feature) => `${feature}=()`).join(", ");

/**
 * The headers every response that serves a page carries, in its surface's sandbox
 * (page-sandbox.ts). The page runs in an opaque origin with no network, and a form submission goes
 * nowhere: form-action is 'none' for every surface, the mockup page's included, whose sandbox
 * allows forms so that a prototype's submit handler runs. Keep form-action 'none' while any
 * surface's sandbox allows forms.
 */
export function pageResponseHeaders(rules: Pick<PageRules, "sandbox">): Record<string, string> {
  return {
    "Content-Security-Policy":
      `sandbox ${rules.sandbox}; default-src 'none'; script-src 'unsafe-inline'; ` +
      "style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; " +
      "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Content-Type": "text/html; charset=utf-8",
  };
}

/** A Story page's, and a style specimen's. */
export const STORY_RESPONSE_HEADERS = pageResponseHeaders(STORY_PAGE_RULES);
/** A mockup page's, on its canvas and on the Story. */
export const MOCKUP_RESPONSE_HEADERS = pageResponseHeaders(MOCKUP_PAGE_RULES);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
