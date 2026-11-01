import {
  AppError, houseSpecimen, houseStyle, ideaCardDocument, ideaCardResponseHeaders, MOCKUP_PAGE_RULES, pageResponseHeaders, printResponseHeaders, prototypeNotice, REFUSED_FRAME_SANDBOX, shownHtml, STORY_PAGE_RULES, styleSpecimen,
  THEME_ATTRIBUTE, withStoryFonts, withStoryFrame, withStoryTheme, type Env, type FileVersionsTable, type Tx,
} from "@whatbuild/core";
import type { Context } from "hono";
import { randomBytes } from "node:crypto";

/**
 * The documents WhatBuild shows of people's and agents' HTML, and the uploaded files it shows
 * inline: how each is found, by the app's own route (rest.ts) and by the content site's
 * (content-documents.ts) alike, so the two cannot drift; and how each is served.
 *
 * Every function that serves one takes `site`: null when it is served from the app's own origin,
 * or the app's origin when it is served from the content site, which only the app may frame.
 */

/** The policy of an HTML response whose route set none: it loads nothing, and cannot be framed, rebased or posted from. */
export const FALLBACK_HTML_POLICY = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** What every document served from the content site adds to its own headers: the app, another site, may frame it, and nothing keeps it. */
const ON_CONTENT_SITE = { "Cross-Origin-Resource-Policy": "cross-origin", "Cache-Control": "private, no-store" };

const ancestorOf = (site: string | null) => site ?? "'self'";
const served = (headers: Record<string, string>, site: string | null) => (site ? { ...headers, ...ON_CONTENT_SITE } : headers);

export function storyTheme(theme: string | undefined): "light" | "dark" | undefined {
  if (theme !== undefined && theme !== "light" && theme !== "dark") throw new AppError(422, "invalid_input", "theme must be light or dark.");
  return theme;
}

// ---- Finding each document ---------------------------------------------------------------------

/**
 * A Story page's version, by the page and its number (the app's address) or by the version's own id
 * (a grant's). A reader is given only live pages, as story.get_page gives them. A version that shows
 * a mockup page is composed with that page (shownHtml).
 */
export async function findStoryVersion(trx: Tx, productId: string, by: { pageId: string; n: number } | { versionId: string }, readerOnly: boolean) {
  const row = await storyVersionRow(trx, productId, by, readerOnly);
  return row ? { version_id: row.version_id, html: await shownHtml(trx, row), mockup: Boolean(row.mockup) } : null;
}

function storyVersionRow(trx: Tx, productId: string, by: { pageId: string; n: number } | { versionId: string }, readerOnly: boolean) {
  let q = trx
    .selectFrom("story_versions as v")
    .innerJoin("story_pages as p", "p.page_id", "v.page_id")
    .select(["v.version_id", "v.html", "v.mockup"])
    .where("v.product_id", "=", productId)
    .where("p.product_id", "=", productId);
  q = "versionId" in by ? q.where("v.version_id", "=", by.versionId) : q.where("v.page_id", "=", by.pageId).where("v.n", "=", by.n);
  if (readerOnly) q = q.where("p.archived_at", "is", null);
  return q.executeTakeFirst();
}

/**
 * A page of the canvas a Story page's version shows. This is how a reader reaches a canvas's pages,
 * so it finds nothing unless the version shows a whole canvas, and then only that one mockup
 * version's pages; a page the version does not show is not found.
 */
export async function findStoryCanvasPage(trx: Tx, productId: string, by: { pageId: string; n: number } | { versionId: string }, pageId: string, readerOnly: boolean) {
  const row = await storyVersionRow(trx, productId, by, readerOnly);
  if (!row?.mockup || row.mockup.page_id !== null) return null;
  const p = await trx.selectFrom("mockup_pages").select("html").where("version_id", "=", row.mockup.mockup_version_id).where("page_id", "=", pageId).executeTakeFirst();
  // A page that enters the prototype has no HTML of its own: its frame opens the entry (prototype_url).
  return p ? { version_id: row.version_id, html: p.html ?? prototypeNotice() } : null;
}

/** A mockup version's page, by the mockup and the version's number (the app's address) or by the version's id (a grant's). */
export async function findMockupPage(trx: Tx, productId: string, by: { mockupId: string; n: number } | { versionId: string }, pageId: string) {
  let q = trx
    .selectFrom("mockup_pages as p")
    .innerJoin("mockup_versions as v", "v.version_id", "p.version_id")
    .select(["v.version_id", "p.html"])
    .where("v.product_id", "=", productId)
    .where("p.page_id", "=", pageId);
  q = "versionId" in by ? q.where("v.version_id", "=", by.versionId) : q.where("v.mockup_id", "=", by.mockupId).where("v.n", "=", by.n);
  const row = await q.executeTakeFirst();
  // A page that enters the prototype has no HTML of its own: its frame opens the entry (prototype_url).
  return row ? { version_id: row.version_id, html: row.html ?? prototypeNotice() } : null;
}

/** An Idea card's front: the product concept's (`outcomeId` null) or an outcome's. Null when it has none. */
export async function findCard(trx: Tx, productId: string, outcomeId: string | null): Promise<{ front: string; title: string } | null> {
  if (outcomeId === null) {
    const p = await trx.selectFrom("products").select(["name", "card_html"]).where("product_id", "=", productId).executeTakeFirst();
    return p?.card_html ? { front: p.card_html, title: `${p.name}: product concept` } : null;
  }
  const o = await trx.selectFrom("outcomes").select(["title", "card_html"]).where("product_id", "=", productId).where("outcome_id", "=", outcomeId).executeTakeFirst();
  return o?.card_html ? { front: o.card_html, title: o.title } : null;
}

/** A sample page in the product's Story style, or in a house style (`houseId`). Null when there is none. */
export async function findSpecimen(trx: Tx, productId: string, houseId: string | null): Promise<string | null> {
  if (houseId !== null) {
    const style = houseStyle(houseId);
    return style ? houseSpecimen(style) : null;
  }
  const s = await trx.selectFrom("story_styles").select(["name", "stylesheet", "specimen_html"]).where("product_id", "=", productId).executeTakeFirst();
  return s ? styleSpecimen(s) : null;
}

export type FileVersion = Pick<FileVersionsTable, "file_version_id" | "blob_key" | "size" | "media_type" | "sha256">;

/**
 * An attachment's version, by the source, the path and a version (the current one when none is
 * named: the app's address) or by the file version's id (a grant's). Its path names it.
 */
export async function findAttachment(trx: Tx, productId: string, by: { recordId: string; path: string; version?: string | undefined } | { fileVersionId: string }) {
  if ("fileVersionId" in by) {
    const row = await trx
      .selectFrom("file_versions as v")
      .innerJoin("files as f", "f.file_id", "v.file_id")
      .innerJoin("records as r", "r.record_id", "v.record_id")
      .select(["v.file_version_id", "v.blob_key", "v.size", "v.media_type", "v.sha256", "f.path"])
      .where("r.product_id", "=", productId)
      .where("v.file_version_id", "=", by.fileVersionId)
      .executeTakeFirst();
    return row ? { v: row as FileVersion, path: row.path } : null;
  }
  const f = await trx
    .selectFrom("files as f")
    .innerJoin("records as r", "r.record_id", "f.record_id")
    .select(["f.file_id", "f.current_version_id", "f.path"])
    .where("r.product_id", "=", productId)
    .where("f.record_id", "=", by.recordId)
    .where("f.path", "=", by.path)
    .executeTakeFirst();
  if (!f) return null;
  const v = await trx
    .selectFrom("file_versions")
    .select(["file_version_id", "blob_key", "size", "media_type", "sha256"])
    .where("file_id", "=", f.file_id)
    .where("file_version_id", "=", by.version ?? f.current_version_id ?? "")
    .executeTakeFirst();
  return v ? { v, path: f.path } : null;
}

/** Whether an attachment is shown as an uploaded HTML page: by its type, or by its name, as the web app's preview decides. */
export function isHtmlAttachment(mediaType: string, path: string): boolean {
  return /^text\/html(;|$)/i.test(mediaType) || /\.html?$/i.test(path);
}

export const isPdf = (mediaType: string) => /^application\/pdf(;|$)/i.test(mediaType);

// ---- Serving each document ---------------------------------------------------------------------

/**
 * A page as the sandbox serves it: its surface's sandboxing headers (a mockup page's allows forms,
 * whose submissions form-action 'none' still stops), the carried typefaces the page names (never
 * for a mockup, which carries its own look), the theme, and the frame script when the app's frame
 * asks. A Story preview is served by the same function, so it is shown as its version would be.
 */
export function storyHtml(c: Context, stored: string, theme: "light" | "dark" | undefined, frame: boolean, mockup = false, site: string | null = null) {
  for (const [k, val] of Object.entries(served(pageResponseHeaders(mockup ? MOCKUP_PAGE_RULES : STORY_PAGE_RULES, ancestorOf(site)), site))) c.header(k, val);
  const html = mockup ? stored : withStoryFonts(stored);
  return c.body(frame ? withStoryFrame(html, theme) : theme ? withStoryTheme(html, theme) : html);
}

/**
 * An Idea card's front as the app's frame shows it: the stored markup in a document with the card
 * kit, the theme the app gives, and WhatBuild's one measuring script, which only its nonce lets run.
 * `limit` draws a preview's line where a desktop stops showing it.
 */
export function cardFront(c: Context, front: string, title: string, theme: "light" | "dark" | undefined, site: string | null = null, limit?: number) {
  const nonce = randomBytes(16).toString("base64");
  for (const [k, val] of Object.entries(served(ideaCardResponseHeaders(nonce, ancestorOf(site)), site))) c.header(k, val);
  return c.body(ideaCardDocument(front, { title, theme, nonce, ...(limit ? { limit } : {}) }));
}

const REFUSED_FRAME_STYLE =
  ":root{color-scheme:light;--panel:#fff;--text:#1e1e1e;--muted:#555}" +
  "@media (prefers-color-scheme:dark){:root:not([data-wb-theme=light]){color-scheme:dark;--panel:#2a2a2a;--text:#ededed;--muted:#bdbdbd}}" +
  ":root[data-wb-theme=dark]{color-scheme:dark;--panel:#2a2a2a;--text:#ededed;--muted:#bdbdbd}" +
  "html,body{height:100%;margin:0}" +
  'body{display:grid;place-items:center;background:var(--panel);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.45}' +
  "main{max-width:44ch;padding:1em;text-align:center;font-size:clamp(13px,2.4vw,40px)}" +
  "h1{margin:0 0 .35em;font-size:1.15em;font-weight:600}" +
  "p{margin:0;color:var(--muted)}";

/**
 * What a frame of the app is answered when its call is refused for the minute's calls, in place of
 * the JSON an API caller gets, with the same status and wait: a few words of WhatBuild's own, and
 * one script that tells the app so. The document holds nothing of anyone's and never asks again by
 * itself: only the app that framed it does, a bounded number of times, so it cannot spend the person's
 * calls in a loop. `comesBack` false is for a frame the app cannot hear from, which runs no script.
 * It is served from the app's own origin, content site or not, since the route refused it before any
 * hand-off, and only the app may frame it.
 */
export function refusedFrame(c: Context, refusal: AppError, comesBack = true) {
  const seconds = Math.max(1, Math.ceil(Number(refusal.details?.["retry_after_seconds"]) || 60));
  const theme = c.req.query("theme");
  const told = JSON.stringify({ whatbuild: "frame-refused", retry_after_seconds: seconds });
  const html =
    `<!doctype html><html lang="en"${theme === "light" || theme === "dark" ? ` ${THEME_ATTRIBUTE}="${theme}"` : ""}><head><meta charset="utf-8"><title>Waiting for the next minute</title>` +
    `<style>${REFUSED_FRAME_STYLE}</style></head><body><main><h1>Waiting for the next minute</h1>` +
    `<p>You’ve used this minute’s calls. ${comesBack ? "This comes back by itself." : "Close this preview and open it again in a moment."}</p></main>` +
    `${comesBack ? `<script>parent.postMessage(${told},"*")</script>` : ""}</body></html>`;
  return c.body(html, 429, { ...pageResponseHeaders({ sandbox: comesBack ? REFUSED_FRAME_SANDBOX : "" }), "Retry-After": String(seconds) });
}

/** The Story print view: opened at the top level, never framed, running only its nonce'd print script. */
export function printView(c: Context, html: string, nonce: string, site: string | null = null) {
  return c.body(html, 200, served(printResponseHeaders(nonce), site));
}

/** The most of an uploaded HTML page the web app's preview shows. */
export const HTML_VIEW_MAX_BYTES = 4 * 1024 * 1024;

/**
 * An uploaded HTML page as its preview shows it: as HTML, in a sandbox that runs no script and
 * loads nothing but what it carries (inline styles, data: images and fonts), so it neither
 * inherits the app's policy, as a `srcdoc` frame would, nor reaches anything of the app's.
 */
export async function htmlView(c: Context, env: Env, v: FileVersion, site: string | null = null) {
  if (v.size > HTML_VIEW_MAX_BYTES) throw new AppError(413, "too_large", "This HTML attachment is larger than a preview shows. Download it to open it.");
  const body = await env.ports.blobs.get(v.blob_key);
  return c.body(body as unknown as ArrayBuffer, 200, {
    ...served({ "Cache-Control": "private, no-store" }, site),
    "Content-Type": /^text\/html(;|$)/i.test(v.media_type) ? v.media_type : "text/html",
    "Content-Security-Policy": `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestorOf(site)}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Length": String(body.length),
  });
}

/** How many of a file's bytes a request asks for: the range it names, or the whole file. */
export function bytesAsked(c: Context, size: number): number {
  const m = /^bytes=(\d+)-(\d*)$/.exec(c.req.header("range") ?? "");
  if (!m) return size;
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start >= size || start > end ? 0 : end - start + 1;
}

/**
 * An attachment's bytes, in ranges when asked (as media players and PDF viewers ask). Uploaded HTML
 * and SVG are only ever an attachment to save; a PDF to show inline is the one document among them.
 */
export async function streamFile(c: Context, env: Env, v: FileVersion, path: string, download: boolean, site: string | null = null) {
  const name = path.split("/").pop() ?? "file";
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // Uploaded HTML and SVG are never served renderable, from the app's origin or the content site.
  const risky = /^(text\/html|application\/xhtml|image\/svg)/.test(v.media_type);
  const disposition = download || risky ? "attachment" : "inline";
  const headers: Record<string, string> = {
    "Content-Type": risky ? "application/octet-stream" : v.media_type,
    "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    // Browsers will not render a PDF inside a sandboxed document, and their PDF viewers run no page script.
    "Content-Security-Policy": `${isPdf(v.media_type) ? "default-src 'none'; object-src 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"}; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestorOf(site)}`,
    ETag: `"${v.sha256}"`,
    "Accept-Ranges": "bytes",
    // People's material: no cache keeps it, the browser's included.
    ...served({ "Cache-Control": "private, no-store" }, site),
    ...(site ? { "Referrer-Policy": "no-referrer" } : {}),
  };
  const range = c.req.header("range");
  const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), v.size - 1) : v.size - 1;
    if (start >= v.size || start > end) return c.body(null, 416, { "Content-Range": `bytes */${v.size}` });
    const body = await env.ports.blobs.getStream(v.blob_key, { start, end });
    return c.body(body, 206, { ...headers, "Content-Range": `bytes ${start}-${end}/${v.size}`, "Content-Length": String(end - start + 1) });
  }
  const body = await env.ports.blobs.getStream(v.blob_key);
  return c.body(body, 200, { ...headers, "Content-Length": String(v.size) });
}
