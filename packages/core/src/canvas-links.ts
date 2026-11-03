import { OUTSIDE_THE_SANDBOX } from "./page-sandbox.ts";
import { escapeHtml } from "./story-html.ts";
import { encodePrototypePath, splitEntry } from "./prototype.ts";

/**
 * Links between a canvas's pages. A page links to another as files side by side in a folder do,
 * `<a href="checkout.html">`, which is also how they sit in a version's ZIP. The canvas flies to the
 * page a link names, and a canvas whose pages link can be viewed as a clickable prototype.
 */

// An href's value in any quoting. Each attempt ends at the next quote or space, so it runs in linear time.
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/**
 * The page a relative address names: its last part, without .html or .htm. Null for what is not a
 * relative address to a page: a fragment, a root-relative or remote address, an empty path. The frame
 * script (story-theme.ts) reads an address the same way when it is clicked.
 */
export function linkedPageName(href: string): string | null {
  const u = href.trim();
  if (!u || u.startsWith("#") || u.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(u)) return null;
  const path = u.split(/[?#]/)[0]!;
  const name = path.split("/").pop()!.replace(/\.html?$/i, "");
  return name || null;
}

export interface ClickableCanvas {
  /** Whether people can view this version as a clickable prototype: a page links to another, or enters a prototype. */
  viewable: boolean;
  links_between_pages: number;
  /** Relative links that name no page of the canvas. */
  broken: { page_id: string; href: string }[];
  /** While it is not viewable, how to make it so. */
  how?: string;
}

const BROKEN_LISTED = 25;

export const CLICKABLE_HOW = 'Link pages with <a href="page_id.html">, the other page\'s page_id, and publish the next version. See guide(topic="mockups").';

/** What a version's pages say of each other, read from their HTML. A page that enters a prototype has its own links. */
export function clickableCanvas(pages: { page_id: string; html: string | null; entry: string | null }[]): ClickableCanvas {
  const ids = new Set(pages.map((p) => p.page_id));
  const broken: ClickableCanvas["broken"] = [];
  let links = 0;
  for (const p of pages) {
    if (p.html === null) continue;
    for (const m of p.html.matchAll(HREF)) {
      const href = m[1] ?? m[2] ?? m[3] ?? "";
      const name = linkedPageName(href);
      if (name === null || name === p.page_id) continue;
      if (ids.has(name)) links++;
      else if (broken.length < BROKEN_LISTED) broken.push({ page_id: p.page_id, href: href.slice(0, 200) });
    }
  }
  const viewable = pages.length > 1 && (links > 0 || pages.some((p) => p.entry !== null));
  return { viewable, links_between_pages: links, broken, ...(viewable ? {} : { how: CLICKABLE_HOW }) };
}

/** The address of a page's document within a version's ZIP. */
function pageFile(p: { page_id: string; entry: string | null }): string {
  if (p.entry === null) return `pages/${p.page_id}.html`;
  const s = splitEntry(p.entry);
  return "problem" in s ? `prototype/${p.entry}` : `prototype/${encodePrototypePath(s.path)}${s.suffix}`;
}

/** The page a version's ZIP opens from: where to start, and every page by name. */
export function mockupIndexHtml(version: { title: string; n: number }, pages: { page_id: string; title: string; entry: string | null }[]): string {
  const title = escapeHtml(version.title);
  const first = pages[0];
  const rows = pages.map((p) => `<li><a href="${escapeHtml(pageFile(p))}">${escapeHtml(p.title)}</a></li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { margin: 0 0 .25rem; font-size: 1.75rem; line-height: 1.2; }
.version { margin: 0 0 1.5rem; opacity: .7; }
.warning { margin-top: 2rem; font-size: .875rem; opacity: .7; }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="version">Version ${version.n}</p>
${first ? `<p><a href="${escapeHtml(pageFile(first))}"><strong>Start at ${escapeHtml(first.title)}</strong></a></p>` : ""}
<ol>
${rows}
</ol>
<p class="warning">${escapeHtml(OUTSIDE_THE_SANDBOX)}</p>
</body>
</html>
`;
}
