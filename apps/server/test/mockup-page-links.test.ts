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
  function click(raw: string, opts: { canvas?: boolean; proto?: string; entries?: Record<string, string>; pageHandled?: boolean; meta?: boolean } = {}) {
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
    if (opts.canvas !== false) listeners["message"]!({ source: parent, data: { whatbuild: "canvas-host", ...(opts.entries ? { entries: opts.entries } : {}) } });
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
