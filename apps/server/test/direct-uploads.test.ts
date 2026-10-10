import { createHash } from "node:crypto";
import type { BlobStore } from "@whatbuild/core";
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
const signed: { key: string; maxBytes: number }[] = [];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => {
  h = await startHarness({ fileMaxBytes: 1000 });
  (h.blobs as BlobStore).signedUploadUrl = async (key, contentType, _expiresAt, maxBytes) => {
    signed.push({ key, maxBytes });
    return { url: `https://storage.example/${key}`, headers: { "Content-Type": contentType } };
  };
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Direct Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

/** A source with a direct grant for its primary, and the key the bucket would store it under. */
async function directGrant(title: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["report"], title, path: "report.txt", role: "primary" });
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
    expect((await alice.api("GET", `${P}/sources/${recordId}?detail=full`)).body.files).toEqual([]);
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
