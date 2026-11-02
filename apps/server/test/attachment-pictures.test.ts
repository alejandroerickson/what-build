import { crc32, deflateSync } from "node:zlib";
import { deckFacts } from "@whatbuild/parsers";
import { strToU8, zipSync } from "fflate";
import { sql } from "kysely";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PICTURE_ATTEMPTS } from "@whatbuild/core";
import { PICTURE_LIMITS, processPictureMaker } from "../src/picture-process.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An attachment's picture: made by the worker from an image, a PDF's first page or a deck, listed
// by sources.list, served by an address that costs no call, and gone with its source. A video's is a
// frame someone sends. A recording is served in pieces, each counted as what it holds.

let h: Harness;
let alice: Browser;
let bob: Browser;
let P: string;
let TENANT: string;
let TENANT_ID: string;

beforeAll(async () => {
  h = await startHarness({});
  alice = await h.signIn("alice@example.com", "Alice Example");
  bob = await h.signIn("bob@example.com", "Bob Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Pictures Co" });
  TENANT = t.body.tenant.slug as string;
  TENANT_ID = t.body.tenant.tenant_id as string;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Gallery" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

async function attach(path: string, bytes: Uint8Array, media_type?: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { title: `Source of ${path}`, path, ...(media_type ? { media_type } : {}) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const upload = created.body.upload as { url: string; headers: Record<string, string> };
  expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes as unknown as ArrayBuffer })).status).toBe(201);
  await h.worker.drain();
  return created.body.record.record_id as string;
}

const listed = async (recordId: string) => {
  const r = await alice.api("GET", `${P}/sources?include_preview=true&include_summary=true&limit=200`);
  expect(r.status).toBe(200);
  return (r.body.records as { record_id: string; first_lines: string | null; attachments: { path: string; picture: Record<string, unknown> | null; text: { status: string } }[] }[]).find((x) => x.record_id === recordId)!;
};

const photo = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#3a6ea5" } }).jpeg().toBuffer();

/** A PNG that says it is this large, 400 megapixels at 20,000 square, in a few dozen bytes. */
function pngOfSize(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(16))), chunk("IEND", Buffer.alloc(0))]);
}

const PDF = (() => {
  const stream = "BT /F1 24 Tf 72 720 Td (Crews plan the week on Friday.) Tj ET";
  return new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
trailer << /Root 1 0 R >>
%%EOF
`);
})();

/** A small deck as PowerPoint lays one out, with whatever picture of itself it is given. */
function deck(opts: { thumbnail?: Uint8Array; title?: string; notes?: string } = {}) {
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const shape = (ph: string, text: string) => `<p:sp><p:nvSpPr><p:nvPr><p:ph type="${ph}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const slide = (shapes: string) => `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
  return zipSync({
    "ppt/presentation.xml": strToU8(`<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": strToU8(`<Relationships>${rel("rId1", "slide", "slides/slide2.xml")}${rel("rId2", "slide", "slides/slide1.xml")}</Relationships>`),
    "ppt/slides/slide1.xml": strToU8(slide(shape("ctrTitle", opts.title ?? "Pricing and the next quarter") + shape("subTitle", "A readout"))),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(`<Relationships>${rel("rId1", "notesSlide", "../notesSlides/notesSlide1.xml")}</Relationships>`),
    "ppt/notesSlides/notesSlide1.xml": strToU8(slide(shape("body", opts.notes ?? "Say the numbers slowly."))),
    "ppt/slides/slide2.xml": strToU8(slide(shape("title", "What we heard") + shape("body", "Crews plan on Friday"))),
    "ppt/theme/theme1.xml": strToU8(`<a:theme xmlns:a="a"><a:themeElements><a:clrScheme><a:dk2><a:srgbClr val="23395B"/></a:dk2><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`),
    ...(opts.thumbnail ? { "docProps/thumbnail.jpeg": opts.thumbnail } : {}),
  });
}
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("an attachment's picture", () => {
  it("is made from an image, listed with two addresses that serve a small WebP, and costs no sign-in or call", async () => {
    const id = await attach("whiteboard.jpg", await photo(4000, 3000));
    const r = await listed(id);
    const pic = r.attachments[0]!.picture!;
    expect(pic.made_from).toBe("image");
    expect(pic.width).toBe(1600);
    expect(pic.height).toBe(1200);
    const thumb = await fetch(`${h.baseUrl}${pic.thumb_url as string}`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect(thumb.headers.get("x-content-type-options")).toBe("nosniff");
    expect(thumb.headers.get("cache-control")).toMatch(/^private, max-age=\d+, immutable$/);
    const size = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect([size.width, size.height]).toEqual([240, 180]);
    expect((await fetch(`${h.baseUrl}${pic.preview_url as string}`)).status).toBe(200);
  });

  it("keeps the same address through the hour, so a browser's copy is used again", async () => {
    const id = await attach("again.jpg", await photo(800, 600));
    const a = (await listed(id)).attachments[0]!.picture!.thumb_url;
    const b = (await listed(id)).attachments[0]!.picture!.thumb_url;
    expect(a).toBe(b);
  });

  it("refuses an address it did not give, or one for anything but a picture", async () => {
    const pic = (await listed(await attach("real.jpg", await photo(300, 200)))).attachments[0]!.picture!;
    const url = pic.thumb_url as string;
    expect((await fetch(`${h.baseUrl}${url.slice(0, -2)}xx`)).status).toBe(401);
    const forged = h.ports.grants.sign({ v: 1, purpose: "picture", k: "t/x/r/y/d/z/text.md", exp: Math.floor(Date.now() / 1000) + 60 });
    expect((await fetch(`${h.baseUrl}/api/v1/pictures/${forged}`)).status).toBe(401);
    const otherPurpose = h.ports.grants.sign({ v: 1, purpose: "download", k: new URL(`${h.baseUrl}${url}`).pathname, exp: Math.floor(Date.now() / 1000) + 60 });
    expect((await fetch(`${h.baseUrl}/api/v1/pictures/${otherPurpose}`)).status).toBe(401);
  });

  it("is page one of a PDF, with how many pages it has", async () => {
    const pic = (await listed(await attach("survey.pdf", PDF))).attachments[0]!.picture!;
    expect(pic.made_from).toBe("pdf");
    expect(pic.pages).toBe(1);
    const page = await fetch(`${h.baseUrl}${pic.preview_url as string}`);
    const { channels } = await sharp(Buffer.from(await page.arrayBuffer())).stats();
    // Words drawn on a white page: not one colour.
    expect(channels[0]!.stdev).toBeGreaterThan(1);
  });

  it("is made of a scan an older reading recorded as failed, and of nothing whose reading did fail", async () => {
    const remake = async (recordId: string, status: string, detail: string) => {
      await h.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${TENANT_ID}, true)`.execute(trx);
        const v = await trx.selectFrom("file_versions").select("file_version_id").where("record_id", "=", recordId).executeTakeFirstOrThrow();
        await trx.deleteFrom("attachment_pictures").where("file_version_id", "=", v.file_version_id).execute();
        await trx.updateTable("derivations").set({ status, status_detail: detail }).where("file_version_id", "=", v.file_version_id).execute();
        await sql`insert into jobs (tenant_id, kind, payload) values (${TENANT_ID}, 'make_picture', ${JSON.stringify({ record_id: recordId, file_version_id: v.file_version_id, quiet: true })}::jsonb)`.execute(trx);
      });
      await h.worker.drain();
    };
    const scan = await attach("old-scan.pdf", PDF);
    await remake(scan, "failed", "the PDF has no text layer (a scan?); no OCR is performed");
    expect((await listed(scan)).attachments[0]!.picture?.preview_url).toBeTruthy();

    const broken = await attach("really-broken.pdf", PDF);
    await remake(broken, "failed", "Error: this file could not be opened");
    expect((await listed(broken)).attachments[0]!.picture).toBeNull();
  });

  it("uses a deck's own picture when it has one, and keeps a card with its title when that is blank", async () => {
    const shown = await sharp({ create: { width: 256, height: 144, channels: 3, background: "#ffffff" } })
      .composite([{ input: { create: { width: 128, height: 144, channels: 3, background: "#23395b" } } }])
      .jpeg()
      .toBuffer();
    const blank = await sharp({ create: { width: 256, height: 144, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();

    const own = (await listed(await attach("readout.pptx", deck({ thumbnail: shown }), PPTX))).attachments[0]!;
    expect(own.text.status).toBe("ready");
    expect(own.picture!.made_from).toBe("deck");
    expect(own.picture!.thumb_url).toBeTruthy();
    expect(own.picture!.pages).toBe(2);

    const library = (await listed(await attach("generated.pptx", deck({ thumbnail: blank }), PPTX))).attachments[0]!;
    expect(library.picture!.thumb_url).toBeNull();
    expect(library.picture!.card).toEqual({ title: "Pricing and the next quarter", colour: "23395b" });
  });

  it("reads a deck's slides in the order it shows them, with their notes", async () => {
    const id = await attach("order.pptx", deck(), PPTX);
    const r = await listed(id);
    expect(r.first_lines).toContain("Slide 1: Pricing and the next quarter");
    expect(r.first_lines).toContain("Notes: Say the numbers slowly.");
    expect(r.first_lines!.indexOf("Pricing")).toBeLessThan(r.first_lines!.indexOf("What we heard"));
    expect(deckFacts(deck()).slides).toBe(2);
  });

  it("marks a file that cannot be pictured as failed, and the source lists without one", async () => {
    const r = await listed(await attach("broken.jpg", new TextEncoder().encode("this is not a photo")));
    expect(r.attachments[0]!.picture).toBeNull();
  });

  it("refuses a picture past the pixels it will open, without holding it in memory", async () => {
    const r = await listed(await attach("bomb.png", pngOfSize(20_000, 20_000)));
    expect(r.attachments[0]!.picture).toBeNull();
    expect((await alice.api("GET", `${P}/sources?limit=1`)).status).toBe(200);
  });

  it("goes with its source when the source is deleted", async () => {
    const id = await attach("gone.jpg", await photo(300, 200));
    const r = await listed(id);
    const url = r.attachments[0]!.picture!.thumb_url as string;
    expect((await fetch(`${h.baseUrl}${url}`)).status).toBe(200);
    const got = await alice.api("GET", `${P}/sources/${id}`);
    const del = await alice.api("DELETE", `${P}/sources/${id}`, { confirm: "delete permanently", reason: "A test of what goes", expected_etag: got.body.etag });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    await h.worker.drain();
    expect((await fetch(`${h.baseUrl}${url}`)).status).toBe(404);
  });
});

describe("a picture past its limits", () => {
  /** A page whose one stream is millions of lines to draw: light to read, and heavy to draw. */
  const heavy = (lines: number) => {
    const stream = `q 0 0 m ${"100 100 l 200 50 l ".repeat(lines)} S Q`;
    return new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
5 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
trailer << /Root 1 0 R >>
%%EOF
`);
  };

  it("stops at the process's memory limit when a page is too heavy to draw, and the process never passes it by much", async () => {
    const said = vi.spyOn(console, "log");
    const maker = processPictureMaker(PICTURE_LIMITS);
    const made = await maker.make(heavy(1_100_000), "pdf");
    expect(made.status).toBe("failed");
    expect(made.detail).toMatch(/more than the 384 MB of memory/);
    const line = said.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("picture: the process making a picture answered failed"))!;
    expect(line).toBeTruthy();
    const peak = Number(/its peak (\d+) MiB/.exec(line)![1]);
    // What a tick of the watch may let by, on top of the limit. The instance holds 1 GiB.
    expect(peak).toBeLessThan(520);
    said.mockRestore();
  }, 60_000);

  it("gives up after two tries, should a job keep ending the instance, without trying again", async () => {
    const id = await attach("keeps-failing.pdf", PDF);
    let attempts = 0;
    const version = await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${TENANT_ID}, true)`.execute(trx);
      const v = await trx.selectFrom("file_versions").select("file_version_id").where("record_id", "=", id).executeTakeFirstOrThrow();
      await trx.deleteFrom("attachment_pictures").where("file_version_id", "=", v.file_version_id).execute();
      // It has been tried twice already, each ending with the instance.
      await sql`insert into jobs (tenant_id, kind, payload, attempts) values (${TENANT_ID}, 'make_picture', ${JSON.stringify({ record_id: id, file_version_id: v.file_version_id })}::jsonb, ${PICTURE_ATTEMPTS})`.execute(trx);
      return v.file_version_id;
    });
    const maker = h.ports.pictures!;
    const make = vi.spyOn(maker, "make").mockImplementation(async () => {
      attempts++;
      throw new Error("should not be tried");
    });
    await h.worker.drain();
    make.mockRestore();
    expect(attempts).toBe(0);
    const row = await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${TENANT_ID}, true)`.execute(trx);
      return trx.selectFrom("attachment_pictures").select(["status", "detail"]).where("file_version_id", "=", version).executeTakeFirstOrThrow();
    });
    expect(row.status).toBe("failed");
    expect(row.detail).toMatch(/2 attempts/);
    expect((await listed(id)).attachments[0]!.picture).toBeNull();
  });
});

describe("a video's frame", () => {
  const frame = async () => (await sharp({ create: { width: 640, height: 360, channels: 3, background: "#884400" } }).jpeg().toBuffer()).toString("base64");

  it("comes from whoever can write, is made small by the worker, and is kept unless replaced", async () => {
    const id = await attach("walkround.mp4", new Uint8Array(4096), "video/mp4");
    expect((await listed(id)).attachments[0]!.picture).toBeNull();
    const sent = await alice.api("POST", `${P}/sources/${id}/frame`, { path: "walkround.mp4", image_base64: await frame() });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.made).toBe(true);
    await h.worker.drain();
    const pic = (await listed(id)).attachments[0]!.picture!;
    expect(pic.made_from).toBe("frame");
    expect(pic.width).toBe(640);
    expect((await fetch(`${h.baseUrl}${pic.thumb_url as string}`)).status).toBe(200);

    const again = await alice.api("POST", `${P}/sources/${id}/frame`, { path: "walkround.mp4", image_base64: await frame() });
    expect(again.body.made).toBe(false);
    const replaced = await alice.api("POST", `${P}/sources/${id}/frame`, { path: "walkround.mp4", image_base64: await frame(), replace: true });
    expect(replaced.body.made).toBe(true);
    await h.worker.drain();
    const next = (await listed(id)).attachments[0]!.picture!;
    expect(next.thumb_url).not.toBe(pic.thumb_url);
    // The picture it replaced has gone.
    await h.worker.drain();
    expect((await fetch(`${h.baseUrl}${pic.thumb_url as string}`)).status).toBe(404);
  });

  it("keeps the frame it has when the next one cannot be read", async () => {
    const id = await attach("kept.mp4", new Uint8Array(4096), "video/mp4");
    await alice.api("POST", `${P}/sources/${id}/frame`, { path: "kept.mp4", image_base64: await frame() });
    await h.worker.drain();
    const pic = (await listed(id)).attachments[0]!.picture!;
    await alice.api("POST", `${P}/sources/${id}/frame`, { path: "kept.mp4", image_base64: Buffer.from("not a picture").toString("base64"), replace: true });
    await h.worker.drain();
    expect((await listed(id)).attachments[0]!.picture!.thumb_url).toBe(pic.thumb_url);
  });

  it("is taken for an HTML page too, which the worker never draws itself", async () => {
    const id = await attach("report.html", new TextEncoder().encode("<h1>Crew report</h1><p>Crews plan on Friday.</p>"), "text/html");
    expect((await listed(id)).attachments[0]!.picture).toBeNull();
    const sent = await alice.api("POST", `${P}/sources/${id}/frame`, { path: "report.html", image_base64: await frame() });
    expect(sent.body.made).toBe(true);
    await h.worker.drain();
    expect((await listed(id)).attachments[0]!.picture!.thumb_url).toBeTruthy();
  });

  it("refuses what is not a video or a page, and anyone who cannot write", async () => {
    const id = await attach("still.jpg", await photo(300, 200));
    const notVideo = await alice.api("POST", `${P}/sources/${id}/frame`, { path: "still.jpg", image_base64: await frame() });
    expect(notVideo.status).toBe(422);
    expect(notVideo.body.error.code).toBe("not_a_video");
    const stranger = await bob.api("POST", `${P}/sources/${id}/frame`, { path: "still.jpg", image_base64: await frame() });
    expect(stranger.status).toBe(404);
  });
});

describe("a recording's bytes", () => {
  const MiB = 1024 * 1024;

  it("answers in pieces of at most 8 MiB, and counts what each piece holds", async () => {
    const size = 20 * MiB;
    const id = await attach("long.mp4", new Uint8Array(size), "video/mp4");
    const url = `${h.baseUrl}${P}/sources/${id}/attachment?path=long.mp4`;
    const before = await sentToday();
    const first = await fetch(url, { headers: { cookie: alice.cookie, range: "bytes=0-" } });
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe(`bytes 0-${8 * MiB - 1}/${size}`);
    expect(first.headers.get("content-length")).toBe(String(8 * MiB));
    await first.body!.cancel();
    expect((await sentToday()) - before).toBe(8 * MiB);

    const tail = await fetch(url, { headers: { cookie: alice.cookie, range: `bytes=${size - 100}-` } });
    expect(tail.headers.get("content-range")).toBe(`bytes ${size - 100}-${size - 1}/${size}`);
    expect((await tail.arrayBuffer()).byteLength).toBe(100);

    // A narrow probe, as Safari begins, stays narrow; a download is the whole file.
    const probe = await fetch(url, { headers: { cookie: alice.cookie, range: "bytes=0-1" } });
    expect((await probe.arrayBuffer()).byteLength).toBe(2);
    const whole = await fetch(`${url}&download=1`, { headers: { cookie: alice.cookie } });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBe(String(size));
    await whole.body!.cancel();
  });

  it("leaves other files' ranges as they were asked for", async () => {
    const size = 12 * MiB;
    const id = await attach("big.csv", new Uint8Array(size).fill(97));
    const r = await fetch(`${h.baseUrl}${P}/sources/${id}/attachment?path=big.csv`, { headers: { cookie: alice.cookie, range: "bytes=0-" } });
    expect(r.headers.get("content-range")).toBe(`bytes 0-${size - 1}/${size}`);
    await r.body!.cancel();
  });

  async function sentToday(): Promise<number> {
    const r = await alice.api("GET", `/api/v1/tenants/${TENANT}/limits`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.limits.find((l: { key: string }) => l.key === "sent_bytes_per_day").used as number;
  }
});
