import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isVideoFile, type Tx } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// WhatBuild takes no video. Every way a file comes in to a source refuses one, by its extension or
// by the media type WhatBuild gives it, with 415 video_not_accepted, before a source is made or a
// byte is stored. A recording (audio) is taken as before.

let h: Harness;
let alice: Browser;
let P: string;
let path: string;
let tenantId: string;
/** What the stand-in fetcher hands back, and whether it was asked. */
let fetched = { bytes: new Uint8Array(64), fileName: "clip", mediaType: "video/mp4" };
let fetches = 0;

const refusal = { code: "video_not_accepted", message: expect.stringMatching(/is a video, and WhatBuild does not keep video, so nothing was added\. Add the video's transcript instead/) };

beforeAll(async () => {
  h = await startHarness(
    {},
    {
      fetcher: {
        async fetch() {
          fetches++;
          return fetched;
        },
      },
    },
  );
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Video Co" });
  tenantId = t.body.tenant.tenant_id;
  const p = await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/products`, { name: "Walk-rounds" });
  path = p.body.path;
  P = `/api/v1/p/${path}`;
});
afterAll(async () => h?.close());

/** Rows of this organization, as row-level security lets them be read and changed. */
const inTenant = <T>(fn: (trx: Tx) => Promise<T>) =>
  h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
const newSource = async (title = "A site walk-round") => (await alice.api("POST", `${P}/sources`, { title })).body.record_id as string;
const sourceCount = async () => (await alice.api("GET", `${P}/sources?limit=200`)).body.records.length as number;

describe("a video", () => {
  it("is known by its extension, or by its media type when its extension is no recording's", () => {
    for (const name of ["walk.mp4", "walk.MOV", "walk.webm", "walk.mkv", "walk.m4v", "walk.avi", "walk.mpeg", "walk.3gp", "walk.ogv"]) expect(isVideoFile(name), name).toBe(true);
    expect(isVideoFile("walk", "video/mp4")).toBe(true);
    expect(isVideoFile("walk.bin", "video/quicktime")).toBe(true);
    // A recording's extension wins over a type declared for it; other files are never videos.
    for (const [name, type] of [["call.m4a", "video/mp4"], ["call.mp3", undefined], ["call.ogg", "video/ogg"], ["notes.txt", "video/mp4"], ["types.ts", undefined]] as const)
      expect(isVideoFile(name, type), name).toBe(false);
  });

  it("is refused a grant to upload it, by its extension or its declared type", async () => {
    const id = await newSource();
    for (const body of [{ path: "walk.mp4" }, { path: "walk", media_type: "video/mp4" }, { path: "walk.MOV", media_type: "application/octet-stream" }]) {
      const r = await alice.api("POST", `${P}/sources/${id}/uploads`, { record_id: id, ...body });
      expect(r.status, JSON.stringify(r.body)).toBe(415);
      expect(r.body.error).toMatchObject({ ...refusal, details: { path: body.path } });
    }
    expect((await alice.api("GET", `${P}/sources/${id}?detail=full`)).body.attachments).toEqual([]);
  });

  it("makes no source when it would be the first attachment of one, or of several", async () => {
    const before = await sourceCount();
    const one = await alice.api("POST", `${P}/sources/with-upload`, { title: "A walk-round", path: "walk.webm" });
    expect(one.status, JSON.stringify(one.body)).toBe(415);
    expect(one.body.error).toMatchObject(refusal);
    const several = await alice.api("POST", `${P}/sources/with-uploads`, {
      sources: [
        { title: "Interview notes", path: "notes.md" },
        { title: "A walk-round", path: "walk.mkv" },
      ],
    });
    expect(several.status, JSON.stringify(several.body)).toBe(415);
    expect(several.body.error).toMatchObject({ code: "video_not_accepted", message: expect.stringMatching(/^sources\[1\] \(A walk-round\): walk\.mkv is a video.*Nothing was created\.$/), details: { index: 1 } });
    expect(await sourceCount()).toBe(before);
  });

  it("is refused to an agent, as to the web app", async () => {
    const id = await newSource();
    const client = new Client({ name: "video-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(alice)}` } } }));
    try {
      const r = await client.callTool({ name: "attachments_write", arguments: { action: "request_upload", product: path, params: { record_id: id, path: "walk.mp4" } } });
      expect(r.isError).toBe(true);
      expect((r.content as { text: string }[])[0]!.text).toMatch(/^415: walk\.mp4 is a video, and WhatBuild does not keep video/);
      const made = await client.callTool({ name: "attachments_write", arguments: { action: "create_upload", product: path, params: { title: "A walk-round", path: "walk.mov" } } });
      expect((made.content as { text: string }[])[0]!.text).toMatch(/^415: walk\.mov is a video/);
    } finally {
      await client.close();
    }
  });

  it("is not fetched when its URL or path names one, and is not stored when its type says so", async () => {
    const id = await newSource();
    fetches = 0;
    const byUrl = await alice.api("POST", `${P}/sources/${id}/fetch`, { record_id: id, url: "https://media.example.com/walks/site%20walk.mp4?x=1" });
    expect(byUrl.status, JSON.stringify(byUrl.body)).toBe(415);
    expect(byUrl.body.error).toMatchObject({ ...refusal, details: { path: "site walk.mp4" } });
    const byPath = await alice.api("POST", `${P}/sources/${id}/fetch`, { record_id: id, url: "https://media.example.com/walks/latest", path: "walk.webm" });
    expect(byPath.status).toBe(415);
    expect(fetches).toBe(0);

    fetched = { bytes: new Uint8Array(64), fileName: "clip", mediaType: "video/mp4" };
    const byType = await alice.api("POST", `${P}/sources/${id}/fetch`, { record_id: id, url: "https://media.example.com/watch?v=1" });
    expect(byType.status, JSON.stringify(byType.body)).toBe(415);
    expect(byType.body.error).toMatchObject({ ...refusal, details: { path: "clip.mp4" } });
    expect(fetches).toBe(1);
    expect((await alice.api("GET", `${P}/sources/${id}?detail=full`)).body.attachments).toEqual([]);
  });

  it("stores nothing under a grant given for a video before videos were refused", async () => {
    const id = await newSource();
    const grant = await alice.api("POST", `${P}/sources/${id}/uploads`, { record_id: id, path: "walk.bin" });
    expect(grant.status).toBe(201);
    // As a grant given before this version: for a video.
    await inTenant((trx) => trx.updateTable("upload_grants").set({ path: "walk.mp4", media_type: "video/mp4" }).where("grant_id", "=", grant.body.grant_id).execute());
    const put = await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: new Uint8Array(64) });
    expect(put.status).toBe(415);
    expect(((await put.json()) as { error: { code: string } }).error.code).toBe("video_not_accepted");
    const stored = await inTenant((trx) => trx.selectFrom("upload_grants").select(["blob_key", "uploaded_at"]).where("grant_id", "=", grant.body.grant_id).executeTakeFirstOrThrow());
    expect(stored.uploaded_at).toBeNull();
    expect(await h.blobs.stat(stored.blob_key!)).toBeNull();

    // Bytes that reached the store directly under such a grant are not added either.
    const other = await alice.api("POST", `${P}/sources/${id}/uploads`, { record_id: id, path: "round.bin" });
    const row = await inTenant((trx) => trx.selectFrom("upload_grants").select("blob_key").where("grant_id", "=", other.body.grant_id).executeTakeFirstOrThrow());
    await h.blobs.put(row.blob_key!, new Uint8Array(64), { contentType: "video/mp4" });
    await inTenant((trx) => trx.updateTable("upload_grants").set({ path: "round.mp4", media_type: "video/mp4" }).where("grant_id", "=", other.body.grant_id).execute());
    const completed = await alice.api("POST", `${P}/sources/${id}/uploads/complete`, { record_id: id, path: "round.mp4" });
    expect(completed.status, JSON.stringify(completed.body)).toBe(415);
    expect(completed.body.error.code).toBe("video_not_accepted");
    expect((await alice.api("GET", `${P}/sources/${id}?detail=full`)).body.attachments).toEqual([]);
  });
});

describe("a recording", () => {
  it("is taken as before: kept, playable and never transcribed, even when a type says video", async () => {
    const made = await alice.api("POST", `${P}/sources/with-upload`, { title: "A crew call", path: "call.m4a", media_type: "video/mp4" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.upload.headers["Content-Type"]).toBe("audio/mp4");
    const put = await fetch(made.body.upload.url, { method: "PUT", headers: made.body.upload.headers, body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) });
    expect(put.status).toBe(201);
    const { attachment } = (await put.json()) as { attachment: { note: string; text: { status: string } } };
    expect(attachment.text.status).toBe("needs_transcript");
    expect(attachment.note).toMatch(/^call\.m4a is a recording: it is stored and playable, but WhatBuild never transcribes/);
    const r = await fetch(`${h.baseUrl}${P}/sources/${made.body.record.record_id}/attachment?path=call.m4a`, { headers: { cookie: alice.cookie, range: "bytes=0-3" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0, 0, 0, 24]));
  });
});
