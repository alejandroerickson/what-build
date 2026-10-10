import { parseHtml } from "@whatbuild/parsers";
import { serialize } from "parse5";
import type { StoryNode } from "./db.ts";
import { escapeHtml, PERMISSIONS_POLICY } from "./story-html.ts";

/**
 * The Story print view: chosen pages composed into one HTML document that a browser prints to PDF.
 *
 * Each page keeps its own stylesheet inside its own declarative shadow root, so pages cannot
 * restyle each other or the document around them. Page scripts never run: they are removed here,
 * and the response's policy allows only the one nonce'd script that opens the print dialog.
 */

export const PRINT_MAX_PAGES = 50;

type Node = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  content?: Node;
  value?: string;
  parentNode?: Node | null;
};

// ---- Order and heading levels -----------------------------------------------------------------

export interface PrintSlot {
  page_id: string;
  /** Depth in the Story's hierarchy: 1 for a top-level page (and for an unplaced page). */
  depth: number;
  /** Outline level in the print view: 1 plus the number of chosen ancestors. */
  level: number;
}

/**
 * The chosen pages in tree order: a depth-first walk of the hierarchy, then pages the hierarchy
 * does not place, by title. A page's level counts only chosen ancestors, so the outline never
 * skips a level when a parent was left out.
 */
export function printOrder(tree: StoryNode[], chosen: { page_id: string; title: string }[]): PrintSlot[] {
  const wanted = new Map(chosen.map((p) => [p.page_id, p]));
  const out: PrintSlot[] = [];
  const seen = new Set<string>();
  const walk = (nodes: StoryNode[], depth: number, chosenAbove: number) => {
    for (const n of nodes) {
      if (seen.has(n.page_id)) continue;
      seen.add(n.page_id);
      const picked = wanted.has(n.page_id);
      if (picked) out.push({ page_id: n.page_id, depth, level: chosenAbove + 1 });
      walk(n.children, depth + 1, chosenAbove + (picked ? 1 : 0));
    }
  };
  walk(tree, 1, 0);
  const rest = chosen
    .filter((p) => !seen.has(p.page_id))
    .sort((a, b) => a.title.localeCompare(b.title) || a.page_id.localeCompare(b.page_id));
  for (const p of rest) out.push({ page_id: p.page_id, depth: 1, level: 1 });
  return out;
}

/** The heading element for a page title: the document title is h1, top-level pages h2, capped at h6. */
export function headingLevel(level: number): number {
  return Math.min(6, Math.max(2, level + 1));
}

// ---- Stylesheet scoping -----------------------------------------------------------------------

const BLOCK_AT_RULES_WITH_RULES = new Set(["media", "supports", "layer", "container", "document", "scope", "-moz-document"]);

function skipString(css: string, i: number): number {
  const q = css[i]!;
  let j = i + 1;
  while (j < css.length && css[j] !== q) j += css[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, css.length);
}

function skipComment(css: string, i: number): number {
  const end = css.indexOf("*/", i + 2);
  return end < 0 ? css.length : end + 2;
}

/** Index of the first stop character at nesting depth zero, skipping strings, comments and brackets. */
function scanTo(css: string, i: number, stops: string): number {
  let depth = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth === 0 && stops.includes(ch)) return i;
    i++;
  }
  return css.length;
}

/** Index just past the `}` matching the `{` at i. */
function matchBrace(css: string, i: number): number {
  let depth = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i <= s.length) {
    const at = scanTo(s, i, sep);
    parts.push(s.slice(start, at));
    if (at >= s.length) break;
    start = i = at + 1;
  }
  return parts;
}

const HOST_QUALIFIERS = /:host((?:[.#][-\w]+|\u0000\d+\u0000|:(?!:)(?!host\b)[-\w]+(?:\u0001\d+\u0001)?)+)/g;

/** Rewrite one selector so what the page said of its document applies to its shadow host. */
export function scopeSelector(selector: string): string {
  // Mask attribute selectors, strings and parenthesised arguments so only real type selectors change.
  // One set of masks serves the whole selector, arguments within arguments included: an argument is
  // scoped while its own masks are still in place, and everything is put back at the end.
  const masks: string[] = [];
  const parens: string[] = [];
  const masked = selector.replace(/\[[^\]]*\]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => `\u0000${masks.push(m) - 1}\u0000`);
  const scope = (sel: string): string => {
    let s = sel;
    let prev = "";
    while (prev !== s) {
      prev = s;
      s = s.replace(/\(([^()]*)\)/g, (_m, inner: string) => `\u0001${parens.push(`(${splitTopLevel(inner, ",").map(scope).join(",")})`) - 1}\u0001`);
    }
    s = s.replace(/:root(?![-\w])/g, ":host");
    s = s.replace(/(^|[\s>+~])(?:html|body)(?![-\w])/gi, "$1:host");
    s = s.replace(HOST_QUALIFIERS, (_m, q: string) => `:host(${q})`);
    // `html body` and `:root > body` both name the host twice; one host is meant.
    prev = "";
    while (prev !== s) {
      prev = s;
      s = s.replace(/:host(\(([^()]*)\))?\s*>?\s*:host(\(([^()]*)\))?/, (_m, _a, qa: string | undefined, _b, qb: string | undefined) => {
        const q = `${qa ?? ""}${qb ?? ""}`;
        return q ? `:host(${q})` : ":host";
      });
    }
    return s;
  };
  const unmask = (t: string): string =>
    t.replace(/\u0001(\d+)\u0001/g, (_m, n: string) => unmask(parens[Number(n)]!)).replace(/\u0000(\d+)\u0000/g, (_m, n: string) => masks[Number(n)]!);
  return unmask(scope(masked));
}

function scopeSelectorList(list: string): string {
  return splitTopLevel(list, ",").map(scopeSelector).join(",");
}

/** A dark-scheme media query applies on screen only, so a dark-mode browser still prints on paper. */
function scopeMediaPrelude(prelude: string): string {
  return splitTopLevel(prelude, ",")
    .map((q) => {
      const t = q.trim();
      if (!/prefers-color-scheme\s*:\s*dark/i.test(t)) return q;
      if (/^all\s+and\b/i.test(t)) return q.replace(/all\s+and/i, "screen and");
      if (/^(not|only|screen|print|all)\b/i.test(t)) return q;
      const lead = q.slice(0, q.indexOf(t));
      return `${lead}screen and ${q.slice(lead.length)}`;
    })
    .join(",");
}

/**
 * Rewrite a page's stylesheet for its shadow root: `:root`, `html` and `body` become `:host`, so the
 * page's tokens and base styles still apply, and dark-scheme rules stay off paper.
 */
export function scopeStoryCss(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (/\s/.test(ch)) {
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = skipComment(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "}") {
      // Stray closing brace: keep it, as a browser would recover.
      out += ch;
      i++;
      continue;
    }
    const stop = scanTo(css, i, ch === "@" ? "{;" : "{");
    const prelude = css.slice(i, stop);
    if (stop >= css.length) {
      out += prelude;
      break;
    }
    if (css[stop] === ";") {
      out += css.slice(i, stop + 1);
      i = stop + 1;
      continue;
    }
    const close = matchBrace(css, stop);
    if (ch === "@") {
      const name = /^@([-\w]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      if (BLOCK_AT_RULES_WITH_RULES.has(name)) {
        const keyword = /^@[-\w]+/.exec(prelude)![0];
        const head = name === "media" ? `${keyword}${scopeMediaPrelude(prelude.slice(keyword.length))}` : prelude;
        out += `${head}{${scopeStoryCss(css.slice(stop + 1, close - 1))}}`;
      } else out += css.slice(i, close);
    } else {
      out += `${scopeSelectorList(prelude)}${css.slice(stop, close)}`;
    }
    i = close;
  }
  return out;
}

// ---- Page bodies ------------------------------------------------------------------------------

function textOf(n: Node): string {
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(textOf).join("");
}

function norm(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function findChild(n: Node | undefined, tag: string): Node | undefined {
  return n?.childNodes?.find((c) => c.tagName === tag);
}

const isKicker = (n: Node) => n.attrs?.some((a) => a.name === "class" && a.value.split(/\s+/).includes("kicker")) ?? false;

/** Remove the first <h1> when no text but a kicker comes before it and it repeats the page title. */
function dropLeadingTitle(body: Node, title: string): boolean {
  let found: { node: Node; parent: Node } | null = null;
  let blocked = false;
  const walk = (n: Node) => {
    for (const c of n.childNodes ?? []) {
      if (found || blocked) return;
      if (c.nodeName === "#text") {
        if ((c.value ?? "").trim()) blocked = true;
        continue;
      }
      if (c.tagName === "h1") {
        found = { node: c, parent: n };
        return;
      }
      if (isKicker(c)) continue;
      if (c.tagName && !["style", "script", "template"].includes(c.tagName)) walk(c);
      if (c.tagName && ["img", "svg", "picture", "video", "audio", "canvas", "table"].includes(c.tagName)) blocked = true;
    }
  };
  walk(body);
  const hit = found as { node: Node; parent: Node } | null;
  if (!hit || norm(textOf(hit.node)) !== norm(title)) return false;
  hit.parent.childNodes = hit.parent.childNodes!.filter((c) => c !== hit.node);
  return true;
}

/**
 * Elements a print view never carries, whatever a stored page holds: scripts, and everything
 * publishing refuses (refresh and policy metadata, frames, forms, external resources). The print
 * view is a top-level document, so this is defence in depth behind its policy.
 */
const DROPPED = new Set(["script", "meta", "base", "link", "iframe", "frame", "frameset", "object", "embed", "portal", "form"]);

/** Remove scripts, refused elements and inline event handlers, and scope every <style> left in the body. */
function sanitize(n: Node) {
  if (n.childNodes) n.childNodes = n.childNodes.filter((c) => !DROPPED.has(c.tagName ?? ""));
  if (n.attrs) n.attrs = n.attrs.filter((a) => !a.name.toLowerCase().startsWith("on"));
  if (n.tagName === "style") for (const c of n.childNodes ?? []) if (c.nodeName === "#text") c.value = scopeStoryCss(c.value ?? "");
  for (const c of n.childNodes ?? []) sanitize(c);
  if (n.content) sanitize(n.content);
}

const HEADING = /^h([1-6])$/;

/**
 * Place the page's own headings under its title in the outline: the highest heading the page uses
 * becomes one level below the title, and the rest keep their distance from it. Only aria-level
 * changes, so the page's stylesheet still styles each heading by its tag; screen readers and the
 * PDF's outline read the level.
 */
function nestHeadings(body: Node, titleHeading: number) {
  const headings: { node: Node; n: number }[] = [];
  const walk = (n: Node) => {
    const m = HEADING.exec(n.tagName ?? "");
    if (m) headings.push({ node: n, n: Number(m[1]) });
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(body);
  if (!headings.length) return;
  const top = Math.min(...headings.map((x) => x.n));
  for (const { node, n } of headings) {
    const level = Math.min(6, titleHeading + 1 + (n - top));
    node.attrs = [...(node.attrs ?? []).filter((a) => a.name.toLowerCase() !== "aria-level"), { name: "aria-level", value: String(level) }];
  }
}

export interface PreparedPage {
  /** The page's head stylesheets, scoped for a shadow root. */
  styles: string[];
  /** The page's body content, serialized, without scripts. */
  body: string;
  /** Attributes the page set on <html> and <body>, carried onto the shadow host. */
  host: { name: string; value: string }[];
  /** Whether a leading <h1> repeating the title was dropped. */
  dropped_title: boolean;
}

/** titleHeading, the level of the heading the print view gives the page's title, nests the page's own headings under it. */
export function prepareStoryPage(html: string, title: string, titleHeading?: number): PreparedPage {
  const doc = parseHtml(html) as unknown as Node;
  const root = findChild(doc, "html");
  const head = findChild(root, "head");
  const body = findChild(root, "body");
  const styles: string[] = [];
  for (const c of head?.childNodes ?? []) if (c.tagName === "style") styles.push(scopeStoryCss(textOf(c)));
  const hostAttrs = new Map<string, string>();
  const classes: string[] = [];
  for (const a of [...(root?.attrs ?? []), ...(body?.attrs ?? [])]) {
    const name = a.name.toLowerCase();
    if (name === "class") classes.push(a.value);
    else if (name === "lang" || name === "dir" || name === "style" || name.startsWith("data-")) hostAttrs.set(name, a.value);
  }
  if (classes.join(" ").trim()) hostAttrs.set("class", classes.join(" ").trim());
  if (!body) return { styles, body: "", host: [...hostAttrs].map(([name, value]) => ({ name, value })), dropped_title: false };
  sanitize(body);
  const dropped = dropLeadingTitle(body, title);
  if (titleHeading) nestHeadings(body, titleHeading);
  return { styles, body: serialize(body as never), host: [...hostAttrs].map(([name, value]) => ({ name, value })), dropped_title: dropped };
}

// ---- The document -----------------------------------------------------------------------------

export interface PrintPage {
  page_id: string;
  title: string;
  version: number;
  published_at: string;
  level: number;
  html: string;
}

export function printCsp(nonce: string): string {
  return (
    `sandbox allow-modals allow-scripts; default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; ` +
    "img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
}

/** Headers for the print view: served top-level, in an opaque origin, running only the print script. */
export function printResponseHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Security-Policy": printCsp(nonce),
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
}

const PRINT_CSS = `
:root { color-scheme: light; }
html { background: #ffffff; color: #1e1e1e; font: 15px/1.5 "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0; }
::selection { background: #ecebfd; color: #3a33b8; }
.print-doc { max-width: 60rem; margin: 0 auto; padding: 24px 16px 64px; }
.print-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin: 0 0 32px; padding: 10px 14px; border: 1px solid #d5d5d5; border-radius: 8px; background: #f0f0f0; font-size: 12px; color: #555555; }
.print-bar p { margin: 0; max-width: 44rem; }
.print-bar button { font: inherit; font-weight: 500; padding: 0 10px; min-height: 28px; border-radius: 6px; border: 0; background: #5a53e8; color: #ffffff; cursor: pointer; }
.print-bar button:hover { background: #4a43d6; }
.print-bar button:focus-visible { outline: 2px solid #5a53e8; outline-offset: 1px; }
.print-title { margin: 0 0 32px; }
.print-title h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.2; letter-spacing: -0.01em; font-weight: 600; }
.print-title p.print-when { margin: 0; color: #555555; font-size: 13px; }
.print-contents { padding: 16px 0 0; border-top: 1px solid #e6e6e6; }
.print-contents h2 { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
.print-contents ol { list-style: none; margin: 0; padding: 0; }
.print-contents li { margin: 2px 0; }
.print-contents a { color: inherit; text-decoration: none; }
.print-contents a:hover { text-decoration: underline; text-underline-offset: 2px; }
.print-section { margin: 48px 0 0; }
.print-heading { margin: 0 0 4px; line-height: 1.25; font-weight: 600; letter-spacing: -0.01em; break-after: avoid; }
h2.print-heading { font-size: 24px; } h3.print-heading { font-size: 20px; } h4.print-heading { font-size: 17px; }
h5.print-heading, h6.print-heading { font-size: 15px; }
.print-meta { margin: 0 0 16px; font-size: 12px; color: #555555; break-after: avoid; }
@page { margin: 18mm 16mm; }
@media print {
  .print-bar { display: none; }
  .print-doc { max-width: none; padding: 0; }
  .print-section[data-level="1"] { break-before: page; margin-top: 0; }
}
`;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Compose the print view. Pure: the same input gives the same document. */
export function composePrintDocument(input: { productName: string; exportedAt: string; pages: PrintPage[]; nonce: string }): string {
  const { productName, exportedAt, pages, nonce } = input;
  const count = `${pages.length} page${pages.length === 1 ? "" : "s"}`;
  const contents = pages
    .map((p) => `<li data-level="${p.level}" style="padding-left:${(p.level - 1) * 1.25}em"><a href="#page-${p.page_id}">${escapeHtml(p.title)}</a></li>`)
    .join("\n");
  const sections = pages
    .map((p) => {
      const h = headingLevel(p.level);
      const prepared = prepareStoryPage(p.html, p.title, h);
      const host = prepared.host.map((a) => ` ${a.name}="${escapeHtml(a.value)}"`).join("");
      const styles = prepared.styles.map((s) => `<style>${s.replace(/<\/style/gi, "<\\/style")}</style>`).join("");
      return (
        `<section class="print-section" id="page-${p.page_id}" data-level="${p.level}" aria-labelledby="title-${p.page_id}">\n` +
        `<h${h} class="print-heading" id="title-${p.page_id}">${escapeHtml(p.title)}</h${h}>\n` +
        `<p class="print-meta">Version ${p.version} · published ${escapeHtml(formatDate(p.published_at))}</p>\n` +
        `<div data-print-page="${p.page_id}"${host}><template shadowrootmode="open">${styles}${prepared.body}</template></div>\n` +
        `</section>`
      );
    })
    .join("\n");
  const script =
    'document.getElementById("print-now").addEventListener("click", function () { window.print(); });' +
    'window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(productName)} — Story</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="print-doc">
<div class="print-bar" role="note"><p>Print view of ${count}. Choose Save as PDF in the print dialog. Content drawn by a page's scripts is left out.</p><button type="button" id="print-now">Print or save as PDF</button></div>
<header class="print-title">
<h1>${escapeHtml(productName)}</h1>
<p class="print-when">Story · exported ${escapeHtml(formatDate(exportedAt))} · ${count}</p>
</header>
<nav class="print-contents" aria-labelledby="contents-title">
<h2 id="contents-title">Contents</h2>
<ol>
${contents}
</ol>
</nav>
<main>
${sections}
</main>
</div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
