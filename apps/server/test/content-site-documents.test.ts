import { DOWNLOAD_GRANT_HEADER } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HmacGrantSigner } from "../src/adapters/misc.ts";
import { createApp, createPorts } from "../src/app.ts";
import { addressInstruction } from "../src/mcp.ts";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// With a content site (WHATBUILD_CONTENT_URL), no route on the app's origin answers with a document
// of people's or agents' HTML, or with a PDF to show inline: the app's route makes its checks, then
// hands the browser to the content site under a grant for that one document and requester, which
// the content site checks again before it sends a byte (content-documents.ts).

let h: Harness;
/** The same database and files, served by an app without a content site: what each route gave before. */
let plain: ReturnType<typeof createApp>;
let content: string;
let alice: Browser;
let bob: Browser;
let rita: Browser;
let mallory: Browser;
let T: string;
let team: string;
let P: string;
let mockupId: string;
let outcomeId: string;
let pdfSource: string;
let htmlSource: string;

const FRONT = '<p class="wb-pitch">Crews get their <em>Friday</em> back.</p>';
const PDF = "%PDF-1.4\n%%EOF\n";
const UPLOADED = '<!doctype html><title>Uploaded</title><p style="color:#a00">Hello from a file.</p><script>parent.postMessage("x","*")</script>';
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

async function upload(path: string, body: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { title: `Upload of ${path}`, path });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body })).status).toBe(201);
  return created.body.record.record_id as string;
}

/** Every kind of document the app shows, by the app's own address, with the query its frame or link sends. */
const kinds = (): [string, string][] => [
  ["a Story page", `${P}/story/pages/overview/versions/1/html?theme=dark&frame=1`],
  ["a Story page showing a mockup page", `${P}/story/pages/board-page/versions/1/html?frame=1`],
  ["a mockup page", `${P}/mockups/${mockupId}/versions/1/pages/board/html?frame=1`],
  ["the product's style's specimen", `${P}/story/style/specimen?theme=light&frame=1`],
  ["a house style's specimen", `${P}/story/house-styles/clear/specimen?theme=dark&frame=1`],
  ["the concept's card", `${P}/idea/concept/card?theme=light&v=1`],
  ["an outcome's card", `${P}/outcomes/${outcomeId}/card?theme=dark`],
  ["the print view", `${P}/story/print?page_ids=overview,board-page`],
  ["a PDF", `${P}/sources/${pdfSource}/attachment?path=plan.pdf`],
  ["an uploaded HTML page", `${P}/sources/${htmlSource}/attachment/view?path=page.html`],
];

/** The app's answer to `b` for `path`, not followed. */
const atApp = (b: Browser | null, path: string, headers: Record<string, string> = {}) =>
  fetch(`${h.baseUrl}${path}`, { headers: { ...(b ? { cookie: b.cookie } : {}), ...headers }, redirect: "manual" });

/** The content site's address the app hands `b` to for `path`. */
async function addressFor(b: Browser, path: string) {
  const r = await atApp(b, path);
  expect(r.status, `${path}: ${await r.clone().text()}`).toBe(302);
  return r.headers.get("location")!;
}

/** A fetch of a content address as a frame makes it: no cookie, never following a redirect. */
const open = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, redirect: "manual" });

/** A document's text with what differs between two responses of it taken out: the nonce its script runs by, and the time a print view was made. */
const steady = (s: string) => s.replace(/nonce-[A-Za-z0-9+/=_-]+/g, "nonce-N").replace(/nonce="[A-Za-z0-9+/=_-]+"/g, 'nonce="N"').replace(/datetime="[^"]*"/g, 'datetime=""');

/** A grant's claims, and the grant signed again with some of them changed, as only someone holding the deployment's key could. */
function claimsOf(address: string) {
  const token = new URL(address).pathname.split("/")[2]!;
  return JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
}
function resigned(address: string, change: Record<string, unknown>) {
  const url = new URL(address);
  const parts = url.pathname.split("/");
  parts[2] = new HmacGrantSigner(h.config.grantKey).sign({ ...claimsOf(address), ...change });
  url.pathname = parts.join("/");
  return url.href;
}

beforeAll(async () => {
  h = await startHarness((app) => ({ contentUrl: app.replace("localhost", "127.0.0.1") }));
  content = h.config.contentUrl!;
  const config = { ...h.config, contentUrl: null };
  plain = createApp({ db: h.db, ports: createPorts(config, h.blobs, h.mailer), config });
  alice = await h.signIn("alice@example.com", "Alice Admin");
  bob = await h.signIn("bob@example.com", "Bob Editor");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  mallory = await h.signIn("mallory@example.com", "Mallory Elsewhere");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Content Co" });
  T = `/api/v1/tenants/${t.body.tenant.slug}`;
  team = t.body.team.slug;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${team}/products`, { name: "Planner", concept: "A planner for crews." });
  P = `/api/v1/p/${p.body.path}`;
  await mallory.api("POST", "/api/v1/tenants", { name: "Elsewhere Co" });
  for (const id of ["overview", "aside"])
    expect((await alice.api("POST", `${P}/story/pages/${id}/versions`, { title: id, html: page(id, `<h1>${id}</h1><p><a href="/t/x">In the app</a></p>`) })).status).toBe(201);
  const m = await alice.api("POST", `${P}/mockups`, { title: "Board", brief: "One board.", pages: [{ page_id: "board", title: "Board", html: page("Board", "<p>Jobs</p>") }] });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  mockupId = m.body.mockup_id;
  expect((await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "board", page_id: "board-page" })).status).toBe(201);
  expect((await alice.api("PUT", `${P}/story/style`, { house_style: "clear" })).status).toBe(200);
  const product = (await alice.api("GET", P)).body;
  expect((await alice.api("PATCH", `${P}/idea/concept`, { expected_etag: product.etag, concept: "A planner for crews.", card_html: FRONT })).status).toBe(200);
  const o = await alice.api("POST", `${P}/outcomes`, { title: "Plan the week in minutes", description: "Planning takes minutes.", card_html: FRONT });
  outcomeId = o.body.outcome_id;
  pdfSource = await upload("plan.pdf", PDF);
  htmlSource = await upload("page.html", UPLOADED);
  await h.worker.drain();
  expect((await alice.api("POST", `${T}/members`, { email: "bob@example.com", role: "editor", team })).status).toBeLessThan(300);
  expect((await alice.api("POST", `${T}/members`, { email: "rita@example.com", role: "reader", team })).status).toBeLessThan(300);
});
afterAll(async () => h?.close());

describe("the app's own address for a document", () => {
  it("checks the session, then hands the browser to the content site, sending no document", async () => {
    for (const [what, path] of kinds()) {
      const r = await atApp(alice, path);
      expect(r.status, what).toBe(302);
      const location = r.headers.get("location")!;
      expect(location.startsWith(`${content}/documents/`), what).toBe(true);
      expect(r.headers.get("cache-control"), what).toBe("no-store");
      expect(r.headers.get("referrer-policy"), what).toBe("no-referrer");
      expect(await r.text(), what).toBe("");
      // The frame's theme and its frame script go along; nothing else of the request does.
      const query = new URL(`http://x${path}`).searchParams;
      const handed = new URL(location).searchParams;
      for (const k of ["theme", "frame"]) expect(handed.get(k), `${what}: ${k}`).toBe(query.get(k));
      expect(handed.get("v"), what).toBeNull();
      // The grant names the requester, the product and the document, and lasts the grant lifetime.
      const claims = claimsOf(location);
      expect(claims, what).toMatchObject({ v: 1, t: expect.any(String), p: expect.any(String), a: (await alice.api("GET", "/api/v1/me")).body.account_id });
      expect(Number(claims["exp"]) - Date.now() / 1000, what).toBeGreaterThan(h.config.grantTtlSeconds - 60);
      expect(Number(claims["exp"]) - Date.now() / 1000, what).toBeLessThanOrEqual(h.config.grantTtlSeconds);
    }
  });

  it("mints a fresh address on every load", async () => {
    const [, path] = kinds()[0]!;
    const first = await addressFor(alice, path);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await addressFor(alice, path)).not.toBe(first);
  });

  it("answers 401 without a session, as before, and mints nothing", async () => {
    for (const [what, path] of kinds()) {
      const r = await atApp(null, path);
      expect(r.status, what).toBe(401);
      expect(r.headers.get("location"), what).toBeNull();
    }
  });

  it("refuses as before what the session may not read, and mints nothing", async () => {
    // A reader reads the Story, and nothing else here.
    for (const [what, path] of kinds()) {
      const r = await atApp(rita, path);
      const story = what.startsWith("a Story page") || what === "the print view";
      expect(r.status, what).toBe(story ? 302 : 403);
    }
    for (const [what, path] of kinds()) {
      const r = await atApp(mallory, path);
      expect(r.status, what).toBe(404);
      expect(r.headers.get("location"), what).toBeNull();
    }
  });

  it("keeps a download and every other attachment on the app's origin", async () => {
    const download = await atApp(alice, `${P}/sources/${pdfSource}/attachment?path=plan.pdf&download=1`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    // An uploaded HTML page's bytes are only ever an attachment to save, wherever they come from.
    const html = await atApp(alice, `${P}/sources/${htmlSource}/attachment?path=page.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("application/octet-stream");
    expect(html.headers.get("content-disposition")).toMatch(/^attachment;/);
  });
});

describe("a document on the content site", () => {
  it("is the document the app's route gave before, under its policy, framed by the app alone", async () => {
    for (const [what, path] of kinds()) {
      const doc = await open(await addressFor(alice, path));
      expect(doc.status, what).toBe(200);
      const before = await plain.request(path, { headers: { cookie: alice.cookie } });
      expect(before.status, what).toBe(200);
      expect(steady(await doc.text()), what).toBe(steady(await before.text()));
      expect(doc.headers.get("content-type"), what).toBe(before.headers.get("content-type"));
      const policy = steady(before.headers.get("content-security-policy")!);
      const ancestors = what === "the print view" ? "frame-ancestors 'none'" : `frame-ancestors ${h.baseUrl}`;
      expect(policy, what).toMatch(what === "the print view" ? /frame-ancestors 'none'$/ : /frame-ancestors 'self'$/);
      expect(steady(doc.headers.get("content-security-policy")!), what).toBe(policy.replace(/frame-ancestors .*$/, ancestors));
      expect(doc.headers.get("cross-origin-resource-policy"), what).toBe("cross-origin");
      expect(doc.headers.get("cross-origin-embedder-policy"), what).toBe("credentialless");
      expect(doc.headers.get("referrer-policy"), what).toBe("no-referrer");
      expect(doc.headers.get("cache-control"), what).toBe("private, no-store");
      expect(doc.headers.get("set-cookie"), what).toBeNull();
      expect(doc.headers.get("x-content-type-options"), what).toBe("nosniff");
      // Every HTML document defines the directives with no fallback.
      if (doc.headers.get("content-type")!.startsWith("text/html"))
        for (const directive of ["frame-ancestors", "form-action", "base-uri"]) expect(doc.headers.get("content-security-policy"), `${what}: ${directive}`).toMatch(new RegExp(`(^|; )${directive} `));
    }
  });

  it("serves an uploaded HTML page in a sandbox that runs no script, and a PDF in ranges", async () => {
    const view = await open(await addressFor(alice, `${P}/sources/${htmlSource}/attachment/view?path=page.html`));
    expect(view.headers.get("content-security-policy")).toBe(
      `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors ${h.baseUrl}`,
    );
    expect(await view.text()).toBe(UPLOADED);
    const pdf = await addressFor(alice, `${P}/sources/${pdfSource}/attachment?path=plan.pdf`);
    const part = await open(pdf, { range: "bytes=0-7" });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("%PDF-1.4");
    expect(part.headers.get("content-range")).toBe(`bytes 0-7/${PDF.length}`);
    expect(new URL(pdf).pathname.endsWith("/plan.pdf")).toBe(true);
  });

  it("answers HEAD as GET, without a body", async () => {
    const r = await fetch(await addressFor(alice, `${P}/story/pages/overview/versions/1/html`), { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain(`frame-ancestors ${h.baseUrl}`);
    expect(await r.text()).toBe("");
  });

  it("takes no session: a cookie or an Authorization header neither stands in for a grant nor changes what one serves", async () => {
    const address = await addressFor(alice, `${P}/outcomes/${outcomeId}/card?theme=dark`);
    const alone = steady(await (await open(address)).text());
    for (const headers of [{ cookie: mallory.cookie }, { cookie: alice.cookie }, { authorization: "Bearer not-a-token" }] as Record<string, string>[]) {
      const r = await open(address, headers);
      expect(r.status).toBe(200);
      expect(steady(await r.text())).toBe(alone);
    }
    const none = await open(`${content}/documents/not-a-grant/card.html`, { cookie: alice.cookie });
    expect(none.status).toBe(401);
    expect(await none.text()).toBe("This address has expired. Open it again in WhatBuild.");
  });

  it("refuses a grant for another kind, an altered or expired one, any other grant, and one used on the app's host", async () => {
    const story = await addressFor(alice, `${P}/story/pages/overview/versions/1/html`);
    const mockup = await addressFor(alice, `${P}/mockups/${mockupId}/versions/1/pages/board/html`);
    const pdf = await addressFor(alice, `${P}/sources/${pdfSource}/attachment?path=plan.pdf`);
    // Each kind finds only its own: a Story page's grant read as a mockup page's, or the other way round, finds nothing.
    expect((await open(resigned(story, { purpose: "mockup_page" }))).status).toBe(404);
    expect((await open(resigned(mockup, { purpose: "story_page" }))).status).toBe(404);
    expect((await open(resigned(story, { purpose: "attachment" }))).status).toBe(404);
    expect((await open(resigned(story, { sv: claimsOf(mockup)["xv"] }))).status).toBe(404);
    // Grants for anything else are not a document's.
    for (const purpose of ["download", "prototype", "story_preview", "export"]) expect((await open(resigned(story, { purpose }))).status, purpose).toBe(401);
    // Nor is a document's grant anything else's: the agents' download route refuses an attachment's.
    const fv = claimsOf(pdf)["fv"];
    const token = new URL(pdf).pathname.split("/")[2]!;
    expect((await fetch(`${h.baseUrl}/api/v1/downloads/${fv}`, { headers: { [DOWNLOAD_GRANT_HEADER]: token } })).status).toBe(401);
    // A changed claim breaks the signature.
    const url = new URL(story);
    const [payload, mac] = url.pathname.split("/")[2]!.split(".") as [string, string];
    const altered = Buffer.from(JSON.stringify({ ...claimsOf(story), sv: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toString("base64url");
    expect(payload).not.toBe(altered);
    expect((await open(story.replace(`${payload}.${mac}`, `${altered}.${mac}`))).status).toBe(401);
    // An expired grant.
    const expired = await open(resigned(story, { exp: Math.floor(Date.now() / 1000) - 1 }));
    expect(expired.status).toBe(401);
    expect(await expired.text()).toBe("This address has expired. Open it again in WhatBuild.");
    // On the app's own host, the content site's path serves nothing.
    expect((await open(story.replace(content, h.baseUrl))).status).toBe(404);
  });

  it("stops at once for someone removed from the organization, and sends nothing", async () => {
    const held = await Promise.all(kinds().map(async ([what, path]) => [what, await addressFor(bob, path)] as const));
    const bobId = (await bob.api("GET", "/api/v1/me")).body.account_id;
    expect((await alice.api("POST", `${T}/members/revoke`, { account_id: bobId, whole_tenant: true })).status).toBeLessThan(300);
    try {
      for (const [what, address] of held) {
        const r = await open(address);
        expect(r.status, what).toBe(403);
        expect(r.headers.get("content-type"), what).toBe("text/plain; charset=utf-8");
        expect(await r.text(), what).toBe("Whoever requested this grant can no longer read this product. Nothing was sent.");
      }
    } finally {
      expect((await alice.api("POST", `${T}/members`, { email: "bob@example.com", role: "editor", team })).status).toBeLessThan(300);
    }
  });

  it("gives someone lowered to reader the live Story and nothing else", async () => {
    const held = await Promise.all(kinds().map(async ([what, path]) => [what, await addressFor(bob, path)] as const));
    expect((await alice.api("POST", `${T}/members`, { email: "bob@example.com", role: "reader", team })).status).toBeLessThan(300);
    try {
      for (const [what, address] of held) expect((await open(address)).status, what).toBe(what.startsWith("a Story page") || what === "the print view" ? 200 : 403);
    } finally {
      expect((await alice.api("POST", `${T}/members`, { email: "bob@example.com", role: "editor", team })).status).toBeLessThan(300);
    }
  });

  it("gives a reader nothing of a page archived since its address was issued", async () => {
    const page = await addressFor(rita, `${P}/story/pages/aside/versions/1/html`);
    const print = await addressFor(rita, `${P}/story/print?page_ids=overview,aside`);
    expect((await open(page)).status).toBe(200);
    const etag = (await alice.api("GET", `${P}/story/pages/aside?include_html=false`)).body.etag;
    expect((await alice.api("POST", `${P}/story/pages/aside/archive`, { expected_etag: etag })).status).toBe(200);
    try {
      expect((await open(page)).status).toBe(404);
      expect((await open(print)).status).toBe(404);
      // Its editors still see it, archived.
      expect((await open(await addressFor(alice, `${P}/story/pages/aside/versions/1/html`))).status).toBe(200);
    } finally {
      const now = (await alice.api("GET", `${P}/story/pages/aside?include_html=false`)).body.etag;
      expect((await alice.api("POST", `${P}/story/pages/aside/restore`, { expected_etag: now })).status).toBe(200);
    }
  });

  it("finds nothing at an address issued before a card's front or the Story style changed; the app's address gives a new one", async () => {
    const card = await addressFor(alice, `${P}/idea/concept/card?theme=light`);
    const specimen = await addressFor(alice, `${P}/story/style/specimen?theme=light`);
    const product = (await alice.api("GET", P)).body;
    expect((await alice.api("PATCH", `${P}/idea/concept`, { expected_etag: product.etag, concept: "A planner for crews.", card_html: `${FRONT}<p class="wb-note">Now with notes.</p>` })).status).toBe(200);
    const style = (await alice.api("GET", `${P}/story/style`)).body.style;
    expect((await alice.api("PUT", `${P}/story/style`, { house_style: "report", expected_etag: style.etag })).status).toBe(200);
    for (const old of [card, specimen]) {
      const r = await open(old);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("This document has changed or no longer exists. Open it again in WhatBuild.");
    }
    const fresh = await open(await addressFor(alice, `${P}/idea/concept/card?theme=light`));
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toContain("Now with notes.");
    expect((await open(await addressFor(alice, `${P}/story/style/specimen?theme=light`))).status).toBe(200);
  });
});

describe("the content site", () => {
  it("serves nothing of the app's", async () => {
    const fv = claimsOf(await addressFor(alice, `${P}/sources/${pdfSource}/attachment?path=plan.pdf`))["fv"];
    for (const path of ["/", "/api/v1/me", `${P}/story/pages/overview/versions/1/html`, `/api/v1/downloads/${fv}`, "/t/x/y/z", "/mcp", "/auth/methods"]) {
      const r = await fetch(`${content}${path}`, { headers: { cookie: alice.cookie, "sec-fetch-mode": "navigate" }, redirect: "manual" });
      expect(r.status, path).toBe(404);
    }
  });

  it("serves agents' previews of a page and a card, which the app's host no longer does", async () => {
    const story = await alice.api("POST", `${P}/story/pages/friday/preview`, { title: "Friday", html: page("Friday", "<h1>Friday</h1>") });
    expect(story.status, JSON.stringify(story.body)).toBe(200);
    const card = await alice.api("POST", `${P}/idea/card-preview`, { card_html: FRONT, title: "Plan the week", back: "Planning takes minutes." });
    expect(card.status, JSON.stringify(card.body)).toBe(200);
    for (const preview of [story.body.preview, card.body.preview]) {
      expect(preview.url.startsWith(`${content}/api/v1/downloads/`)).toBe(true);
      const there = await fetch(`${preview.url}?theme=dark`, { headers: preview.headers });
      expect(there.status).toBe(200);
      expect(there.headers.get("content-security-policy")).toContain(`frame-ancestors ${h.baseUrl}`);
      expect(there.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      expect(there.headers.get("cache-control")).toBe("private, no-store");
      const here = await fetch(preview.url.replace(content, h.baseUrl), { headers: preview.headers });
      expect(here.status).toBe(404);
      expect(((await here.json()) as { error: { message: string } }).error.message).toContain(`serves previews from its content site, ${content}`);
    }
  });
});

describe("agents", () => {
  it("are told to fetch the content site's addresses as given, and to write links with the app's", () => {
    const told = addressInstruction(h.baseUrl, content);
    expect(told).toContain(`This deployment's address is ${h.baseUrl}. Write every link to WhatBuild with it`);
    expect(told).toContain(`Its content site, ${content}, serves previews and prototypes: fetch an address the server gives there (a preview's url, a prototype_url) exactly as given, and never write a link with it.`);
    expect(addressInstruction(h.baseUrl)).not.toContain("content site");
  });
});

describe("the app's pages", () => {
  it("frame the content site's prototypes and documents, and allow no inline style", async () => {
    const { pageHeaders } = await import("../src/public-routes.ts");
    const csp = pageHeaders(false, content)["Content-Security-Policy"];
    expect(csp).toContain(`frame-src 'self' ${content}/prototypes/ ${content}/documents/;`);
    expect(csp).toMatch(/(^|; )style-src 'self' https:\/\/fonts\.googleapis\.com;/);
    expect(csp).not.toContain("'unsafe-inline'");
  });
});

describe("a document in the example organization", () => {
  it("reaches a guest through the hand-off, counted once, and stops once the organization is no longer the example", async () => {
    const owner = await h.signIn("owen@example.com", "Owen Owner");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Example Co" });
    const p = await owner.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Open" });
    const Q = `/api/v1/p/${p.body.path}`;
    expect((await owner.api("POST", `${Q}/story/pages/welcome/versions`, { title: "Welcome", html: page("Welcome", "<h1>Welcome</h1>") })).status).toBe(201);
    expect(await syncExampleTenant(h.db, t.body.tenant.slug, () => {})).toBeTruthy();
    const guest = await h.signIn("gus@example.com", "Gus Guest");
    try {
      const address = await addressFor(guest, `${Q}/story/pages/welcome/versions/1/html`);
      const r = await open(address);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain("<h1>Welcome</h1>");
      // A guest meets the limit on calls a minute at the app's address; the content site counts nothing more.
      await h.db.updateTable("tenants").set({ limits: JSON.stringify({ requests_per_minute: 0 }) }).where("tenant_id", "=", t.body.tenant.tenant_id).execute();
      expect((await atApp(guest, `${Q}/story/pages/welcome/versions/1/html`)).status).toBe(429);
      expect((await open(address)).status).toBe(200);
      // The example's own people are on its plan, which is unlimited.
      expect((await atApp(owner, `${Q}/story/pages/welcome/versions/1/html`)).status).toBe(302);
      await syncExampleTenant(h.db, null, () => {});
      expect((await open(address)).status).toBe(403);
    } finally {
      await syncExampleTenant(h.db, null, () => {});
    }
  });
});

describe("a document in a free organization", () => {
  it("counts against its limits once, at the app's address, and not again on the content site", async () => {
    const tenantId = claimsOf(await addressFor(alice, `${P}/story/pages/overview/versions/1/html`))["t"] as string;
    const address = await addressFor(alice, `${P}/story/pages/overview/versions/1/html`);
    await h.db.updateTable("tenants").set({ plan: "free", limits: JSON.stringify({ requests_per_minute: 0 }) }).where("tenant_id", "=", tenantId).execute();
    try {
      expect((await atApp(alice, `${P}/story/pages/overview/versions/1/html`)).status).toBe(429);
      expect((await open(address)).status).toBe(200);
    } finally {
      await h.db.updateTable("tenants").set({ plan: "unlimited", limits: "{}" }).where("tenant_id", "=", tenantId).execute();
    }
  });
});
