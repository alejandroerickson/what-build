import { HtmlLimitError, parseHtml } from "@whatbuild/parsers";

export const STORY_HTML_MAX = 1_000_000;
export const STORY_SCRIPT_BUDGET = 32_000;
export const STORY_MAX_SCRIPTS = 10;

const FORBIDDEN = new Set(["base", "embed", "form", "frame", "frameset", "iframe", "link", "object", "portal"]);
/**
 * A CSS url() that is neither a data: URI nor a fragment. The quote is optional, and the lookahead
 * sits before it, so a quoted data: URI (the usual way to embed a font or an SVG) is accepted.
 */
const EXTERNAL_URL = /url\(\s*(?!['"]?\s*(?:data:|#))/i;
/** The same for a style attribute, where only a data: URI is accepted. */
const EXTERNAL_URL_INLINE = /url\(\s*(?!['"]?\s*data:)/i;
const MEDIA_ATTRS = new Set(["src", "srcset", "poster", "data", "background", "xlink:href"]);

type Node = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  content?: Node;
  value?: string;
};

/**
 * Validate Story HTML at publish time. This is a courtesy to authors — it names every problem so
 * a page can be fixed in one pass. The security boundary is the sandboxed frame and the CSP on the
 * response that serves the page, which hold even if a rule here were wrong.
 */
export function inspectStoryHtml(html: string): string[] {
  const problems: string[] = [];
  if (html.length > STORY_HTML_MAX) problems.push(`The page is ${html.length} characters; the limit is ${STORY_HTML_MAX}.`);
  let doc: Node;
  try {
    // Bounded: a page nested too deep, or one that makes far more elements than it has tags, is refused.
    doc = parseHtml(html) as unknown as Node;
  } catch (e) {
    return [...problems, e instanceof HtmlLimitError ? `${e.message.charAt(0).toUpperCase()}${e.message.slice(1)}.` : "The HTML could not be parsed."];
  }
  let scripts = 0;
  let budget = 0;
  const seen = new Set<string>();
  const add = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      problems.push(p);
    }
  };
  const walk = (n: Node) => {
    const tag = n.tagName?.toLowerCase();
    if (tag) {
      if (FORBIDDEN.has(tag)) add(`<${tag}> is not allowed: a Story page is one self-contained document with no frames, forms or external resources.`);
      if (tag === "meta" && n.attrs?.some((a) => a.name.toLowerCase() === "http-equiv")) add("<meta http-equiv> is not allowed: no refresh, redirect or policy metadata.");
      if (tag === "script") {
        scripts++;
        if (n.attrs?.some((a) => a.name.toLowerCase() === "src")) add("<script src> is not allowed: scripts must be inline.");
        const text = (n.childNodes ?? []).map((c) => c.value ?? "").join("");
        budget += text.length;
      }
      for (const a of n.attrs ?? []) {
        const name = a.name.toLowerCase();
        const value = a.value.trim();
        if (name.startsWith("on")) budget += value.length;
        if (/^javascript:/i.test(value)) budget += value.length;
        if (MEDIA_ATTRS.has(name) && tag !== "script" && value && !/^data:/i.test(value) && !(name === "srcset" && value.split(",").every((p) => /^\s*data:/i.test(p))))
          add(`<${tag} ${name}="${value.slice(0, 60)}"> loads an external resource; embed images, fonts and media as data: URIs.`);
        if (name === "style" && EXTERNAL_URL_INLINE.test(value)) add(`A style attribute on <${tag}> loads an external resource; use data: URIs.`);
      }
      if (tag === "style") {
        const css = (n.childNodes ?? []).map((c) => c.value ?? "").join("");
        if (/@import/i.test(css)) add("@import is not allowed in a <style> block: keep the page self-contained.");
        if (EXTERNAL_URL.test(css)) add("A <style> block loads an external resource with url(); use data: URIs.");
      }
    }
    for (const c of n.childNodes ?? []) walk(c);
    if (n.content) walk(n.content);
  };
  walk(doc);
  if (scripts > STORY_MAX_SCRIPTS) problems.push(`The page has ${scripts} scripts; at most ${STORY_MAX_SCRIPTS} inline scripts are allowed.`);
  if (budget > STORY_SCRIPT_BUDGET) problems.push(`Inline scripts and event handlers total ${budget} characters; the budget is ${STORY_SCRIPT_BUDGET}. Story is a reading surface.`);
  return problems;
}

export const STORY_CSS_MAX = 200_000;

/** Validate a Story style's stylesheet: the rules a page's <style> block must meet, plus a size limit. */
export function inspectStoryCss(css: string): string[] {
  const problems: string[] = [];
  if (css.length > STORY_CSS_MAX) problems.push(`The stylesheet is ${css.length} characters; the limit is ${STORY_CSS_MAX}.`);
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

/** The headers every response that serves Story HTML carries. The page runs in an opaque origin. */
export const STORY_RESPONSE_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; " +
    "style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": PERMISSIONS_POLICY,
  "Content-Type": "text/html; charset=utf-8",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
