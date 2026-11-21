import { Storage } from "@google-cloud/storage";
import { OAuth2Client } from "google-auth-library";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GcsBlobStore, storageStatus } from "../src/adapters/blobs-gcs.ts";

// The Cloud Storage adapter against the real client, pointed at a stand-in for the service that
// refuses everything as Cloud Storage does: a missing object (404) and a create-only write over an
// object that is there (412). What the adapter makes of each must not depend on how the client
// shapes its errors.

let server: Server;
const seen: string[] = [];
let endpoint: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    req.resume();
    req.on("end", () => {
      const status = req.method === "POST" ? 412 : 404;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: status, message: status === 412 ? "At least one of the pre-conditions you specified did not hold." : "No such object." } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The client at the stand-in, with a token that never needs refreshing in place of the runtime's identity. */
function client() {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: "test-token", expiry_date: Date.now() + 3_600_000 });
  return new Storage({ apiEndpoint: endpoint, projectId: "whatbuild-test", authClient: auth, retryOptions: { autoRetry: false } });
}

describe("the Cloud Storage adapter's refusals", () => {
  it("reads the HTTP status from either shape the client has given its errors", () => {
    expect(storageStatus({ status: 404 })).toBe(404);
    expect(storageStatus({ code: 412 })).toBe(412);
    expect(storageStatus({ code: "ECONNRESET" })).toBeUndefined();
    expect(storageStatus(null)).toBeUndefined();
  });

  it("takes a missing object as missing, and a write over one that is there as a conflict", async () => {
    const blobs = new GcsBlobStore("whatbuild-test", false, client());
    expect(await blobs.stat("t/x/missing")).toBeNull();
    await expect(blobs.get("t/x/missing")).rejects.toMatchObject({ status: 404, code: "blob_missing" });
    await expect(blobs.put("t/x/there", new Uint8Array([1, 2, 3]), { contentType: "application/octet-stream" })).rejects.toMatchObject({ status: 409, code: "blob_exists" });
    await expect(blobs.delete("t/x/missing")).resolves.toBeUndefined();
    // Each went to the stand-in, so the client asked the service rather than failing before it.
    expect(seen.some((s) => s.startsWith("GET "))).toBe(true);
    expect(seen.some((s) => s.startsWith("POST "))).toBe(true);
    expect(seen.some((s) => s.startsWith("DELETE "))).toBe(true);
  });
});
