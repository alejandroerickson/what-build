import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { areasFor, FRAME_SCRIPT, houseStyle, LIVE_AREAS, liveArea, liveMessage, OPERATIONS, type LiveArea, type Ports } from "@whatbuild/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, createPorts, loggedPath } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { syncExampleTenant } from "../src/example-organization.ts";
import { isLiveStream, LiveHub } from "../src/live.ts";
import { shutDown } from "../src/shutdown.ts";
import { Worker } from "../src/worker.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An open tab hears that part of a product changed, and nothing more, and only while it may read
// that part. Every test that says someone hears nothing keeps someone who may hear listening on the
// same product, opened after them: the hub tells streams in order, so once that one has heard, the
// one before has had its turn, and "nothing" is not just "not yet".

const SECRET = "Merger with Globex";

/** Everything a stream may ever say. */
const ONLY_WHAT_A_STREAM_MAY_SAY = new RegExp(`^: listening\\n\\n(?:: still here\\n\\n|event: change\\ndata: \\{"areas":\\[(?:"(?:${LIVE_AREAS.join("|")})",?)+\\]\\}\\n\\n)*$`);

let h: Harness;
let hub: LiveHub;
let ports: Ports;
let app: ReturnType<typeof createApp>;
let alice: Browser;
let vic: Browser;
let rita: Browser;
let tenant: string;
let product: string;
let path: string;
let P: string;

/** A stream as a tab reads it. */
interface Listening {
  status: number;
  text: () => string;
  /** The areas of every message so far, each message a list. */
  heard: () => LiveArea[][];
  ended: () => boolean;
  stop: () => Promise<void>;
}
const open: Listening[] = [];

function reading(res: Response): Listening {
  let text = "";
  let ended = !res.body;
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    if (!reader) return;
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) {
        ended = true;
        return;
      }
      text += decoder.decode(value, { stream: true });
    }
  })();
  const listening: Listening = {
    status: res.status,
    text: () => text,
    heard: () => [...text.matchAll(/^data: (.*)$/gm)].map((m) => (JSON.parse(m[1]!) as { areas: LiveArea[] }).areas),
    ended: () => ended,
    stop: async () => {
      await reader?.cancel().catch(() => undefined);
    },
  };
  open.push(listening);
  return listening;
}

const listenOn = (target: ReturnType<typeof createApp>, where: string, headers: Record<string, string>) => target.fetch(new Request(`${h.baseUrl}/api/v1/p/${where}/live`, { headers }));
const listen = async (who: Browser, where = path, headers: Record<string, string> = {}) => reading(await listenOn(app, where, { cookie: who.cookie, ...headers }));

/** A call through the app the streams are on, as `Browser.api` is through the harness's. */
async function call(who: Browser, method: string, to: string, body?: unknown) {
  const res = await app.fetch(new Request(`${h.baseUrl}${to}`, { method, headers: { cookie: who.cookie, origin: h.baseUrl, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const addOutcome = (title = SECRET) => call(alice, "POST", `${P}/outcomes`, { title });
const addSource = (title = SECRET) => call(alice, "POST", `${P}/sources`, { title, tags: [] });
const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plan</title><style>${houseStyle("clear")!.stylesheet}</style></head><body><main class="page">${body}</main></body></html>`;
let pages = 0;
const publishPage = () => {
  pages += 1;
  return call(alice, "POST", `${P}/story/pages/plan-${pages}/versions`, { title: SECRET, html: page(`<h1>${SECRET}</h1>`) });
};

const hears = (l: Listening, area: LiveArea) => vi.waitFor(() => expect(l.heard().flat()).toContain(area), { timeout: 3000 });

beforeAll(async () => {
  h = await startHarness();
  hub = new LiveHub({ coalesceMs: 10, heartbeatMs: 3_600_000 });
  ports = { ...h.ports, live: hub };
  app = createApp({ db: h.db, ports, config: h.config });
  alice = await h.signIn("alice@example.com", "Alice");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Alpha" });
  tenant = t.body.tenant.slug;
  const p = await alice.api("POST", `/api/v1/tenants/${tenant}/products`, { name: "Planner" });
  path = p.body.path;
  product = p.body.slug;
  P = `/api/v1/p/${path}`;
  await alice.api("POST", `/api/v1/tenants/${tenant}/members`, { product, email: vic.email, role: "viewer" });
  await alice.api("POST", `/api/v1/tenants/${tenant}/members`, { product, email: rita.email, role: "story_reader" });
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((l) => l.stop()));
  await vi.waitFor(() => expect(hub.open).toBe(0));
});
afterAll(async () => h?.close());

/** Someone newly given a role on the product, who is taken away or changed by the test. */
async function member(name: string, role: string): Promise<Browser & { id: string }> {
  const who = await h.signIn(`${name}@example.com`, name);
  const grant = await alice.api("POST", `/api/v1/tenants/${tenant}/members`, { product, email: who.email, role });
  expect(grant.status).toBe(201);
  return Object.assign(who, { id: (await who.api("GET", "/api/v1/me")).body.account_id as string });
}

describe("what a message can say", () => {
  it("has exactly one form", () => {
    expect(liveMessage(["story"])).toBe('event: change\ndata: {"areas":["story"]}\n\n');
    expect(liveMessage(["evidence", "idea"])).toBe('event: change\ndata: {"areas":["idea","evidence"]}\n\n');
  });

  it("is written from its own list, so a mistake elsewhere cannot put anything else on the wire", () => {
    const mistake = ["story", SECRET, "0".repeat(26), '"]}\n\ndata: leaked'] as unknown as LiveArea[];
    expect(liveMessage(mistake)).toBe('event: change\ndata: {"areas":["story"]}\n\n');
    expect(() => liveMessage([SECRET] as unknown as LiveArea[])).toThrow();
  });

  it("names the Story's area to someone who reads only the Story, and no other", () => {
    expect(areasFor("story_reader", LIVE_AREAS)).toEqual(["story"]);
    expect(areasFor("story_reader", ["idea", "evidence", "exploration", "other"])).toEqual([]);
    for (const role of ["viewer", "editor", "admin"] as const) expect(areasFor(role, LIVE_AREAS)).toEqual([...LIVE_AREAS]);
  });

  it("labels the Story's area only for the Story's operations, and a kind nobody labelled reaches no Story reader", () => {
    for (const op of OPERATIONS) expect(liveArea(op) === "story", op.name).toBe(op.mcp.tool === "story");
    expect(liveArea({ mcp: { tool: "something_new" } })).toBe("other");
    expect(liveArea({ mcp: { tool: "constructor" } })).toBe("other");
    // Every operation that changes a product today is labelled: a new kind of one is a choice to make.
    expect(OPERATIONS.filter((op) => op.mutates && op.scope === "product" && liveArea(op) === "other").map((op) => op.name)).toEqual([]);
  });
});

describe("who may start listening", () => {
  it("refuses anyone signed out, and a session that is no good", async () => {
    expect((await listenOn(app, path, {})).status).toBe(401);
    expect((await listenOn(app, path, { cookie: "wb_session=not-a-session" })).status).toBe(401);
  });

  it("does not show someone with no role on the product that it exists, whether or not it does", async () => {
    const stranger = await h.signIn("stranger@example.com", "Stranger");
    await stranger.api("POST", "/api/v1/tenants", { name: "Beta" });
    expect((await listen(stranger)).status).toBe(404);
    expect((await listen(stranger, `${tenant}/no-such-product`)).status).toBe(404);
    expect(hub.open).toBe(0);
  });

  it("refuses an agent: a token is not a browser's session, even beside one", async () => {
    const token = await h.connectAgent(alice);
    expect((await listenOn(app, path, { authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await listenOn(app, path, { authorization: `Bearer ${token}`, cookie: alice.cookie })).status).toBe(401);
  });

  it("refuses a request from any page but the app's own, whose cookie would otherwise come with it", async () => {
    expect((await listenOn(app, path, { cookie: alice.cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await listenOn(app, path, { cookie: alice.cookie, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await listenOn(app, path, { cookie: alice.cookie, origin: "https://evil.example" })).status).toBe(403);
    const own = await listen(alice, path, { "sec-fetch-site": "same-origin" });
    expect(own.status).toBe(200);
  });

  it("answers a stream with what no one between may keep or hold back", async () => {
    const res = await listenOn(app, path, { cookie: alice.cookie });
    reading(res);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });

  it("holds no stream open for a guest of the example organization, who is told to stop asking", async () => {
    const owner = await h.signIn("olive@example.com", "Olive");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Example Works" });
    const p = await owner.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/products`, { name: "Worked example" });
    await syncExampleTenant(h.db, t.body.tenant.slug, () => {});
    try {
      const guest = await h.signIn("gil@example.com", "Gil");
      const answer = await listen(guest, p.body.path);
      expect(answer.status).toBe(204);
      expect(hub.open).toBe(0);
      // Their own organization's product, in the same breath, is no business of theirs either.
      expect((await listen(guest)).status).toBe(404);
      expect((await listen(owner, p.body.path)).status).toBe(200);
    } finally {
      await syncExampleTenant(h.db, null, () => {});
    }
  });

  it("says nothing of who is asking, and asks the database nothing, on a deployment that turned it off", async () => {
    const config = loadConfig({ NODE_ENV: "test", WHATBUILD_LIVE_UPDATES: "0", DATABASE_URL: "x" });
    expect(config.liveUpdates).toBe(false);
    const off = createPorts(config, h.blobs, h.mailer);
    expect(off.live).toBeUndefined();
    const db = new Proxy(h.db, { get: () => { throw new Error("the database was asked"); } });
    const closed = createApp({ db, ports: { ...off, config: { ...off.config } }, config: { ...h.config, liveUpdates: false } });
    for (const headers of [{}, { cookie: alice.cookie }] as Record<string, string>[]) {
      const res = await listenOn(closed, path, headers);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
  });

  it("is on unless turned off, with room left beside it for ordinary requests on a deployment that changed no settings", () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "x" });
    expect(config.liveUpdates).toBe(true);
    expect(config.liveMaxStreams).toBe(25);
    expect(createPorts(config, h.blobs, h.mailer).live).toBeInstanceOf(LiveHub);
    expect(loadConfig({ NODE_ENV: "test", DATABASE_URL: "x", WHATBUILD_LIVE_MAX_STREAMS: "100" }).liveMaxStreams).toBe(100);
  });

  it("ends a stream before a deployment's old five-minute limit would by default, which would read as a failed request, unless it says it allows longer", async () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "x" });
    expect(config.liveStreamMinutes).toBe(4);
    expect(loadConfig({ NODE_ENV: "test", DATABASE_URL: "x", WHATBUILD_LIVE_STREAM_MINUTES: "50" }).liveStreamMinutes).toBe(50);
    vi.useFakeTimers();
    try {
      const hubbed = createPorts(config, h.blobs, h.mailer).live as LiveHub;
      reading(new Response(hubbed.listen("p", "a", async () => "viewer")!));
      expect(hubbed.open).toBe(1);
      // Its time, and at most one heartbeat more until it is noticed.
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 25_000);
      expect(hubbed.open).toBe(0);
      expect(4 * 60 + 25).toBeLessThan(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes a tab go without when there is no room, before asking the database, and says when to try again", async () => {
    const full = new LiveHub({ maxStreams: 1 });
    const first = reading(await listenOn(createApp({ db: h.db, ports: { ...h.ports, live: full }, config: h.config }), path, { cookie: alice.cookie }));
    expect(first.status).toBe(200);
    const db = new Proxy(h.db, { get: () => { throw new Error("the database was asked"); } });
    const refused = await listenOn(createApp({ db, ports: { ...h.ports, live: full }, config: h.config }), path, { cookie: vic.cookie });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("300");
    await first.stop();
    await vi.waitFor(() => expect(full.open).toBe(0));
  });

  it("lets one person hold only so many", async () => {
    const few = new LiveHub({ maxPerAccount: 2 });
    const owned = createApp({ db: h.db, ports: { ...h.ports, live: few }, config: h.config });
    const tabs = [reading(await listenOn(owned, path, { cookie: alice.cookie })), reading(await listenOn(owned, path, { cookie: alice.cookie }))];
    expect((await listenOn(owned, path, { cookie: alice.cookie })).status).toBe(429);
    const other = reading(await listenOn(owned, path, { cookie: vic.cookie }));
    expect(other.status).toBe(200);
    await Promise.all([...tabs, other].map((l) => l.stop()));
    await vi.waitFor(() => expect(few.open).toBe(0));
  });

  it("tells a tab that went while it was being let in that it went, not that there is no room, and keeps no place for it", async () => {
    const one = new LiveHub({ maxPerAccount: 1 });
    const leaving = new AbortController();
    // The tab goes before it is let in, as the first of the two requests a page load makes in
    // development does: the first time anything reads the database, the request is already gone.
    const db = new Proxy(h.db, {
      get: (target, key) => {
        leaving.abort();
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const went = await createApp({ db, ports: { ...h.ports, live: one }, config: h.config }).fetch(new Request(`${h.baseUrl}/api/v1/p/${path}/live`, { headers: { cookie: alice.cookie }, signal: leaving.signal }));
    expect(leaving.signal.aborted).toBe(true);
    expect(went.status).toBe(499);
    expect(((await went.json()) as { error: { code: string } }).error.code).toBe("live_cancelled");
    expect(one.open).toBe(0);
    // Its place is free for the tab that stays, and the next one is refused for lack of room as before.
    const owned = createApp({ db: h.db, ports: { ...h.ports, live: one }, config: h.config });
    const tab = reading(await listenOn(owned, path, { cookie: alice.cookie }));
    expect(tab.status).toBe(200);
    const refused = await listenOn(owned, path, { cookie: alice.cookie });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("300");
    expect(((await refused.json()) as { error: { code: string; details: { retry_after_seconds: number } } }).error).toMatchObject({ code: "live_full", details: { retry_after_seconds: 300 } });
    await tab.stop();
    await vi.waitFor(() => expect(one.open).toBe(0));
  });
});

describe("who hears what", () => {
  it("tells someone who may read everything which part changed, and not one word of what", async () => {
    const tab = await listen(vic);
    expect((await addOutcome()).status).toBe(201);
    await hears(tab, "idea");
    expect((await addSource()).status).toBe(201);
    await hears(tab, "evidence");
    expect((await publishPage()).status).toBe(201);
    await hears(tab, "story");
    expect(tab.text()).toMatch(ONLY_WHAT_A_STREAM_MAY_SAY);
    expect(tab.text()).not.toContain(SECRET);
    expect(tab.text()).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
  });

  it("tells a Story reader of the Story and of nothing else", async () => {
    const reader = await listen(rita);
    const others = await listen(vic);
    await addOutcome();
    await hears(others, "idea");
    await addSource();
    await hears(others, "evidence");
    expect(reader.heard()).toEqual([]);
    await publishPage();
    await hears(others, "story");
    await hears(reader, "story");
    expect(reader.heard()).toEqual([["story"]]);
    expect(reader.text()).toMatch(ONLY_WHAT_A_STREAM_MAY_SAY);
  });

  it("tells a tab nothing of another product", async () => {
    const other = await alice.api("POST", `/api/v1/tenants/${tenant}/products`, { name: "Another" });
    const elsewhere = await listen(alice, other.body.path);
    const tab = await listen(vic);
    await addOutcome();
    await hears(tab, "idea");
    expect(elsewhere.heard()).toEqual([]);
  });

  it("hears a change an agent makes, which is what it is for", async () => {
    const tab = await listen(vic);
    const token = await h.connectAgent(alice);
    const res = await app.fetch(
      new Request(`${h.baseUrl}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "outcomes_write", arguments: { action: "create", product: path, params: { title: "From an agent" } } } }),
      }),
    );
    expect(await res.text()).toContain("From an agent");
    await hears(tab, "idea");
  });

  it("hears a reading finish, which the worker does, not a request", async () => {
    const tab = await listen(vic);
    const worker = new Worker({ db: h.db, ports }, 60_000, () => {});
    const grant = await call(alice, "POST", `${P}/sources/with-upload`, { tags: [], title: "A note", path: "note.md" });
    expect(grant.status, JSON.stringify(grant.body)).toBe(201);
    await vi.waitFor(() => expect(tab.heard().length).toBeGreaterThan(0));
    const before = tab.heard().length;
    // Through the relay, which adds the attachment outside any operation.
    const put = await app.fetch(new Request(grant.body.upload.url, { method: "PUT", headers: grant.body.upload.headers, body: "# A note\n\nHello.\n" }));
    expect(put.status, await put.clone().text()).toBeLessThan(300);
    await vi.waitFor(() => expect(tab.heard().length).toBeGreaterThan(before));
    const afterUpload = tab.heard().length;
    await worker.drain();
    await vi.waitFor(() => expect(tab.heard().length).toBeGreaterThan(afterUpload));
    expect(tab.heard().at(-1)).toEqual(["evidence"]);
  });

  it("never hears of a write that was refused, a read, or an export, which changes nothing the team has", async () => {
    const outcome = await addOutcome("Already here");
    const tab = await listen(vic);
    expect((await call(vic, "POST", `${P}/story/pages/refused/versions`, { title: "No", html: page("<h1>No</h1>") })).status).toBe(403);
    expect((await call(alice, "PATCH", `${P}/outcomes/${outcome.body.outcome_id}`, { expected_etag: "stale", title: "Too late" })).status).toBe(409);
    expect((await call(alice, "GET", `${P}/story/pages`)).status).toBe(200);
    expect((await call(alice, "POST", `${P}/exports`, {})).status).toBe(201);
    await addSource();
    await hears(tab, "evidence");
    expect(tab.heard()).toEqual([["evidence"]]);
  });
});

describe("someone who may no longer hear", () => {
  /** Listen, let what `change` does happen, and change something: they hear nothing of it, and their stream ends. */
  async function hearsNothingAfter(who: Browser, change: () => Promise<unknown>) {
    const theirs = await listen(who);
    const others = await listen(alice);
    await addOutcome();
    await hears(theirs, "idea");
    await vi.waitFor(() => expect(others.heard().length).toBe(1));
    await change();
    const before = theirs.text();
    await publishPage();
    await hears(others, "story");
    expect(theirs.text()).toBe(before);
    await vi.waitFor(() => expect(theirs.ended()).toBe(true));
  }

  it("taken off the product hears nothing more", async () => {
    const olga = await member("olga", "viewer");
    await hearsNothingAfter(olga, async () => expect((await alice.api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { account_id: olga.id, whole_tenant: true })).status).toBe(200));
  });

  it("signed out hears nothing more, on any tab", async () => {
    const sam = await member("sam", "viewer");
    await hearsNothingAfter(sam, async () => expect((await sam.api("POST", "/auth/sign-out")).status).toBeLessThan(400));
  });

  it("whose session ran out hears nothing more", async () => {
    const eve = await member("eve", "viewer");
    await hearsNothingAfter(eve, () => h.db.updateTable("sessions").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where("account_id", "=", eve.id).execute());
  });

  it("whose account was deleted hears nothing more", async () => {
    const dan = await member("dan", "viewer");
    await hearsNothingAfter(dan, () => h.db.updateTable("accounts").set({ deleted_at: new Date().toISOString() }).where("account_id", "=", dan.id).execute());
  });

  it("made a Story reader hears of the Story alone from then on", async () => {
    const liv = await member("liv", "viewer");
    const theirs = await listen(liv);
    const others = await listen(alice);
    await addOutcome();
    await hears(theirs, "idea");
    await vi.waitFor(() => expect(others.heard().length).toBe(1));
    expect((await alice.api("POST", `/api/v1/tenants/${tenant}/members`, { product, email: liv.email, role: "story_reader" })).status).toBeLessThan(300);
    const before = theirs.heard().length;
    await addSource();
    await hears(others, "evidence");
    expect(theirs.heard().length).toBe(before);
    expect(theirs.ended()).toBe(false);
    await publishPage();
    await hears(theirs, "story");
    expect(theirs.heard().at(-1)).toEqual(["story"]);
  });

  it("is cut off when asking again fails, whatever the reason", async () => {
    const hubbed = new LiveHub({ coalesceMs: 1 });
    const body = hubbed.listen("p", "a", async () => {
      throw new Error("the database is away");
    })!;
    const tab = reading(new Response(body));
    hubbed.changed("p", "story");
    await vi.waitFor(() => expect(tab.ended()).toBe(true));
    expect(tab.heard()).toEqual([]);
    expect(hubbed.open).toBe(0);
  });
});

describe("what a stream costs", () => {
  const { useFakeTimers, useRealTimers, advanceTimersByTimeAsync: advance, getTimerCount } = vi;
  afterEach(() => void useRealTimers());

  it("sets no timer for a change nobody is listening for", () => {
    useFakeTimers();
    const hubbed = new LiveHub();
    for (let i = 0; i < 100; i++) hubbed.changed("nobody-here", "story");
    expect(getTimerCount()).toBe(0);
  });

  it("asks the database nothing while nothing changes, however long it stays open", async () => {
    useFakeTimers();
    const recheck = vi.fn(async () => "viewer" as const);
    const hubbed = new LiveHub({ heartbeatMs: 25_000 });
    const tab = reading(new Response(hubbed.listen("p", "a", recheck)!));
    await advance(30 * 60_000);
    expect(recheck).not.toHaveBeenCalled();
    expect(tab.text()).toContain(": still here\n\n");
    expect(tab.text()).toMatch(ONLY_WHAT_A_STREAM_MAY_SAY);
  });

  it("gathers a burst of changes into one message, and asks once", async () => {
    useFakeTimers();
    const recheck = vi.fn(async () => "viewer" as const);
    const hubbed = new LiveHub({ coalesceMs: 5_000 });
    const tab = reading(new Response(hubbed.listen("p", "a", recheck)!));
    for (let i = 0; i < 50; i++) hubbed.changed("p", i % 2 ? "evidence" : "story");
    await advance(4_999);
    expect(tab.heard()).toEqual([]);
    await advance(1);
    await vi.waitFor(() => expect(tab.heard()).toEqual([["story", "evidence"]]));
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer behind once the last stream has gone", async () => {
    useFakeTimers();
    const hubbed = new LiveHub();
    const tab = reading(new Response(hubbed.listen("p", "a", async () => "viewer")!));
    expect(getTimerCount()).toBe(1);
    await tab.stop();
    await vi.waitFor(() => expect(hubbed.open).toBe(0));
    expect(getTimerCount()).toBe(0);
  });

  it("ends a stream at its time, so the tab passes the first check again to go on", async () => {
    useFakeTimers();
    const seen: Record<string, unknown>[] = [];
    const hubbed = new LiveHub({ heartbeatMs: 1_000, lifeMs: 60_000, log: (f) => seen.push(f) });
    const tab = reading(new Response(hubbed.listen("p", "a", async () => "viewer")!));
    await advance(61_000);
    await vi.waitFor(() => expect(tab.ended()).toBe(true));
    expect(hubbed.open).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ event: "live_stream_ended", reason: "lived its time", open: 0 });
    expect(Object.keys(seen[0]!).sort()).toEqual(["event", "open", "reason", "seconds"]);
  });

  it("ends a stream nobody is reading", async () => {
    useFakeTimers();
    const hubbed = new LiveHub({ heartbeatMs: 1_000 });
    hubbed.listen("p", "a", async () => "viewer");
    await advance(40_000);
    expect(hubbed.open).toBe(0);
  });

  it("holds nothing for a tab that went while it was being let in, which would never read it", async () => {
    const hubbed = new LiveHub();
    const leaving = new AbortController();
    const stream = hubbed.listen("p", "a", async () => "viewer", leaving.signal);
    expect(stream).not.toBeNull();
    expect(hubbed.open).toBe(1);
    // Nobody ever reads this one, so nothing cancels it: only the request's going ends it.
    leaving.abort();
    expect(hubbed.open).toBe(0);
    expect(hubbed.listen("p", "a", async () => "viewer", leaving.signal)).toBeNull();
    expect(hubbed.open).toBe(0);
  });

  it("wakes no worker when a tab starts listening, whose looking would keep the database awake", async () => {
    const onRequest = vi.fn();
    const watched = createApp({ db: h.db, ports: { ...h.ports, live: hub }, config: h.config, onRequest });
    const tab = reading(await listenOn(watched, path, { cookie: alice.cookie }));
    expect(tab.status).toBe(200);
    expect(onRequest).not.toHaveBeenCalled();
    await (await watched.fetch(new Request(`${h.baseUrl}/api/v1/me`, { headers: { cookie: alice.cookie } }))).arrayBuffer();
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("knows its own path, and logs it with no one's names", () => {
    expect(isLiveStream(`/api/v1/p/${path}/live`)).toBe(true);
    expect(isLiveStream(`/api/v1/p/${path}/story/live`)).toBe(false);
    expect(isLiveStream("/live")).toBe(false);
    expect(loggedPath(`/api/v1/p/${path}/live`)).toBe("/api/v1/p/:org/:product/live");
  });

  it("is told of use inside a frame, where the app can't see it, at most every half minute", () => {
    expect(FRAME_SCRIPT).toContain('whatbuild:"frame-active"');
    expect(FRAME_SCRIPT).toContain("n-used<30000");
  });
});

describe("over a real connection", () => {
  async function listening(target: ReturnType<typeof createApp>) {
    const server = await new Promise<{ server: ServerType; port: number }>((resolve) => {
      const s: ServerType = serve({ fetch: target.fetch, port: 0 }, (info: AddressInfo) => resolve({ server: s, port: info.port }));
    });
    return server;
  }

  it("arrives as it is sent, not when the response ends, and lets go when the tab does", async () => {
    const { server, port } = await listening(app);
    const leaving = new AbortController();
    const res = await fetch(`http://localhost:${port}/api/v1/p/${path}/live`, { headers: { cookie: alice.cookie }, signal: leaving.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": listening\n\n");
    await addOutcome();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('event: change\ndata: {"areas":["idea"]}\n\n');
    expect(hub.open).toBe(1);
    leaving.abort();
    await vi.waitFor(() => expect(hub.open).toBe(0));
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("lets go of a request that left before its answer was read", async () => {
    const leaving = new AbortController();
    const res = await app.fetch(new Request(`${h.baseUrl}/api/v1/p/${path}/live`, { headers: { cookie: alice.cookie }, signal: leaving.signal }));
    expect(res.status).toBe(200);
    expect(hub.open).toBe(1);
    leaving.abort();
    expect(hub.open).toBe(0);
    const gone = new AbortController();
    gone.abort();
    expect((await app.fetch(new Request(`${h.baseUrl}/api/v1/p/${path}/live`, { headers: { cookie: alice.cookie }, signal: gone.signal }))).status).not.toBe(200);
    expect(hub.open).toBe(0);
  });

  it("does not hold up a server that is stopping", async () => {
    const closing = new LiveHub();
    const stopping = createApp({ db: h.db, ports: { ...h.ports, live: closing }, config: h.config });
    const { server, port } = await listening(stopping);
    const res = await fetch(`http://localhost:${port}/api/v1/p/${path}/live`, { headers: { cookie: alice.cookie } });
    const reader = res.body!.getReader();
    await reader.read();
    const started = Date.now();
    const parts = { worker: { stop: async () => undefined }, parser: { stop: () => undefined }, pool: { end: async () => undefined }, server, live: closing };
    await shutDown(parts as unknown as Parameters<typeof shutDown>[0]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await reader.read()).done).toBe(true);
    expect(closing.full).toBe(true);
  });

  it("is the one request not held to the limit on answering, which still ends one that hangs", async () => {
    const quick = createApp({ db: h.db, ports: { ...h.ports, live: hub }, config: h.config, requestLimitMs: 30 });
    quick.get("/a-request-that-hangs", () => new Promise<Response>(() => undefined));
    const hung = await quick.fetch(new Request(`${h.baseUrl}/a-request-that-hangs`));
    expect(hung.status).toBe(504);
    expect(((await hung.json()) as { error: { code: string } }).error.code).toBe("timed_out");
    const tab = reading(await listenOn(quick, path, { cookie: alice.cookie }));
    expect(tab.status).toBe(200);
    await new Promise((r) => setTimeout(r, 90));
    expect(tab.ended()).toBe(false);
  });
});
