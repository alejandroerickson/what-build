import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Publishing a mockup version from a ZIP: the grant, the relay, the archive read as hostile input,
// and publish's meaning kept (what is omitted carries forward, etags, one atomic version).

let h: Harness;
let alice: Browser;
let bob: Browser;
let vic: Browser;
let P: string;
let tenantSlug: string;

const page = (heading: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title><style>body{font:16px system-ui}</style></head><body><h1>${heading}</h1></body></html>`;

type Res = { status: number; body: any };

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  bob = await h.signIn("bob@example.com", "Bob Editor");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Upload Co" });
  tenantSlug = t.body.tenant.slug;
  const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${t.body.team.slug}/products`, { name: "Planner", concept: "A planner for finance teams." });
  P = `/api/v1/p/${p.body.path}`;
  for (const [email, role] of [["bob@example.com", "editor"], ["vic@example.com", "viewer"]])
    expect((await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: t.body.team.slug, product: "planner", email, role })).status).toBe(201);
});
afterAll(async () => h?.close());

/** Ask for a grant, PUT the bytes to it, and return the grant. */
async function upload(b: Browser, base: string, bytes: Uint8Array, mockupId?: string) {
  const g = await b.api("POST", `${base}/mockups/uploads`, mockupId ? { mockup_id: mockupId } : {});
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  const put = await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: bytes });
  return { grant: g.body, put: { status: put.status, body: (await put.json()) as any } };
}

const publish = (b: Browser, body: Record<string, unknown>, base = P): Promise<Res> => b.api("POST", `${base}/mockups`, body);

async function download(b: Browser, mockupId: string): Promise<Record<string, string>> {
  const g = await b.api("POST", `${P}/mockups/${mockupId}/downloads`, {});
  const res = await fetch(g.body.url, { headers: g.body.headers });
  return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(await res.arrayBuffer()))).map(([k, v]) => [k, strFromU8(v)]));
}

const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])) as Zippable);

const manifest = (pages: Record<string, unknown>[], extra: Record<string, unknown> = {}) => JSON.stringify({ pages, ...extra });

/** Replace every occurrence of one byte string with another of the same length: a way to forge headers fflate would never write. */
function patch(bytes: Uint8Array, from: string, to: string) {
  const a = strToU8(from);
  const b = strToU8(to);
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i + a.length <= bytes.length; i++) {
    if (a.every((x, j) => bytes[i + j] === x)) {
      bytes.set(b, i);
      n++;
    }
  }
  expect(n).toBeGreaterThan(0);
  return bytes;
}

async function makeMockup(title: string) {
  const r = await publish(alice, {
    title,
    brief: "# Close dashboard\n\nWhich layout shows the close at a glance?",
    pages: [
      { page_id: "grid", title: "Grid", notes: "Dense.", html: page("Grid") },
      { page_id: "timeline", title: "Timeline", html: page("Timeline"), width: 390, height: 844 },
      { page_id: "cards", title: "Cards", html: page("Cards") },
    ],
    files: [{ path: "DESIGN.md", content: "# Design\n\nType: system-ui." }, { path: "components/card.html", content: "<div class=card></div>" }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { mockup_id: string; etag: string; current: { pages: { page_id: string; html_sha256: string }[]; files: { path: string; sha256: string }[] } };
}

const shaOf = (v: { pages: { page_id: string; html_sha256: string }[] }) => Object.fromEntries(v.pages.map((p) => [p.page_id, p.html_sha256]));

describe("publishing a mockup from an uploaded ZIP", () => {
  it("round-trips a download: change one page, upload the folder, and every other page is byte for byte the same", async () => {
    const m = await makeMockup("Round trip");
    const before = shaOf(m.current);
    const files = await download(alice, m.mockup_id);
    files["pages/timeline.html"] = page("Timeline, revised");
    files["pages/timeline.notes.md"] = "Moved the totals to the top.";
    // Zipped as a folder, the way `zip -r canvas.zip canvas` does.
    const { grant, put } = await upload(alice, P, zip(Object.fromEntries(Object.entries(files).map(([k, v]) => [`canvas/${k}`, v]))), m.mockup_id);
    expect(put.status, JSON.stringify(put.body)).toBe(201);
    expect(grant).toMatchObject({ method: "PUT", mockup_id: m.mockup_id });
    expect(put.body).toMatchObject({ uploaded: true, upload_id: grant.upload_id });

    const r = await publish(alice, { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: grant.upload_id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ current_version: 2, based_on_version: 1 });
    const after = shaOf(r.body.current);
    expect(after["grid"]).toBe(before["grid"]);
    expect(after["cards"]).toBe(before["cards"]);
    expect(after["timeline"]).not.toBe(before["timeline"]);
    expect(r.body.current.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["grid", "timeline", "cards"]);
    expect(r.body.current.pages[1]).toMatchObject({ width: 390, height: 844, notes: "Moved the totals to the top." });
    expect(r.body.current.files).toEqual(m.current.files);
    expect(r.body.current.brief).toContain("at a glance");

    const activity = await alice.api("GET", `${P}/activity?entity_type=mockup&entity_id=${m.mockup_id}`);
    expect(JSON.stringify(activity.body)).toContain("from an uploaded archive");

    // An upload publishes once.
    const again = await publish(alice, { mockup_id: m.mockup_id, expected_etag: r.body.etag, upload_id: grant.upload_id });
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe("upload_used");
    const reput = await fetch(grant.url, { method: "PUT", headers: grant.headers, body: zip({ "manifest.json": "{}" }) });
    expect(reput.status).toBe(409);
  });

  it("carries forward what the archive leaves out, and keeps etags", async () => {
    const m = await makeMockup("Carry forward");
    const before = shaOf(m.current);
    const archive = zip({
      "manifest.json": manifest([{ page_id: "cards" }, { page_id: "grid", title: "Grid, renamed" }, { page_id: "list", title: "List" }], { files: [{ path: "DESIGN.md" }, { path: "tokens.json" }] }),
      "pages/list.html": page("List"),
      "files/tokens.json": "{\"ink\":\"#111\"}",
    });
    const { grant } = await upload(alice, P, archive, m.mockup_id);

    const stale = await publish(alice, { mockup_id: m.mockup_id, expected_etag: "stale", upload_id: grant.upload_id });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    // Refused, the upload is not spent.
    const r = await publish(alice, { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: grant.upload_id, title: "Carry forward, v2" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const v = r.body.current;
    expect(r.body.title).toBe("Carry forward, v2");
    expect(v.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["cards", "grid", "list"]);
    expect(v.pages[0].html_sha256).toBe(before["cards"]);
    expect(v.pages[1]).toMatchObject({ title: "Grid, renamed", notes: "Dense.", html_sha256: before["grid"] });
    expect(v.files.map((f: { path: string }) => f.path)).toEqual(["DESIGN.md", "tokens.json"]);
    expect(v.brief).toContain("at a glance");
  });

  it("creates a mockup from an upload, named by its manifest", async () => {
    const { grant } = await upload(alice, P, zip({ "manifest.json": manifest([{ page_id: "only", title: "Only" }], { title: "From a ZIP", summary: "Made from an archive." }), "brief.md": "# Brief", "pages/only.html": page("Only") }));
    const r = await publish(alice, { upload_id: grant.upload_id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ title: "From a ZIP", summary: "Made from an archive.", current_version: 1 });
    expect(r.body.current.brief).toBe("# Brief");
  });

  it("checks every page as an inline publish does, listing every problem at once", async () => {
    const m = await makeMockup("Inspected");
    const { grant } = await upload(
      alice,
      P,
      zip({
        "manifest.json": manifest([{ page_id: "grid" }, { page_id: "remote" }, { page_id: "framed", title: "Framed" }]),
        "pages/remote.html": page("Remote").replace("</head>", '<script src="https://cdn.example.com/x.js"></script></head>'),
        "pages/framed.html": page("Framed").replace("</body>", '<iframe src="https://example.com"></iframe></body>'),
      }),
      m.mockup_id,
    );
    const r = await publish(alice, { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: grant.upload_id });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("invalid_input");
    expect(r.body.error.details.problems.join(" ")).toMatch(/remote.*new and needs a title/);
    const fixed = await upload(
      alice,
      P,
      zip({
        "manifest.json": manifest([{ page_id: "grid" }, { page_id: "remote", title: "Remote" }, { page_id: "framed", title: "Framed" }]),
        "pages/remote.html": page("Remote").replace("</head>", '<script src="https://cdn.example.com/x.js"></script></head>'),
        "pages/framed.html": page("Framed").replace("</body>", '<iframe src="https://example.com"></iframe></body>'),
      }),
      m.mockup_id,
    );
    const html = await publish(alice, { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: fixed.grant.upload_id });
    expect(html.status).toBe(422);
    expect(html.body.error.code).toBe("invalid_html");
    const problems: string[] = html.body.error.details.problems;
    expect(problems.some((p) => p.startsWith("remote:"))).toBe(true);
    expect(problems.some((p) => p.startsWith("framed:"))).toBe(true);
    expect((await alice.api("GET", `${P}/mockups/${m.mockup_id}`)).body.current_version).toBe(1);
  });

  it("refuses inline pages, files or a brief beside an upload", async () => {
    const { grant } = await upload(alice, P, zip({ "manifest.json": manifest([{ page_id: "a", title: "A" }]), "pages/a.html": page("A") }));
    const r = await publish(alice, { upload_id: grant.upload_id, pages: [{ page_id: "b", title: "B", html: page("B") }] });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/upload_id carries the pages/);
  });
});

describe("an agent over MCP", () => {
  it("downloads a canvas, changes a page on disk, and publishes it from an upload without the HTML passing through a call", async () => {
    const m = await makeMockup("Agent round trip");
    const client = new Client({ name: "canvas-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(alice, "Canvas agent")}` } } }));
    const product = P.slice("/api/v1/p/".length);
    const call = async (action: string, params: Record<string, unknown>) => {
      const r = (await client.callTool({ name: "mockups", arguments: { action, product, params } })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError, r.content[0]!.text).toBeFalsy();
      return JSON.parse(r.content[0]!.text);
    };
    try {
      const dl = await call("get_download", { mockup_id: m.mockup_id });
      const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(await (await fetch(dl.url, { headers: dl.headers })).arrayBuffer()))).map(([k, v]) => [k, strFromU8(v)]));
      files["pages/cards.html"] = page("Cards, from the agent's project");
      const grant = await call("request_upload", { mockup_id: m.mockup_id });
      const put = await fetch(grant.url, { method: grant.method, headers: grant.headers, body: zip(files) });
      expect(put.status).toBe(201);
      // The tool calls carry ids and an etag; the pages travel only in the PUT.
      const published = await call("publish", { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: grant.upload_id });
      expect(published).toMatchObject({ current_version: 2 });
      expect(shaOf(published.current)["grid"]).toBe(shaOf(m.current)["grid"]);
      expect(shaOf(published.current)["cards"]).not.toBe(shaOf(m.current)["cards"]);
      const described = (await client.callTool({ name: "mockups", arguments: { action: "request_upload", describe: true } })) as { content: { text: string }[] };
      expect(described.content[0]!.text).toMatch(/PUT the ZIP|get_download's layout/);
    } finally {
      await client.close();
    }
  });
});

describe("a mockup upload grant", () => {
  it("is for the mockup it names, and for whoever asked for it", async () => {
    const m = await makeMockup("Tied");
    const { grant } = await upload(alice, P, zip({ "manifest.json": manifest([{ page_id: "grid" }]) }), m.mockup_id);
    const asNew = await publish(alice, { upload_id: grant.upload_id, title: "Elsewhere" });
    expect(asNew.status).toBe(409);
    expect(asNew.body.error.code).toBe("upload_mismatch");
    const byBob = await publish(bob, { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: grant.upload_id });
    expect(byBob.status).toBe(403);
    // A manifest downloaded from one mockup does not publish onto another.
    const other = await makeMockup("Other");
    const files = await download(alice, m.mockup_id);
    const cross = await upload(alice, P, zip(files), other.mockup_id);
    const crossed = await publish(alice, { mockup_id: other.mockup_id, expected_etag: other.etag, upload_id: cross.grant.upload_id });
    expect(crossed.status).toBe(409);
    expect(crossed.body.error.message).toMatch(/manifest.json is mockup/);
  });

  it("is refused to a viewer, and takes no bytes without its header", async () => {
    const viewer = await vic.api("POST", `${P}/mockups/uploads`, {});
    expect(viewer.status).toBe(403);
    const g = await alice.api("POST", `${P}/mockups/uploads`, {});
    const bare = await fetch(g.body.url, { method: "PUT", headers: { "Content-Type": "application/zip" }, body: zip({ "manifest.json": "{}" }) });
    expect(bare.status).toBe(401);
    const early = await publish(alice, { upload_id: g.body.upload_id });
    expect(early.status).toBe(404);
    expect(early.body.error.message).toMatch(/No archive has arrived/);
  });

  it("expires: the relay takes nothing after, and publish refuses what arrived before", async () => {
    const m = await makeMockup("Expiring");
    const arrived = await upload(alice, P, zip({ "manifest.json": manifest([{ page_id: "grid" }]) }), m.mockup_id);
    const late = await alice.api("POST", `${P}/mockups/uploads`, { mockup_id: m.mockup_id });
    await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', (select tenant_id from tenants where slug = ${tenantSlug}), true)`.execute(trx);
      await sql`update mockup_uploads set expires_at = now() - interval '1 minute' where upload_id in (${arrived.grant.upload_id}, ${late.body.upload_id})`.execute(trx);
    });
    const put = await fetch(late.body.url, { method: "PUT", headers: late.body.headers, body: zip({ "manifest.json": "{}" }) });
    expect(put.status).toBe(401);
    const r = await publish(alice, { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: arrived.grant.upload_id });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("upload_expired");
  });

  it("refuses an archive larger than it allows, before storing it", async () => {
    const big = await alice.api("POST", `${P}/mockups/uploads`, { size: 21 * 1024 * 1024 });
    expect(big.status).toBe(413);
  });
});

describe("an uploaded archive is hostile input", () => {
  let m: { mockup_id: string; etag: string };
  beforeAll(async () => {
    m = await makeMockup("Hostile");
  });

  async function refused(bytes: Uint8Array): Promise<string> {
    const { grant, put } = await upload(alice, P, bytes, m.mockup_id);
    expect(put.status).toBe(201);
    const r = await publish(alice, { mockup_id: m.mockup_id, expected_etag: m.etag, upload_id: grant.upload_id });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error.code).toBe("invalid_archive");
    expect(r.body.error.message).toMatch(/^.*Nothing was published/);
    return r.body.error.message as string;
  }

  it("refuses what is not a ZIP", async () => {
    expect(await refused(strToU8("<!doctype html><p>Not an archive</p>"))).toMatch(/not a ZIP archive/);
  });

  it("refuses an archive without a manifest, or with one that is not valid", async () => {
    expect(await refused(zip({ "pages/grid.html": page("Grid") }))).toMatch(/no manifest.json/);
    expect(await refused(zip({ "manifest.json": "{ not json" }))).toMatch(/not valid JSON/);
    expect(await refused(zip({ "manifest.json": JSON.stringify({ pages: [{ page_id: "Not A Slug" }], colour: "red" }) }))).toMatch(/manifest.json/);
  });

  it("refuses names that climb out of the archive, absolute names and backslashes", async () => {
    expect(await refused(zip({ "manifest.json": manifest([{ page_id: "grid" }]), "../escape.html": "x" }))).toMatch(/climbs out of the archive/);
    expect(await refused(zip({ "manifest.json": manifest([{ page_id: "grid" }]), "/etc/passwd": "x" }))).toMatch(/absolute name/);
    expect(await refused(zip({ "manifest.json": manifest([{ page_id: "grid" }]), "pages\\grid.html": "x" }))).toMatch(/uses \\/);
  });

  it("refuses duplicate entries, and names that differ only in capitals", async () => {
    const twice = patch(zip({ "manifest.json": manifest([{ page_id: "grid" }]), "pages/grid.html": page("A"), "pages/gr1d.html": page("B") }), "pages/gr1d.html", "pages/grid.html");
    expect(await refused(twice)).toMatch(/pages\/grid.html appears more than once/);
    expect(await refused(zip({ "manifest.json": manifest([{ page_id: "grid" }]), "brief.md": "a", "BRIEF.md": "b" }))).toMatch(/differ only in capitals/);
  });

  it("refuses entries the manifest does not name", async () => {
    expect(await refused(zip({ "manifest.json": manifest([{ page_id: "grid" }]), "pages/other.html": page("Other"), ".DS_Store": "x" }))).toMatch(/2 entries manifest.json does not name: pages\/other.html, .DS_Store/);
    expect(await refused(zip({ "manifest.json": manifest([{ page_id: "grid", html: "elsewhere/grid.html" }]) }))).toMatch(/it must be pages\/grid.html/);
  });

  it("refuses a ZIP bomb before expanding it, and an entry that expands past what it declares", async () => {
    // Megabytes of zeros compress to kilobytes.
    const zeros = (mb: number) => new Uint8Array(mb * 1024 * 1024);
    const one = zip({ "manifest.json": manifest([{ page_id: "grid" }]), "pages/grid.html": zeros(9) });
    expect(one.length).toBeLessThan(100_000);
    expect(await refused(one)).toMatch(/expands to 9437184 bytes; one entry may expand to at most/);
    const many = zip({ "manifest.json": manifest([1, 2, 3, 4, 5, 6].map((n) => ({ page_id: `p${n}` }))), ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`pages/p${n}.html`, zeros(7)])) });
    expect(await refused(many)).toMatch(/expands to more than 41943040 bytes/);
    // An entry that says it holds 100 bytes but holds a megabyte: 100 is 0x64, a megabyte 0x100000.
    const html = new Uint8Array(1024 * 1024).fill(0x61);
    const liar = zip({ "manifest.json": manifest([{ page_id: "grid" }]), "pages/grid.html": html });
    const view = new DataView(liar.buffer);
    let patched = 0;
    for (let i = 0; i + 4 <= liar.length; i++) if (view.getUint32(i, true) === 1024 * 1024) (view.setUint32(i, 100, true), patched++);
    expect(patched).toBeGreaterThan(0);
    expect(await refused(liar)).toMatch(/pages\/grid.html expands to more than the 100 bytes it declares|pages\/grid.html is damaged/);
  });

  it("refuses an entry whose checksum does not match", async () => {
    // Stored without compression, so one byte of the page can be changed in place.
    const stored = zipSync({ "manifest.json": strToU8(manifest([{ page_id: "grid" }])), "pages/grid.html": strToU8(page("Grid")) }, { level: 0 });
    const i = strFromU8(stored, true).indexOf("Grid</h1>");
    stored[i] = "X".charCodeAt(0);
    expect(await refused(stored)).toMatch(/pages\/grid.html is damaged/);
  });
});

describe("a visitor in the public sandbox", () => {
  let olive: Browser;
  let vera: Browser;
  let S: string;
  let T: string;

  beforeAll(async () => {
    olive = await h.signIn("olive@example.com", "Olive Owner");
    const t = await olive.api("POST", "/api/v1/tenants", { name: "Upload Sandbox" });
    T = `/api/v1/tenants/${t.body.tenant.slug}`;
    const p = await olive.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Showcase" });
    S = `/api/v1/p/${p.body.path}`;
    expect(await syncSandboxTenant(h.db, t.body.tenant.slug, () => {})).toBe(t.body.tenant.tenant_id);
    const inv = await olive.api("POST", `${T}/sandbox/invites`, { label: "Uploads", places: 2, expires_in_days: 7 });
    vera = await h.signIn("vera@example.com", "Vera Visitor");
    expect((await vera.api("POST", "/api/v1/sandbox/join", { code: String(inv.body.invite_link).split("/join/")[1] })).status).toBe(200);
  });

  async function setSettings(patch: Record<string, unknown>) {
    const etag = (await olive.api("GET", `${T}/sandbox/settings`)).body.etag;
    expect((await olive.api("PATCH", `${T}/sandbox/settings`, { expected_etag: etag, ...patch })).status).toBe(200);
  }

  it("publishes from an upload within the limits, and the archive counts against their uploads", async () => {
    const bytes = zip({ "manifest.json": manifest([{ page_id: "a", title: "A" }], { title: "Visitor canvas" }), "pages/a.html": page("A") });
    const { grant, put } = await upload(vera, S, bytes);
    expect(put.status).toBe(201);
    expect((await publish(vera, { upload_id: grant.upload_id }, S)).status).toBe(201);
    const status = await vera.api("GET", `${T}/sandbox`);
    expect(status.body.allowances.find((a: { key: string }) => a.key === "bytes_per_day")).toMatchObject({ used: put.body.size });
  });

  it("is held to the longest text a field may hold, for what arrives in the archive", async () => {
    await setSettings({ text_max_chars: 100 });
    const { grant } = await upload(vera, S, zip({ "manifest.json": manifest([{ page_id: "a", title: "A" }], { title: "Too long" }), "pages/a.html": page("A long page") }));
    const r = await publish(vera, { upload_id: grant.upload_id }, S);
    expect(r.status).toBe(413);
    expect(r.body.error.details).toMatchObject({ field: "pages[0].html", limit: 100 });
    await setSettings({ text_max_chars: 200_000 });
  });

  it("gets no grant larger than today's upload allowance, and none when uploads are off", async () => {
    await setSettings({ bytes_per_day: 2000 });
    const g = await vera.api("POST", `${S}/mockups/uploads`, {});
    expect(g.body.max_bytes).toBeLessThan(2000);
    const tooBig = await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: new Uint8Array(3000) });
    expect(tooBig.status).toBe(413);
    await setSettings({ bytes_per_day: 0 });
    const off = await vera.api("POST", `${S}/mockups/uploads`, {});
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe("sandbox_restricted");
  });
});
