import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We export everything to a spreadsheet every Friday.

00:00:05.000 --> 00:00:09.000
<v Sam>Why Friday?

00:00:09.000 --> 00:00:14.000
<v Dana>Because that is when the numbers close and the pricing review happens.
`;

let h: Harness;
let alice: Browser;
let P: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

async function upload(tag: string, path: string, body: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path, role: "primary" });
  expect(created.status).toBe(201);
  const recordId: string = created.body.record.record_id;
  const put = await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body });
  expect(put.status).toBe(201);
  await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path });
  await h.worker.drain();
  return recordId;
}

describe("reading a timed transcript", () => {
  let recordId: string;
  beforeAll(async () => {
    recordId = await upload("interview", "turns.vtt", VTT);
  });

  it("asks whether segment numbers were meant when a small window with no unit reads no cues", async () => {
    const seqLike = await alice.api("GET", `${P}/sources/${recordId}/passage?start=0&end=2`);
    expect(seqLike.body.unit).toBe("ms");
    expect(seqLike.body.segments).toEqual([]);
    expect(seqLike.body.warning).toMatch(/did you mean unit: "seq" \(segments 0–2\)\?/);
    const gap = await alice.api("GET", `${P}/sources/${recordId}/passage?start=100&end=200`);
    expect(gap.body.warning).toBe("No cue overlaps this window: a gap between cues.");
    const explicit = await alice.api("GET", `${P}/sources/${recordId}/passage?start=0&end=2&unit=ms`);
    expect(explicit.body.warning).toBe("No cue overlaps this window: a gap between cues.");
  });
});
