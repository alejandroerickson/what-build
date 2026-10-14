import { HtmlLimitError, parseHtml } from "@whatbuild/parsers";
import { MOCKUP_PAGE_SANDBOX } from "./page-sandbox.ts";
import type { Ports } from "./ports.ts";
import { PERMISSIONS_POLICY } from "./story-html.ts";

/**
 * A mockup's prototype: a team's multi-file prototype as it is (HTML documents that link to one
 * another, scripts, stylesheets, fonts, images, media, fixtures), carried by a mockup version and
 * entered by its canvas pages. Its files are any bytes, given back byte for byte. They are not held
 * to a page's HTML rules: they are served by one route (apps/server/src/prototype.ts) under a
 * short-lived capability path, in an opaque origin whose policy lets them load only from that path
 * (prototypeResponseHeaders). This module holds what both the publish and the route need.
 */

export const PROTOTYPE_MAX_FILES = 2_000;
export const PROTOTYPE_MAX_BYTES = 64 * 1024 * 1024;
export const PROTOTYPE_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** Distinct prototype bytes a product may hold, across every version of every mockup. */
export const PROTOTYPE_PRODUCT_MAX_BYTES = 500 * 1024 * 1024;
export const PROTOTYPE_PATH_MAX = 400;
export const PROTOTYPE_FOLDERS_MAX = 16;
/** What an entry may add after its path: a query and a fragment. */
export const PROTOTYPE_ENTRY_SUFFIX_MAX = 500;
/** A poster is embedded in the Story's print view, so it is kept small. */
export const PROTOTYPE_POSTER_MAX_BYTES = 2 * 1024 * 1024;
export const PROTOTYPE_GRANT_PURPOSE = "prototype";
/** The first part of every prototype address, on the app's origin or a content site's. */
export const PROTOTYPE_ROUTE = "/prototypes";
/** The most warnings publish lists; past it, one line says how many more there were. */
const MAX_WARNINGS = 100;

const UNSAFE_CHARS = /[\\:*?"<>|#\u0000-\u001f\u007f]/;

/**
 * A prototype file's path as it is stored: relative, `/` between folders, in Unicode NFC (a ZIP
 * made on a Mac names files decomposed), with nothing a URL, a ZIP tool or another system would
 * read differently. Returns the stored form or the problem.
 */
export function prototypePath(raw: string): { path: string } | { problem: string } {
  const path = raw.normalize("NFC");
  if (!path) return { problem: "an empty path" };
  if (path.length > PROTOTYPE_PATH_MAX) return { problem: `a path of ${path.length} characters; at most ${PROTOTYPE_PATH_MAX}` };
  if (path.startsWith("/")) return { problem: "an absolute path; prototype paths are relative" };
  const parts = path.split("/");
  if (parts.length - 1 > PROTOTYPE_FOLDERS_MAX) return { problem: `${parts.length - 1} folders deep; at most ${PROTOTYPE_FOLDERS_MAX}` };
  for (const part of parts) {
    if (!part) return { problem: "an empty folder name (//)" };
    if (part === "." || part === "..") return { problem: `a ${part} in the path` };
    const bad = UNSAFE_CHARS.exec(part);
    if (bad) return { problem: `the character ${JSON.stringify(bad[0])}, which addresses or other systems read differently (\\ : * ? " < > | # and control characters are refused)` };
    if (/[ .]$/.test(part)) return { problem: "a name that ends in a space or a dot, which some systems drop" };
  }
  return { path };
}

/** A canvas page's entry: a path in the prototype, then a query and a fragment if it wants them. */
export function splitEntry(entry: string): { path: string; suffix: string } | { problem: string } {
  const at = entry.search(/[?#]/);
  const rawPath = at < 0 ? entry : entry.slice(0, at);
  const suffix = at < 0 ? "" : entry.slice(at);
  if (suffix.length > PROTOTYPE_ENTRY_SUFFIX_MAX) return { problem: `its query and fragment hold ${suffix.length} characters; at most ${PROTOTYPE_ENTRY_SUFFIX_MAX}` };
  if (/[\u0000-\u001f\u007f\s]/.test(suffix)) return { problem: "its query or fragment holds a space or a control character; percent-encode it" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { problem: "its path is not valid percent-encoding" };
  }
  const p = prototypePath(decoded);
  if ("problem" in p) return { problem: `its path has ${p.problem}` };
  return { path: p.path, suffix };
}

/** The address of a stored path within a prototype: each part percent-encoded, `/` kept. */
export function encodePrototypePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** An entry as a frame's address takes it: the path encoded, the query and fragment as given. */
export function entryAddress(entry: string): string {
  const s = splitEntry(entry);
  return "problem" in s ? entry : `${encodePrototypePath(s.path)}${s.suffix}`;
}

const TYPES: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  json: "application/json", map: "application/json", webmanifest: "application/manifest+json",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  ico: "image/x-icon", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  vtt: "text/vtt", pdf: "application/pdf",
  // Text a browser would otherwise render as a document of its own (XML, XHTML, XSLT) is plain text.
  txt: "text/plain", csv: "text/plain", md: "text/plain", markdown: "text/plain", xml: "text/plain", xhtml: "text/plain", xht: "text/plain", xsl: "text/plain", xslt: "text/plain",
};
const TEXT = /^(text\/|application\/(json|manifest\+json)$|image\/svg\+xml$)/;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * The type a file is served with, chosen once at publish from its name: an allowlist, `charset=utf-8`
 * only on text that is valid UTF-8, and `application/octet-stream` (served as an attachment) for
 * anything else. Never sniffed, and every response says nosniff.
 */
export function prototypeMediaType(path: string, bytes: Uint8Array): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const type = TYPES[ext];
  if (!type) return "application/octet-stream";
  if (!TEXT.test(type)) return type;
  try {
    STRICT_UTF8.decode(bytes);
    return `${type}; charset=utf-8`;
  } catch {
    return type;
  }
}

export const isPrototypeHtml = (mediaType: string) => mediaType.startsWith("text/html");
export const isPrototypeImage = (mediaType: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(mediaType);

/**
 * The sandbox a prototype is served and framed in. On the app's origin it is a mockup page's
 * (scripts, forms whose submissions go nowhere, links that open a tab); on a content site of its
 * own it may also show alert, confirm and prompt, which there name the content site, not WhatBuild.
 * Never allow-same-origin.
 */
export function prototypeSandbox(contentSite: boolean): string {
  return contentSite ? `${MOCKUP_PAGE_SANDBOX} allow-modals` : MOCKUP_PAGE_SANDBOX;
}

/**
 * The headers every prototype response carries, whatever it holds. `base` is the absolute address
 * of the prototype's root, ending in `/`: the policy's only source, so a prototype loads, fetches,
 * frames and rebases within its own version and nowhere else. An opaque origin's own loads are
 * cross-origin, and it fetches module scripts and fonts with CORS, so the response may be read by
 * any origin without credentials, which the grant in its address alone authorizes. Its documents
 * set no frame-ancestors: that directive refuses any frame with an opaque-origin ancestor, which
 * would break a prototype's own iframes, and a prototype's document holds nothing to protect.
 */
export function prototypeResponseHeaders(base: string, mediaType: string, contentSite: boolean): Record<string, string> {
  const csp = [
    `sandbox ${prototypeSandbox(contentSite)}`,
    "default-src 'none'",
    `script-src ${base} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base} data:`,
    `media-src ${base} data: blob:`,
    `connect-src ${base}`,
    `frame-src ${base}`,
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    `base-uri ${base}`,
    "form-action 'none'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Content-Type": mediaType,
    ...(mediaType === "application/octet-stream" ? { "Content-Disposition": "attachment" } : {}),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "private, no-store",
  };
}

/** When a grant minted now expires, in seconds since the epoch: its lifetime, rounded up to the hour, so an address stays put. */
export function prototypeGrantExpiry(nowMs: number, ttlSeconds: number): number {
  return Math.ceil((nowMs / 1000 + ttlSeconds) / 3600) * 3600;
}

/** How long a prototype's address lasts unless the deployment says otherwise. */
export const PROTOTYPE_GRANT_SECONDS = 8 * 3600;

/**
 * The address a version's prototype is served under, for a frame to open now: a grant for that one
 * version, naming nobody, its expiry rounded up to the hour so the address stays put. On the app's
 * origin, or on the content site when the deployment has one; `sandbox` is what the frame must say.
 */
export function prototypeAddress(ports: Pick<Ports, "grants" | "config">, tenant: string, versionId: string, now: string) {
  const exp = prototypeGrantExpiry(Date.parse(now), ports.config.prototypeGrantSeconds ?? PROTOTYPE_GRANT_SECONDS);
  const token = ports.grants.sign({ v: 1, purpose: PROTOTYPE_GRANT_PURPOSE, t: tenant, xv: versionId, exp });
  const site = ports.config.contentBaseUrl ?? null;
  return { base_url: `${site ?? ports.config.publicBaseUrl}${PROTOTYPE_ROUTE}/${token}/`, expires_at: new Date(exp * 1000).toISOString(), sandbox: prototypeSandbox(Boolean(site)) };
}

/**
 * What a Story page showing a prototype's entry has in place of HTML of its own, where HTML is
 * needed (its hash, the HTML route, the print view): a notice, with the page's poster when it has
 * one. The app frames the entry itself.
 */
export function prototypeNotice(poster?: { media_type: string; data: Uint8Array } | null): string {
  const img = poster ? `<p><img alt="" style="max-width:100%;border:1px solid #ddd" src="data:${poster.media_type};base64,${Buffer.from(poster.data).toString("base64")}"></p>` : "";
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A prototype</title>' +
    "<style>.wb-prototype{font:15px/1.5 system-ui,sans-serif;border:1px solid #ccc;border-radius:8px;padding:16px 20px}</style></head>" +
    `<body><div class="wb-prototype"><p>This page is an interactive prototype. Open it in WhatBuild to use it.</p>${img}</div></body></html>`
  );
}

/**
 * The stored path a request names, from the part of its address after the grant, still
 * percent-encoded: each part decoded strictly, an empty path or one ending in `/` naming its
 * index.html. Null for anything a stored path cannot be (an encoded `/` or `\`, a dot part,
 * malformed encoding).
 */
export function requestedPrototypePath(rest: string): string | null {
  const parts = rest.split("/");
  const decoded: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "" && i === parts.length - 1) {
      decoded.push("index.html");
      continue;
    }
    let d: string;
    try {
      d = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (!d || d.includes("/") || d.includes("\\") || d === "." || d === "..") return null;
    decoded.push(d);
  }
  const p = prototypePath(decoded.join("/"));
  return "path" in p ? p.path : null;
}

/** Browser APIs a prototype's scripts may reach for that an opaque origin does not have: each throws there. */
const STATE_APIS: [string, RegExp][] = [
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["indexedDB", /\bindexedDB\b/],
  ["document.cookie", /\bdocument\s*\.\s*cookie\b/],
];

type Node = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[]; content?: Node; value?: string };

const LENIENT_UTF8 = new TextDecoder("utf-8");
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)|@import\s+(['"])([^'"]+)\3/gi;
const RESOURCE_ATTRS = new Set(["src", "poster", "data"]);

/**
 * What publish says about a prototype it accepted, without refusing anything: addresses that will
 * not load (root-relative, remote, or naming a file the prototype does not hold) and scripts that
 * use browser storage or cookies, which the sandbox does not have. Each names its file.
 */
export function prototypeWarnings(files: { path: string; media_type: string; data: Uint8Array }[]): string[] {
  const held = new Set(files.map((f) => f.path));
  const out = new Set<string>();
  const add = (w: string) => out.add(w);
  const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

  const checkAddress = (file: string, raw: string, kind: "load" | "link") => {
    const u = raw.trim();
    if (!u || /^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(u)) return;
    if (u.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(u)) {
      if (kind === "load") add(`${file} loads ${u.slice(0, 120)}, from elsewhere: a prototype has no network, so it will not load.`);
      return;
    }
    if (u.startsWith("/")) {
      add(`${file} names ${u.slice(0, 120)}, a root-relative address, which points outside the prototype and will not ${kind === "load" ? "load" : "open"}: build with a relative base (./).`);
      return;
    }
    const pathPart = u.split(/[?#]/)[0]!;
    if (!pathPart) return;
    const segments = (dirOf(file) + pathPart).split("/");
    const resolved: string[] = [];
    for (const seg of segments) {
      if (seg === "..") resolved.pop();
      else if (seg !== ".") resolved.push(seg);
    }
    let target: string;
    try {
      target = resolved.map((s) => decodeURIComponent(s)).join("/").normalize("NFC");
    } catch {
      return;
    }
    if (target.endsWith("/") || target === "") target += "index.html";
    if (!held.has(target)) add(`${file} names ${u.slice(0, 120)}, which the prototype does not hold.`);
  };
  const checkCss = (file: string, css: string) => {
    for (const m of css.matchAll(CSS_URL)) checkAddress(file, m[2] ?? m[4] ?? "", "load");
  };
  const checkScript = (text: string, found: Set<string>) => {
    for (const [name, re] of STATE_APIS) if (re.test(text)) found.add(name);
  };
  const reportState = (file: string, found: Set<string>) => {
    if (!found.size) return;
    const names = STATE_APIS.map(([name]) => name).filter((name) => found.has(name));
    add(`${file} uses ${names.join(", ")}: unavailable in WhatBuild's sandbox, and ${names.length === 1 ? "it throws" : "each throws"}; guard ${names.length === 1 ? "it" : "them"} or remove ${names.length === 1 ? "it" : "them"}.`);
  };

  for (const f of files) {
    const type = f.media_type;
    if (isPrototypeHtml(type)) {
      const html = LENIENT_UTF8.decode(f.data);
      let doc: Node;
      try {
        doc = parseHtml(html) as unknown as Node;
      } catch (e) {
        add(`${f.path} could not be checked: ${e instanceof HtmlLimitError ? e.message : "it could not be parsed"}.`);
        continue;
      }
      const found = new Set<string>();
      const walk = (n: Node) => {
        const tag = n.tagName?.toLowerCase();
        if (tag) {
          for (const a of n.attrs ?? []) {
            const name = a.name.toLowerCase();
            if (RESOURCE_ATTRS.has(name) || (name === "href" && (tag === "link" || tag === "image" || tag === "use")) || name === "xlink:href") checkAddress(f.path, a.value, "load");
            else if (name === "srcset") for (const part of a.value.split(",")) checkAddress(f.path, part.trim().split(/\s+/)[0] ?? "", "load");
            else if (name === "href" && tag === "a") checkAddress(f.path, a.value, "link");
            else if (name === "style") checkCss(f.path, a.value);
            if (name.startsWith("on") || /^\s*javascript:/i.test(a.value)) checkScript(a.value, found);
          }
          if (tag === "style") checkCss(f.path, (n.childNodes ?? []).map((c) => c.value ?? "").join(""));
          if (tag === "script") checkScript((n.childNodes ?? []).map((c) => c.value ?? "").join(""), found);
        }
        for (const c of n.childNodes ?? []) walk(c);
        if (n.content) walk(n.content);
      };
      walk(doc);
      reportState(f.path, found);
    } else if (type.startsWith("text/css")) {
      checkCss(f.path, LENIENT_UTF8.decode(f.data));
    } else if (type.startsWith("text/javascript")) {
      const found = new Set<string>();
      checkScript(LENIENT_UTF8.decode(f.data), found);
      reportState(f.path, found);
    }
  }
  const all = [...out];
  return all.length > MAX_WARNINGS ? [...all.slice(0, MAX_WARNINGS), `…and ${all.length - MAX_WARNINGS} more.`] : all;
}
