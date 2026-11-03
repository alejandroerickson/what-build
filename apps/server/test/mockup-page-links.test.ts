import { clickableCanvas, FRAME_SCRIPT, frameScript, linkedPageName, mockupIndexHtml } from "@whatbuild/core";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

const page = (heading: string, body = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1>${body}</body></html>`;

describe("what a canvas's pages say of each other", () => {
  it("reads a relative address as the page it names, and nothing else as one", () => {
    expect(linkedPageName("checkout.html")).toBe("checkout");
    expect(linkedPageName("./checkout.htm")).toBe("checkout");
    expect(linkedPageName("../pages/checkout.html#step-2")).toBe("checkout");
    expect(linkedPageName("checkout")).toBe("checkout");
    for (const href of ["", "#place", "/t/acme/core/planner/evidence/1", "https://example.com/a.html", "mailto:a@example.com", "?plan=pro"]) expect(linkedPageName(href)).toBeNull();
  });

  it("counts links between pages, leaves out a page's link to itself, and names what leads nowhere", () => {
    const c = clickableCanvas([
      { page_id: "home", entry: null, html: page("Home", '<a href="checkout.html">Go</a> <a href="home.html">Top</a> <a href="#x">Down</a> <a href="https://example.com">Out</a> <a href="last-week.html">Old</a>') },
      { page_id: "checkout", entry: null, html: page("Checkout", "<a href='home.html'>Back</a>") },
    ]);
    expect(c).toEqual({ viewable: true, links_between_pages: 2, broken: [{ page_id: "home", href: "last-week.html" }] });
  });

  it("says how while a canvas has no links, and offers nothing for one page", () => {
    const pages = [
      { page_id: "a", entry: null, html: page("A") },
      { page_id: "b", entry: null, html: page("B") },
    ];
    expect(clickableCanvas(pages)).toMatchObject({ viewable: false, links_between_pages: 0, how: expect.stringContaining("page_id.html") });
    expect(clickableCanvas([{ page_id: "a", entry: null, html: page("A", '<a href="b.html">B</a>') }]).viewable).toBe(false);
  });

  it("counts a page that enters a prototype as clickable, since the prototype holds its links", () => {
    const pages = [
      { page_id: "a", entry: "index.html", html: null },
      { page_id: "b", entry: null, html: page("B") },
    ];
    expect(clickableCanvas(pages)).toMatchObject({ viewable: true, links_between_pages: 0 });
  });

  it("reads thousands of unclosed attributes without slowing down", () => {
    const hostile = 'href="'.repeat(150_000);
    const started = performance.now();
    clickableCanvas([{ page_id: "a", entry: null, html: hostile }, { page_id: "b", entry: null, html: "" }]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("makes an index that escapes what it names and starts at the first page", () => {
    const html = mockupIndexHtml({ title: "Plans & <b>more</b>", n: 3 }, [
      { page_id: "first", title: "The <first>", entry: null },
      { page_id: "door", title: "A door", entry: "app/a b.html?plan=pro" },
    ]);
    expect(html).toContain("Plans &amp; &lt;b&gt;more&lt;/b&gt;");
    expect(html).toContain('<a href="pages/first.html"><strong>Start at The &lt;first&gt;</strong></a>');
    expect(html).toContain('href="prototype/app/a%20b.html?plan=pro"');
    expect(html).toContain("run their own code");
  });
});

describe("the frame script on a canvas", () => {
  it("sends a link's page by name, adds no capability, and still parses", () => {
    expect(FRAME_SCRIPT).toContain('whatbuild:"canvas-page"');
    expect(FRAME_SCRIPT).toContain('e.data.whatbuild==="canvas-host"');
    expect(FRAME_SCRIPT).not.toMatch(/innerHTML|textContent|document\.cookie|location/);
    expect(() => new Function(FRAME_SCRIPT)).not.toThrow();
    expect(() => new Function(frameScript({ base: "https://example.com/prototypes/g/", inPlace: true }))).not.toThrow();
  });
});

describe("the frame script, as its document loads", () => {
  it("says it has loaded once the document's load event comes, and not while the document is still parsing", () => {
    for (const script of [FRAME_SCRIPT, frameScript({ base: "https://usercontent.example.net/prototypes/g/", inPlace: false })]) {
      const sent: unknown[] = [];
      const load: (() => void)[] = [];
      new Function("addEventListener", "parent", script)((type: string, fn: () => void) => void (type === "load" && load.push(fn)), { postMessage: (m: unknown) => void sent.push(m) });
      // A page that sends its frame elsewhere while it loads never reaches this point, so the app puts it back.
      expect(sent).toEqual([]);
      expect(load).toHaveLength(1);
      load[0]!();
      expect(sent).toEqual([{ whatbuild: "frame-ready" }]);
    }
  });
});

describe("a click on a link inside a canvas's page", () => {
  /** The frame script in a stand-in for a page: a click reaches its capturing listener, the page's own handler, then its last listener. */
  function click(raw: string, opts: { canvas?: boolean; pages?: boolean; proto?: string; entries?: Record<string, string>; pageHandled?: boolean; meta?: boolean } = {}) {
    const capture: ((e: unknown) => void)[] = [];
    const after: ((e: unknown) => void)[] = [];
    const listeners: Record<string, (e: unknown) => void> = {};
    const sent: unknown[] = [];
    const parent = { postMessage: (m: { whatbuild: string }) => void (m.whatbuild === "frame-active" || m.whatbuild === "frame-ready" ? null : sent.push(m)) };
    const attrs: Record<string, string> = { href: raw };
    const a = {
      href: new URL(raw, opts.proto ?? "https://usercontent.example.net/documents/grant/page.html").href,
      getAttribute: (n: string) => attrs[n] ?? null,
      setAttribute: (n: string, v: string) => void (attrs[n] = v),
      hasAttribute: (n: string) => n in attrs,
    };
    const script = opts.proto ? frameScript({ base: opts.proto, inPlace: true }) : FRAME_SCRIPT;
    new Function("addEventListener", "parent", script)((type: string, fn: (e: unknown) => void, useCapture?: unknown) => {
      if (type === "click") (useCapture === true ? capture : after).push(fn);
      else listeners[type] = fn;
    }, parent);
    if (opts.pages) listeners["message"]!({ source: parent, data: { whatbuild: "page-links" } });
    else if (opts.canvas !== false) listeners["message"]!({ source: parent, data: { whatbuild: "canvas-host", ...(opts.entries ? { entries: opts.entries } : {}) } });
    const e = { target: { closest: () => a }, button: 0, defaultPrevented: false, metaKey: Boolean(opts.meta), ctrlKey: false, shiftKey: false, altKey: false, preventDefault() { this.defaultPrevented = true; } };
    capture.forEach((fn) => fn(e));
    if (opts.pageHandled) e.preventDefault();
    const handledByPage = e.defaultPrevented;
    after.forEach((fn) => fn(e));
    return { sent, prevented: e.defaultPrevented && !handledByPage, target: attrs["target"] };
  }

  it("sends the page a relative link names to the app, and stays where it is", () => {
    expect(click("checkout.html")).toEqual({ sent: [{ whatbuild: "canvas-page", page: "checkout", hash: "" }], prevented: true, target: undefined });
    expect(click("./checkout.htm#step-2").sent).toEqual([{ whatbuild: "canvas-page", page: "checkout", hash: "step-2" }]);
    // A new tab would have no address for another page of the canvas.
    expect(click("checkout.html", { meta: true })).toMatchObject({ sent: [{ page: "checkout" }], prevented: true });
  });

  it("leaves alone what the page handled itself, a fragment and a link elsewhere", () => {
    expect(click("checkout.html", { pageHandled: true }).sent).toEqual([]);
    expect(click("#place").sent).toEqual([]);
    expect(click("https://example.com/a.html")).toEqual({ sent: [], prevented: false, target: "_blank" });
  });

  it("off a canvas, opens a relative link in a new tab as it always has", () => {
    expect(click("checkout.html", { canvas: false })).toEqual({ sent: [], prevented: false, target: "_blank" });
  });

  it("on a mockup page shown alone, hands a relative link to the app by name when the app says so, and opens no tab", () => {
    expect(click("checkout.html#total", { pages: true })).toEqual({ sent: [{ whatbuild: "canvas-page", page: "checkout", hash: "total" }], prevented: true, target: undefined });
    expect(click("https://example.com/a.html", { pages: true })).toEqual({ sent: [], prevented: false, target: "_blank" });
    // In a prototype the frame keeps its own links: no other page enters them there.
    expect(click("other.html", { pages: true, proto: "https://usercontent.example.net/prototypes/grant/" })).toMatchObject({ sent: [], prevented: false });
  });

  it("in a prototype, moves to a document another page enters, and leaves any other in the frame", () => {
    const proto = "https://usercontent.example.net/prototypes/grant/";
    const entries = { "about.html": "about-page" };
    expect(click("about.html", { proto, entries }).sent).toEqual([{ whatbuild: "canvas-page", page: "about-page", hash: "" }]);
    expect(click("other.html", { proto, entries })).toMatchObject({ sent: [], prevented: false });
  });
});

describe("a canvas's links, through both doors", () => {
  let h: Harness;
  let alice: Browser;
  let rita: Browser;
  let P: string;
  let id: string;

  beforeAll(async () => {
    h = await startHarness();
    alice = await h.signIn("alice@example.com", "Alice Admin");
    rita = await h.signIn("rita@example.com", "Rita Reader");
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Links Co" });
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner", concept: "A planner." });
    P = `/api/v1/p/${p.body.path}`;
    expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "rita@example.com", role: "reader" })).status).toBeLessThan(300);
    const made = await alice.api("POST", `${P}/mockups`, {
      title: "Send the week",
      brief: "A flow.",
      pages: [
        { page_id: "jobs", title: "Jobs", html: page("Jobs", '<a href="days.html">Days</a> <a href="gone.html">Gone</a>') },
        { page_id: "days", title: "Days", html: page("Days", '<a href="jobs.html">Jobs</a>') },
      ],
    });
    expect(made.status).toBe(201);
    id = made.body.mockup_id;
    expect(made.body.clickable).toEqual({ viewable: true, links_between_pages: 2, broken: [{ page_id: "jobs", href: "gone.html" }], url: `${made.body.url}?view=clickable` });
  });
  afterAll(async () => h?.close());

  const get = (b: Browser, path: string) => fetch(`${h.baseUrl}${path}`, { headers: { cookie: b.cookie } });

  it("says so when the canvas is read, and for an earlier version as it was", async () => {
    const got = await alice.api("GET", `${P}/mockups/${id}`);
    expect(got.body.current.clickable).toMatchObject({ viewable: true, links_between_pages: 2 });
    const etag = got.body.etag;
    const next = await alice.api("POST", `${P}/mockups`, {
      mockup_id: id,
      expected_etag: etag,
      pages: [
        { page_id: "jobs", html: page("Jobs") },
        { page_id: "days", html: page("Days") },
      ],
    });
    expect(next.body.clickable).toMatchObject({ viewable: false, links_between_pages: 0, how: expect.any(String) });
    expect(next.body.clickable.url).toBeUndefined();
    const first = await alice.api("GET", `${P}/mockups/${id}/versions/1`);
    expect(first.body.clickable.viewable).toBe(true);
  });

  it("gives one page's HTML to save, byte for byte, and never to render", async () => {
    const res = await get(alice, `${P}/mockups/${id}/versions/1/pages/jobs/html?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="jobs.html"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(await res.text()).toBe(page("Jobs", '<a href="days.html">Days</a> <a href="gone.html">Gone</a>'));
  });

  it("keeps a Story reader from downloading a page of the mockup", async () => {
    expect((await get(rita, `${P}/mockups/${id}/versions/1/pages/jobs/html?download=1`)).status).toBeGreaterThanOrEqual(400);
  });

  it("on the Story, takes a page's links to the Story pages that show what they name, and tells the agent which lead nowhere", async () => {
    const canvas = await alice.api("POST", `${P}/mockups`, {
      title: "Three steps",
      brief: "A flow.",
      pages: [
        { page_id: "one", title: "One", html: page("One", '<a href="two.html">Two</a> <a href="./three.htm#end">Three</a> <a href="gone.html">Gone</a> <a href="one.html">Here</a>') },
        { page_id: "two", title: "Two", html: page("Two", '<a href="one.html">One</a>') },
        { page_id: "three", title: "Three", html: page("Three") },
      ],
    });
    expect(canvas.status).toBe(201);
    const m = canvas.body.mockup_id;
    const promote = (mockup_page_id: string | undefined, page_id: string) => alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: m, ...(mockup_page_id ? { mockup_page_id } : {}), page_id });
    const shown = async (b: Browser) => (await b.api("GET", `${P}/story/pages/step-one?include_html=false`)).body.current.mockup;

    // Alone on the Story: nothing it links to is there, and the agent is told so. A name no page has, and itself, are no page of the canvas.
    const first = await promote("one", "step-one");
    expect(first.status).toBe(201);
    expect(first.body.links_off_story).toEqual(["two", "three"]);
    expect(first.body.links_off_story_note).toContain("Promote each of them too");
    expect(first.body.current.mockup.story_links).toBeUndefined();
    expect(await shown(rita)).not.toHaveProperty("story_links");
    expect(await shown(rita)).not.toHaveProperty("links_off_story");

    // Another page shown alone, and then the whole canvas: each link leads to one, a page shown alone first.
    expect((await promote("two", "step-two")).body.links_off_story).toBeUndefined();
    expect(await shown(alice)).toMatchObject({ story_links: { two: { page_id: "step-two", on_canvas: false } }, links_off_story: ["three"] });
    expect((await promote(undefined, "all-steps")).status).toBe(201);
    const both = { two: { page_id: "step-two", on_canvas: false }, three: { page_id: "all-steps", on_canvas: true } };
    expect((await shown(alice)).story_links).toEqual(both);
    expect(await shown(alice)).not.toHaveProperty("links_off_story");
    // A reader is given where the links lead, and nothing of which pages lead nowhere.
    expect((await shown(rita)).story_links).toEqual(both);

    // An archived Story page leads nowhere, since a reader can't open it: the whole canvas takes its place.
    const two = await alice.api("GET", `${P}/story/pages/step-two?include_html=false`);
    expect((await alice.api("POST", `${P}/story/pages/step-two/archive`, { expected_etag: two.body.etag })).status).toBe(200);
    expect((await shown(rita)).story_links).toEqual({ two: { page_id: "all-steps", on_canvas: true }, three: { page_id: "all-steps", on_canvas: true } });
  });

  it("names the Story pages a published page links to that a reader can't open, in preview and publish", async () => {
    const path = P.replace("/api/v1/p/", "");
    expect((await alice.api("POST", `${P}/story/pages/there/versions`, { title: "There", body: '<main class="page"><h1>There</h1></main>' })).status).toBe(201);
    const shelved = await alice.api("POST", `${P}/story/pages/shelved/versions`, { title: "Shelved", body: '<main class="page"><h1>Shelved</h1></main>' });
    expect((await alice.api("POST", `${P}/story/pages/shelved/archive`, { expected_etag: shelved.body.etag })).status).toBe(200);
    const links = [
      `${h.baseUrl}/t/${path}/story/there`,
      `${h.baseUrl}/t/${path}/story/missing`,
      `/t/${path}/story/missing-too/`,
      `https://elsewhere.example.com/t/${path}/story/copied`,
      `${h.baseUrl}/t/${path}/story/shelved`,
      `${h.baseUrl}/t/${path}/story/linking`,
      `${h.baseUrl}/t/${path}/idea`,
      "https://example.com/story/not-ours",
      "notes.html",
    ];
    const body = `<main class="page"><h1>Linking</h1>${links.map((l) => `<a href="${l}">A link</a>`).join(" ")}</main>`;
    const expected = ["missing", "missing-too", "copied", "shelved"];
    const preview = await alice.api("POST", `${P}/story/pages/linking/preview`, { title: "Linking", body });
    expect(preview.status).toBe(200);
    expect(preview.body.links_to_no_page).toEqual(expected);
    const published = await alice.api("POST", `${P}/story/pages/linking/versions`, { title: "Linking", body });
    expect(published.status).toBe(201);
    expect(published.body.links_to_no_page).toEqual(expected);
    expect(published.body.links_to_no_page_note).toContain("This page isn't in the Story");
    // A page whose links all lead somewhere is told nothing.
    const fine = await alice.api("POST", `${P}/story/pages/fine/versions`, { title: "Fine", body: `<main class="page"><a href="${links[0]}">There</a></main>` });
    expect(fine.body).not.toHaveProperty("links_to_no_page");
  });

  it("does not tell a browser opening an address that leads nowhere the address back, whose words a page's link chose; an API caller is told", async () => {
    const words = "Your session has expired, sign in again at example.com";
    const at = `${h.baseUrl}${P}/story/pages/jobs/versions/1/${encodeURIComponent(words)}`;
    for (const dest of ["document", "iframe"]) {
      const r = await fetch(at, { headers: { "sec-fetch-dest": dest } });
      expect(r.status).toBe(404);
      const text = await r.text();
      expect(text).not.toContain("session");
      expect(text).not.toContain("expired");
      expect(JSON.parse(text).error).toMatchObject({ code: "not_found", message: "WhatBuild has nothing at this address." });
    }
    const asked = await fetch(at);
    expect(((await asked.json()) as { error: { message: string } }).error.message).toMatch(/^No route GET \/api\/v1\/p\/.*\/versions\/1\/Your session has expired/);
  });

  it("puts an index in the ZIP, and takes that ZIP back as it is", async () => {
    const g = await alice.api("POST", `${P}/mockups/${id}/downloads`, { version: 1 });
    const res = await fetch(g.body.url, { headers: g.body.headers });
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const index = strFromU8(files["index.html"]!);
    expect(index).toContain('<a href="pages/jobs.html"><strong>Start at Jobs</strong></a>');
    expect(index).toContain('href="pages/days.html"');

    const up = await alice.api("POST", `${P}/mockups/uploads`, {});
    const etag = (await alice.api("GET", `${P}/mockups/${id}`)).body.etag;
    const put = await fetch(up.body.url, { method: "PUT", headers: up.body.headers, body: zipSync(files) });
    expect(put.status).toBe(201);
    const again = await alice.api("POST", `${P}/mockups`, { mockup_id: id, expected_etag: etag, upload_id: up.body.upload_id });
    expect(again.status).toBe(201);
    expect(again.body.clickable.viewable).toBe(true);
  });
});
