import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We export everything to a spreadsheet every Friday.

00:00:05.000 --> 00:00:08.000
<v Dana>Mostly by hand.

00:00:08.000 --> 00:00:09.000
<v Sam>Why Friday?

00:01:09.000 --> 00:01:14.000
<v Dana>Because that is when the numbers close and the pricing review happens.
`;

/** The call as its derived text reads: a turn to a paragraph, with who spoke and when the turn starts. */
const TEXT =
  "**Dana** (0:01): We export everything to a spreadsheet every Friday. Mostly by hand.\n\n" +
  "**Sam** (0:08): Why Friday?\n\n" +
  "**Dana** (1:09): Because that is when the numbers close and the pricing review happens.\n";

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
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path });
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

  it("lays out each turn with its speaker and start time, running a speaker's consecutive cues on as one paragraph", async () => {
    const text = await alice.api("GET", `${P}/sources/${recordId}/derived/text`);
    expect(text.status).toBe(200);
    expect(text.body).toMatchObject({ of: "derived_text", text: TEXT, total_chars: TEXT.length, taken_from: { path: "turns.vtt" } });
    const brief = await alice.api("GET", `${P}/sources/${recordId}`);
    expect(brief.body).toMatchObject({ derived_status: "ready", duration_ms: 74_000, text_chars: TEXT.length });
    const manifest = await alice.api("GET", `${P}/sources/${recordId}/derived/manifest`);
    expect(manifest.body).toMatchObject({ path: "turns.vtt", status: "ready", parser: "webvtt", duration_ms: 74_000, text_chars: TEXT.length });
    expect(manifest.body).not.toHaveProperty("segment_count");
  });

  it("reads by code-point offset, never by cue time or passage number", async () => {
    const at = TEXT.indexOf("Why Friday?");
    const window = await alice.api("GET", `${P}/sources/${recordId}/derived/text?offset=${at}&limit=11`);
    expect(window.body).toMatchObject({ offset: at, text: "Why Friday?", truncated: true });
    const byTime = await alice.api("GET", `${P}/sources/${recordId}/derived/text?start=0&end=2&unit=ms`);
    expect(byTime.status).toBe(422);
    expect(byTime.body.error.message).toMatch(/reads by code-point offset: send offset and limit/);
    expect((await alice.api("GET", `${P}/sources/${recordId}/passage?start=0&end=2`)).status).toBe(404);
  });
});
