import { createHash } from "node:crypto";
import type { BlobStore, Tx } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directUploadSigning } from "../src/adapters/blobs-gcs.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/**
 * Direct uploads go straight to the bucket when it signs URLs. There is no bucket in tests, so the
 * in-memory store stands in for one: it "signs" a URL and the test puts what the bucket would hold.
 */
let h: Harness;
let alice: Browser;
let P: string;
let tenantId: string;
const signed: { key: string; maxBytes: number }[] = [];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => {
  h = await startHarness({ fileMaxBytes: 1000, relayMaxBytes: 500 });
  (h.blobs as BlobStore).signedUploadUrl = async (key, contentType, _expiresAt, maxBytes) => {
    signed.push({ key, maxBytes });
    return { url: `https://storage.example/${key}`, headers: { "Content-Type": contentType } };
  };
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Direct Co" });
  tenantId = t.body.tenant.tenant_id as string;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

/** A source with a direct grant for its first attachment, and the key the bucket would store it under. */
async function directGrant(title: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["report"], title, path: "report.txt" });
  expect(created.status).toBe(201);
  expect(created.body.upload.direct.max_bytes).toBe(1000);
  return { recordId: created.body.record.record_id as string, key: signed.at(-1)!.key };
}

describe("a direct upload", () => {
  it("is signed for the grant's size at most", async () => {
    await directGrant("Signed report — Example Co");
    expect(signed.at(-1)!.maxBytes).toBe(1000);
    const { config, headers } = directUploadSigning("text/plain", new Date("2026-10-10T12:00:00Z"), 1000);
    expect(config).toMatchObject({ version: "v4", action: "write", contentType: "text/plain", extensionHeaders: { "x-goog-if-generation-match": "0", "x-goog-content-length-range": "0,1000" } });
    expect(headers).toEqual({ "Content-Type": "text/plain", "x-goog-if-generation-match": "0", "x-goog-content-length-range": "0,1000" });
  });

  it("is refused, before its bytes are read, when the object is over the grant's size", async () => {
    const { recordId, key } = await directGrant("Oversized report — Example Co");
    await h.blobs.put(key, new Uint8Array(1001), { contentType: "text/plain" });
    let read = 0;
    const { get, getStream } = h.blobs;
    h.blobs.get = async (k) => (read++, get.call(h.blobs, k));
    h.blobs.getStream = async (k, r) => (read++, getStream.call(h.blobs, k, r));
    const done = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "report.txt" });
    h.blobs.get = get;
    h.blobs.getStream = getStream;
    expect(done.status).toBe(413);
    expect(done.body.error).toMatchObject({ code: "too_large", details: { limit: 1000 } });
    expect(read).toBe(0);
    expect(h.blobs.blobs.has(key)).toBe(false);
    expect((await alice.api("GET", `${P}/sources/${recordId}?detail=full`)).body.attachments).toEqual([]);
  });

  it("is offered only for a file that may not fit the relay, whose size is enforced as it arrives", async () => {
    const { recordId } = await directGrant("Sized report — Example Co");
    const before = signed.length;
    const fits = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { path: "small.txt", size: 500 });
    expect(fits.status).toBe(201);
    expect(fits.body.direct).toBeUndefined();
    expect(signed.length).toBe(before);
    const past = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { path: "large.txt", size: 501 });
    expect(past.status).toBe(201);
    expect(past.body).toMatchObject({ max_bytes: 500, direct: { max_bytes: 1000 } });
    expect((await alice.api("POST", `${P}/sources/${recordId}/uploads`, { path: "too-large.txt", size: 1001 })).status).toBe(413);
  });

  it("counts against the day, as a file through the relay does, and adds the attachment once", async () => {
    const { recordId, key } = await directGrant("Counted report — Example Co");
    const bytes = new TextEncoder().encode("x".repeat(800));
    await h.blobs.put(key, bytes, { contentType: "text/plain" });
    const body = { record_id: recordId, path: "report.txt" };
    const done = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, body);
    expect(done.status).toBe(200);
    expect(done.body.size).toBe(800);
    expect((await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, body)).status).toBe(200);
    const full = await alice.api("GET", `${P}/sources/${recordId}?detail=full`);
    expect(full.body.attachments).toHaveLength(1);
    const counted = async () => Number((await sql<{ n: string }>`select coalesce(sum(n), 0)::text as n from limit_counters where bucket = 'day' and counter = 'bytes' and account_id = ''`.execute(h.db)).rows[0]!.n);
    expect(await counted()).toBeGreaterThanOrEqual(800);
    const once = await counted();
    await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, body);
    expect(await counted()).toBe(once);
  });

  it("holds no database connection while the bytes are hashed", async () => {
    const { recordId, key } = await directGrant("Patient report — Example Co");
    await h.blobs.put(key, new Uint8Array(900), { contentType: "text/plain" });
    const { getStream } = h.blobs;
    let open: number | null = null;
    h.blobs.getStream = async (k, r) => {
      const held = await sql<{ n: string }>`select count(*)::text as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`.execute(h.db);
      open = Number(held.rows[0]!.n);
      return getStream.call(h.blobs, k, r);
    };
    const done = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "report.txt" });
    h.blobs.getStream = getStream;
    expect(done.status).toBe(200);
    expect(open).toBe(0);
  });

  it("leaves nothing behind when nobody completes it", async () => {
    const { key } = await directGrant("Abandoned report — Example Co");
    const relayed = await directGrant("Another abandoned report — Example Co");
    await h.blobs.put(key, new Uint8Array(900), { contentType: "text/plain" });
    const inTenant = <T,>(fn: (trx: Tx) => Promise<T>) =>
      h.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
        return fn(trx);
      });
    await inTenant((trx) => trx.updateTable("upload_grants").set({ expires_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).where("blob_key", "=", key).execute());
    (h.worker as unknown as { lastPrune: number }).lastPrune = 0;
    await h.worker.drain();
    expect(h.blobs.blobs.has(key)).toBe(false);
    const left = await inTenant((trx) => trx.selectFrom("upload_grants").select("blob_key").where("blob_key", "in", [key, relayed.key]).execute());
    // A grant still open keeps its place.
    expect(left.map((g) => g.blob_key)).toEqual([relayed.key]);
  });

  it("is registered with the hash of the bytes that landed, never one stored beside them", async () => {
    const { recordId, key } = await directGrant("Hashed report — Example Co");
    const bytes = new TextEncoder().encode("Crews plan by the week.\n");
    h.blobs.blobs.set(key, { data: bytes, contentType: "text/plain", sha256: "0".repeat(64) });
    const done = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "report.txt" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ size: bytes.byteLength, sha256: sha(bytes) });
  });
});

describe("a deployment whose store signs no uploads", () => {
  let plain: Harness;
  afterAll(async () => plain?.close());

  it("refuses a file past the relay before any bytes move, and says the most it takes", async () => {
    plain = await startHarness({ fileMaxBytes: 1000, relayMaxBytes: 500 });
    const carol = await plain.signIn("carol@example.com", "Carol Example");
    const t = await carol.api("POST", "/api/v1/tenants", { name: "Plain Co" });
    const p = await carol.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Plain" });
    const path = `/api/v1/p/${p.body.path}`;
    const past = await carol.api("POST", `${path}/sources/with-upload`, { tags: ["report"], title: "Past the relay — Example Co", path: "big.txt", size: 501 });
    expect(past.status).toBe(413);
    expect(past.body.error.details).toMatchObject({ limit: 500 });
    expect(past.body.error.message).toBe("The file is 501 bytes; files here are limited to 500 bytes.");
    const limits = await carol.api("GET", `/api/v1/tenants/${t.body.tenant.slug}/limits`);
    expect(limits.body.deployment_limits.find((l: { key: string }) => l.key === "upload_max_bytes").value).toBe(500);
    expect(((await (await fetch(`${plain.baseUrl}/api/v1/plans`)).json()) as { file_max_bytes: number }).file_max_bytes).toBe(500);
  });
});

describe("a file past what Cloud Run answers with a length", () => {
  const MiB = 1024 * 1024;
  let large: Harness;
  afterAll(async () => large?.close());

  it("is downloaded whole, without saying its length, and a small one still says it", async () => {
    large = await startHarness({ fileMaxBytes: 40 * MiB, relayMaxBytes: 500 });
    let lastKey = "";
    (large.blobs as BlobStore).signedUploadUrl = async (key, contentType) => {
      lastKey = key;
      return { url: `https://storage.example/${key}`, headers: { "Content-Type": contentType } };
    };
    const dana = await large.signIn("dana@example.com", "Dana Example");
    const t = await dana.api("POST", "/api/v1/tenants", { name: "Large Co" });
    const p = await dana.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Large" });
    const path = `/api/v1/p/${p.body.path}`;
    const attach = async (name: string, size: number) => {
      const made = await dana.api("POST", `${path}/sources/with-upload`, { tags: ["deck"], title: `${name} — Example Co`, path: name, size });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const record_id = made.body.record.record_id as string;
      if (made.body.upload.direct) await large.blobs.put(lastKey, new Uint8Array(size), { contentType: "application/octet-stream" });
      else expect((await fetch(made.body.upload.url, { method: "PUT", headers: made.body.upload.headers, body: new Uint8Array(size) })).status).toBe(201);
      if (made.body.upload.direct) expect((await dana.api("POST", `${path}/sources/${record_id}/uploads/complete`, { path: name })).status).toBe(200);
      const grant = await dana.api("POST", `${path}/sources/${record_id}/downloads`, { path: name });
      expect(grant.status, JSON.stringify(grant.body)).toBe(200);
      return grant.body as { url: string; headers: Record<string, string> };
    };

    const big = await attach("large.bin", 33 * MiB);
    const whole = await fetch(big.url, { headers: big.headers });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBeNull();
    expect(whole.headers.get("transfer-encoding")).toBe("chunked");
    expect((await whole.arrayBuffer()).byteLength).toBe(33 * MiB);

    const rest = await fetch(big.url, { headers: { ...big.headers, Range: "bytes=1-" } });
    expect(rest.status).toBe(206);
    expect(rest.headers.get("content-length")).toBeNull();
    expect(rest.headers.get("transfer-encoding")).toBe("chunked");
    expect(rest.headers.get("content-range")).toBe(`bytes 1-${33 * MiB - 1}/${33 * MiB}`);
    expect((await rest.arrayBuffer()).byteLength).toBe(33 * MiB - 1);

    const piece = await fetch(big.url, { headers: { ...big.headers, Range: "bytes=0-9" } });
    expect(piece.status).toBe(206);
    expect(piece.headers.get("content-length")).toBe("10");
    await piece.arrayBuffer();

    const small = await attach("small.bin", 100);
    const shown = await fetch(small.url, { headers: small.headers });
    expect(shown.headers.get("content-length")).toBe("100");
    await shown.arrayBuffer();
  }, 60_000);
});
