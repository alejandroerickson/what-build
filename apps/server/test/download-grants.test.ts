import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// A download grant names whoever requested it, and its route checks again before it sends a byte
// that they may still read what it names: removed, lowered or disconnected, the grant stops.

let h: Harness;
let org: Organization;
let bob: Browser;
let bobId: string;

const KINDS = ["download", "mockup", "story_preview", "card_preview", "export"] as const;
type Kind = (typeof KINDS)[number];
interface Grant {
  url: string;
  headers: Record<string, string>;
}

function body(r: unknown): any {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  return JSON.parse(t.startsWith("{") ? t : t.slice(t.indexOf("\n") + 1));
}

async function agent(browser: Browser, path = "/mcp", level: "viewer" | "editor" | "admin" = "editor") {
  const token = await h.connectAgent(browser, "Grant agent", path, level);
  const c = new Client({ name: "grant-agent", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}${path}`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const agents = (await browser.api("GET", "/api/v1/me/agents")).body.items as { family_id: string; created_at: string }[];
  const family = agents.sort((x, y) => y.created_at.localeCompare(x.created_at))[0]!.family_id;
  return { c, family };
}

/** A grant of each kind, asked for by an agent over MCP. */
async function grant(c: Client, kind: Kind, product = org.product.path): Promise<Grant> {
  const call = async (name: string, action: string, params: Record<string, unknown>) => {
    const r = body(await c.callTool({ name, arguments: { action, product, params } }));
    expect(r.error, `${kind}: ${JSON.stringify(r.error)}`).toBeUndefined();
    return r;
  };
  if (kind === "download") return call("attachments", "get_download", { record_id: org.source.id, path: org.source.path });
  if (kind === "mockup") return call("mockups", "get_download", { mockup_id: org.mockup.id });
  if (kind === "story_preview") return (await call("story", "preview", { page_id: "grant-check", title: "Grant check", body: "<main class=\"page\"><p>Checked.</p></main>" })).preview;
  if (kind === "card_preview") return (await call("outcomes", "card_preview", { card_html: '<p class="wb-pitch">A front to check.</p>' })).preview;
  const items = (await call("products", "exports", {})).items as { status: string; download: Grant | null }[];
  return items.find((i) => i.status === "ready")!.download!;
}

async function use(g: Grant) {
  const r = await fetch(g.url, { headers: g.headers });
  const text = await r.text();
  return { status: r.status, text };
}

async function grants(c: Client, product?: string): Promise<Record<Kind, Grant>> {
  const out = {} as Record<Kind, Grant>;
  for (const k of KINDS) out[k] = await grant(c, k, product);
  return out;
}

/** Bob's role on the team: granting again replaces it. */
async function setRole(role: "reader" | "editor") {
  const r = await org.owner.api("POST", `/api/v1/tenants/${org.tenant.slug}/members`, { email: "bob@grants.example", role, team: org.team.slug });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
}

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["root@example.com"] });
  const alice = await h.signIn("alice@grants.example", "Alice Grants");
  org = await buildOrganization(h, alice, "Grant Works", "GRANT7");
  await h.worker.drain();
  const T = `/api/v1/tenants/${org.tenant.slug}`;
  expect((await alice.api("POST", `${T}/members`, { email: "bob@grants.example", role: "editor", team: org.team.slug })).status).toBeLessThan(300);
  bob = await h.signIn("bob@grants.example", "Bob Grants");
  bobId = (await bob.api("GET", "/api/v1/me")).body.account_id;
}, 120_000);
afterAll(async () => h?.close());

describe("a download grant", () => {
  it("serves its bytes while its requester may still read them", async () => {
    const { c } = await agent(bob);
    for (const [kind, g] of Object.entries(await grants(c))) expect((await use(g)).status, kind).toBe(200);
    await c.close();
  });

  it("stops when its agent's connection is disconnected", async () => {
    const { c, family } = await agent(bob);
    const held = await grants(c);
    await c.close();
    expect((await bob.api("DELETE", `/api/v1/me/agents/${family}`)).status).toBeLessThan(300);
    for (const [kind, g] of Object.entries(held)) {
      const r = await use(g);
      expect(r.status, kind).toBe(403);
      expect(r.text, kind).toContain("disconnected");
    }
  });

  it("stops at what its connection's lowered level no longer allows", async () => {
    const { c, family } = await agent(bob);
    const held = await grants(c);
    await c.close();
    expect((await bob.api("PATCH", `/api/v1/me/agents/${family}`, { level: "viewer" })).status).toBeLessThan(300);
    // Reading needs Read only; a preview was a write's.
    for (const kind of ["download", "mockup", "export"] as const) expect((await use(held[kind])).status, kind).toBe(200);
    for (const kind of ["story_preview", "card_preview"] as const) expect((await use(held[kind])).status, kind).toBe(403);
  });

  it("stops when its requester is lowered to a role that may not read it, and sends nothing", async () => {
    const { c } = await agent(bob);
    const held = await grants(c);
    await c.close();
    await setRole("reader");
    try {
      for (const [kind, g] of Object.entries(held)) {
        const r = await use(g);
        expect(r.status, kind).toBe(403);
        expect(JSON.parse(r.text).error.message, kind).toBe("Whoever requested this grant can no longer read this product. Nothing was sent.");
      }
    } finally {
      await setRole("editor");
    }
  });

  it("stops when its requester is removed from the organization", async () => {
    const { c } = await agent(bob);
    const held = await grants(c);
    await c.close();
    const T = `/api/v1/tenants/${org.tenant.slug}`;
    expect((await org.owner.api("POST", `${T}/members/revoke`, { account_id: bobId, whole_tenant: true })).status).toBeLessThan(300);
    try {
      for (const [kind, g] of Object.entries(held)) expect((await use(g)).status, kind).toBe(403);
    } finally {
      expect((await org.owner.api("POST", `${T}/members`, { email: "bob@grants.example", role: "editor", team: org.team.slug })).status).toBeLessThan(300);
    }
  });

  it("names its requester under its signature, so the name cannot be changed", async () => {
    const { c } = await agent(bob);
    const g = await grant(c, "download");
    await c.close();
    const token = g.headers["X-WhatBuild-Download-Grant"]!;
    const [payload, mac] = token.split(".") as [string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(claims).toMatchObject({ a: bobId, f: expect.any(String) });
    const forged = `${Buffer.from(JSON.stringify({ ...claims, a: org.ownerAccountId })).toString("base64url")}.${mac}`;
    expect((await use({ url: g.url, headers: { "X-WhatBuild-Download-Grant": forged } })).status).toBe(401);
  });
});

describe("a download grant in the example organization", () => {
  it("serves a guest's download, and stops when the deployment no longer names the example", async () => {
    expect(await syncExampleTenant(h.db, org.tenant.slug, () => {})).toBe(org.tenant.id);
    try {
      const gus = await h.signIn("gus@grants.example", "Gus Guest");
      const { c } = await agent(gus, `/mcp/t/${org.tenant.slug}`);
      const g = await grant(c, "download");
      // A guest reads, and writes nothing: a preview asks as a write would.
      const preview = body(await c.callTool({ name: "story", arguments: { action: "preview", product: org.product.path, params: { page_id: "guest-check", title: "Guest check", body: "<main class=\"page\"><p>No.</p></main>" } } }));
      expect(preview.error.code).toBe("example_read_only");
      await c.close();
      expect((await use(g)).status).toBe(200);
      await syncExampleTenant(h.db, null, () => {});
      const r = await use(g);
      expect(r.status).toBe(403);
      expect(r.text).not.toContain(org.source.path);
    } finally {
      await syncExampleTenant(h.db, null, () => {});
    }
  });
});
