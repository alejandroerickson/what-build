import { strToU8, zipSync } from "fflate";
import { constants, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DEFAULT_PARSE_CAP_BYTES, derive, MAX_HTML_DEPTH, parseHtml, type ParseResult } from "../src/index.ts";
import { atxHeading } from "../src/plaintext.ts";
import { makeDocx, makePdf, makeXlsx, utf8 } from "./fixtures.ts";

// Hostile files: each must end in a status (never a crash or a hang) within bounded time and
// memory. The worker parses in the server's own process, so a file that stalls the parse stalls
// the server, and one that exhausts its memory takes it down. Every hostile file is made here;
// none is committed.

const MiB = 1024 * 1024;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

interface Entry {
  name: string;
  data: Uint8Array;
  /** 8 for DEFLATE (the data is already deflated), 0 to store; anything else is refused. */
  method?: number;
  /** The unpacked size the package claims, true or not. */
  declared?: number;
  flags?: number;
}

/** A ZIP package built by hand, so a test can claim whatever sizes it likes. */
function zip(entries: Entry[]): Uint8Array {
  const u16 = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return b;
  };
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const method = e.method ?? 8;
    const declared = e.declared ?? e.data.length;
    const head = [u16(20), u16(e.flags ?? 0), u16(method), u16(0), u16(0), u32(0), u32(e.data.length), u32(declared), u16(name.length), u16(0)];
    const local = Buffer.concat([u32(0x04034b50), ...head, name, e.data]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), ...head, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.length;
  }
  const dir = Buffer.concat(central);
  return new Uint8Array(Buffer.concat([...locals, dir, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(dir.length), u32(offset), u16(0)]));
}

/**
 * DEFLATE data that inflates to `mib` MiB of `fill`, built by repeating one compressed MiB, so
 * neither the test nor the file ever holds the expanded bytes: about 1 KB on disk for each MiB.
 */
function bomb(mib: number, fill = 0x20): Uint8Array {
  const chunk = deflateRawSync(Buffer.alloc(MiB, fill), { level: 9, finishFlush: constants.Z_SYNC_FLUSH });
  return new Uint8Array(Buffer.concat([...Array<Buffer>(mib).fill(chunk), Buffer.from([0x03, 0x00])]));
}

const deflated = (text: string) => new Uint8Array(deflateRawSync(Buffer.from(text)));
const docxWith = (document: string) => zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(document) });
const xlsxParts = (parts: Record<string, string>) =>
  zipSync({
    "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'),
    ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])),
  });

/** Parse, and measure how long it took and how much the process grew while it ran. */
async function measured(bytes: Uint8Array, name: string, options?: Parameters<typeof derive>[2]): Promise<{ r: ParseResult; ms: number; grewMiB: number }> {
  const rss = process.memoryUsage().rss;
  const started = performance.now();
  const r = await derive(bytes, name, options);
  return { r, ms: performance.now() - started, grewMiB: (process.memoryUsage().rss - rss) / MiB };
}

const BILLION_LAUGHS =
  '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">' +
  Array.from({ length: 8 }, (_, i) => `<!ENTITY lol${i + 2} "${`&lol${i ? i + 1 : ""};`.repeat(10)}">`).join("") +
  "]>";

describe("zip bombs", () => {
  it("stops unpacking a DOCX at the parse cap, whatever sizes it declares", async () => {
    // 1 MB on disk, 1 GiB unpacked: refused when the declared size says so, and when it lies.
    for (const declared of [1024 * MiB, 100, 0, 0xffffffff]) {
      const { r, ms, grewMiB } = await measured(zip([{ name: "word/document.xml", data: bomb(1024), declared }]), "bomb.docx");
      expect(r.status, `declared ${declared}`).toBe("too_large");
      expect(r.status_detail).toContain(`unpacks to more than ${DEFAULT_PARSE_CAP_BYTES} bytes`);
      expect(ms).toBeLessThan(5000);
      expect(grewMiB).toBeLessThan(400);
    }
  });

  it("counts every part a parser reads against one budget, not each on its own", async () => {
    // Forty worksheets of 1 MiB each: none is over the cap, together they are.
    const sheets = Array.from({ length: 40 }, (_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: bomb(1) }));
    const workbook = { name: "xl/workbook.xml", data: deflated('<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>') };
    const small = await measured(zip([workbook, ...sheets.slice(0, 2)]), "sheets.xlsx", { parseCapBytes: 4 * MiB });
    expect(small.r.status).not.toBe("too_large");
    const many = await measured(zip([workbook, ...sheets]), "sheets.xlsx", { parseCapBytes: 4 * MiB });
    expect(many.r.status).toBe("too_large");
    expect(many.ms).toBeLessThan(5000);
  });

  it("refuses a shared-strings bomb in an XLSX, and a DOCX bomb saved as .doc", async () => {
    const strings = await measured(zip([{ name: "xl/workbook.xml", data: deflated("<workbook/>") }, { name: "xl/sharedStrings.xml", data: bomb(512), declared: 10 }]), "strings.xlsx");
    expect(strings.r.status).toBe("too_large");
    expect(strings.grewMiB).toBeLessThan(400);
    const asDoc = await measured(zip([{ name: "word/document.xml", data: bomb(512) }]), "bomb.doc");
    expect(asDoc.r.status).toBe("too_large");
    expect(asDoc.r.parser).toBe("doc");
  });

  it("never unpacks a package no parser reads", async () => {
    const { r, ms } = await measured(zip([{ name: "ppt/slides/slide1.xml", data: bomb(512) }]), "deck.pptx");
    expect(r.status).toBe("unsupported");
    expect(ms).toBeLessThan(1000);
  });

  it("still reads ordinary packages, stored or deflated", async () => {
    expect((await derive(makeDocx(), "a.docx")).status).toBe("ready");
    expect((await derive(makeXlsx(), "a.xlsx")).status).toBe("ready");
    const stored = zip([{ name: "word/document.xml", data: strToU8(`<w:document ${W}><w:body><w:p><w:r><w:t>Stored part.</w:t></w:r></w:p></w:body></w:document>`), method: 0 }]);
    expect((await derive(stored, "stored.docx")).text).toContain("Stored part.");
  });
});

describe("malformed packages", () => {
  const failed = async (bytes: Uint8Array, name: string) => {
    const { r, ms } = await measured(bytes, name);
    expect(r.status, `${name}: ${r.status_detail}`).toBe("failed");
    expect(ms).toBeLessThan(2000);
    return r.status_detail ?? "";
  };
  const document = deflated(`<w:document ${W}><w:body><w:p><w:r><w:t>Hello.</w:t></w:r></w:p></w:body></w:document>`);

  it("fails truncated, garbled and lying packages with a reason", async () => {
    const good = zip([{ name: "word/document.xml", data: document }]);
    expect(await failed(good.slice(0, 60), "cut.docx")).toContain("invalid zip data");
    expect(await failed(good.slice(0, good.length - 30), "cut.docx")).toContain("invalid zip data");
    expect(await failed(utf8("PK\u0003\u0004 not really a zip at all"), "fake.xlsx")).toContain("invalid zip data");
    expect(await failed(new Uint8Array(4096).map((_, i) => (i * 2654435761) >>> 24), "noise.docx")).toBeTruthy();
    // Compressed data that ends early.
    expect(await failed(zip([{ name: "word/document.xml", data: document.slice(0, 10) }]), "short.docx")).toBeTruthy();
    // A directory that points past the end of the file.
    const pointsOut = zip([{ name: "word/document.xml", data: document }]);
    new DataView(pointsOut.buffer).setUint32(pointsOut.length - 6, 0x7fffffff, true);
    expect(await failed(pointsOut, "out.docx")).toContain("invalid zip data");
    expect(await failed(zip([{ name: "word/document.xml", data: document, method: 99 }]), "odd.docx")).toContain("compression");
    expect(await failed(zip([{ name: "word/document.xml", data: document, flags: 1 }]), "locked.docx")).toContain("encrypted");
    expect(await failed(zip([{ name: "word/document.xml", data: deflated("this is not XML <<<") }]), "text.docx")).toBeTruthy();
    expect(await failed(zip([{ name: "xl/styles.xml", data: document }]), "nobook.xlsx")).toContain("workbook.xml is missing");
  });

  it("fails PDFs that are noise, cut short or nested without end", async () => {
    expect(await failed(new Uint8Array(1 << 16).map((_, i) => (i * 2654435761) >>> 24), "noise.pdf")).toBeTruthy();
    const pdf = makePdf(["A line of text."]);
    expect(["failed", "ready"]).toContain((await derive(pdf.slice(0, pdf.length / 2), "cut.pdf")).status);
    expect(await failed(utf8(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /X ${"[".repeat(100_000)} >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`), "deep.pdf")).toBeTruthy();
  });
});

describe("XML entities", () => {
  it("never expands entities: billion laughs fails at once, in a DOCX and in an XLSX", async () => {
    const docx = await measured(docxWith(`${BILLION_LAUGHS}<w:document ${W}><w:body><w:p><w:r><w:t>&lol9;</w:t></w:r></w:p></w:body></w:document>`), "laughs.docx");
    expect(docx.r.status).toBe("failed");
    expect(docx.r.status_detail).toContain("undefined entity");
    expect(docx.ms).toBeLessThan(1000);
    const xlsx = await measured(xlsxParts({ "xl/sharedStrings.xml": `${BILLION_LAUGHS}<sst><si><t>&lol9;</t></si></sst>` }), "laughs.xlsx");
    expect(xlsx.r.status).toBe("failed");
    expect(xlsx.r.text).not.toContain("lol");
  });

  it("never resolves an external entity, to a file or to a URL", async () => {
    for (const system of ["file:///etc/passwd", "http://127.0.0.1:9/secret", "https://example.com/secret.xml"]) {
      const r = await derive(docxWith(`<?xml version="1.0"?><!DOCTYPE d [<!ENTITY xxe SYSTEM "${system}">]><w:document ${W}><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>`), "xxe.docx");
      expect(r.status, system).toBe("failed");
      expect(r.text).toBe("");
    }
    // A parameter entity is ignored, not fetched: the document reads as if it were absent.
    const param = await derive(docxWith(`<?xml version="1.0"?><!DOCTYPE d [<!ENTITY % p SYSTEM "file:///etc/passwd"> %p;]><w:document ${W}><w:body><w:p><w:r><w:t>Only this.</w:t></w:r></w:p></w:body></w:document>`), "param.docx");
    expect(param.text).toBe("Only this.\n");
  });
});

describe("deep nesting", () => {
  it("fails an XML part nested two hundred thousand deep", async () => {
    const { r, ms } = await measured(docxWith(`<w:document ${W}><w:body><w:p>${"<w:r>".repeat(200_000)}${"</w:r>".repeat(200_000)}</w:p></w:body></w:document>`), "deep.docx");
    expect(r.status).toBe("failed");
    expect(ms).toBeLessThan(3000);
  });

  it(`fails HTML nested more than ${MAX_HTML_DEPTH} deep at once, however it nests`, async () => {
    for (const [what, html] of [
      ["divs", "<div>".repeat(100_000) + "x"],
      ["formatting", Array.from({ length: 40_000 }, (_, i) => `<b class=c${i}>`).join("") + "x"],
      ["templates", "<template>".repeat(20_000) + "x"],
      ["svg", "<svg>" + "<g>".repeat(20_000)],
      ["tables", "<table><tr><td>".repeat(5_000) + "x"],
    ] as const) {
      const { r, ms } = await measured(utf8(html), `${what}.html`);
      expect(r.status, what).toBe("failed");
      expect(r.status_detail, what).toContain(`more than ${MAX_HTML_DEPTH} deep`);
      expect(ms, what).toBeLessThan(2000);
    }
    // The same bound holds where Word's HTML is read as .doc.
    expect((await derive(utf8(`<html><body>${"<div>".repeat(20_000)}x`), "page.doc")).status_detail).toContain("deep");
  });

  it("refuses HTML that makes far more elements than it has tags", async () => {
    // Unclosed formatting elements are re-opened in every block that follows: 500 of them and a
    // few thousand blocks would make millions of elements from 50 KB.
    const html = "<div><p>" + Array.from({ length: 500 }, (_, i) => `<b class=c${i}>`).join("") + "</p></div>" + "<div>x</div>".repeat(4_000);
    const { r, ms, grewMiB } = await measured(utf8(html), "amplified.html");
    expect(r.status).toBe("failed");
    expect(r.status_detail).toContain("elements");
    expect(ms).toBeLessThan(2000);
    expect(grewMiB).toBeLessThan(300);
    expect(() => parseHtml(html)).toThrow(/more than \d+ elements/);
  });

  it("still reads legitimately nested and long pages, in linear time", async () => {
    const nested = await derive(utf8(`${"<div>".repeat(400)}<p>Deep but fine.</p>`), "nested.html");
    expect(nested.text).toContain("Deep but fine.");
    const { r, ms } = await measured(utf8("<p>" + "<i>x</i>".repeat(200_000)), "long.html");
    expect(r.status).toBe("ready");
    expect(ms).toBeLessThan(3000);
  });
});

describe("patterns that once backtracked", () => {
  it("reads a heading line of long space runs in linear time, exactly as the old pattern did", async () => {
    const line = `# ${" ".repeat(20_000)}a${" ".repeat(20_000)}#x`;
    const { r, ms } = await measured(utf8(line), "spaces.md");
    expect(ms).toBeLessThan(1000);
    expect(r.segments[0]).toMatchObject({ heading_level: 1 });
    expect((await measured(utf8(`# ${"#".repeat(50_000)} x\n`), "hashes.txt")).ms).toBeLessThan(1000);
    // Every short line over a small alphabet reads as the replaced pattern read it.
    const OLD = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
    const alphabet = ["#", " ", "\t", "a", " ", " "];
    for (let length = 0; length <= 6; length++) {
      for (let n = 0; n < alphabet.length ** length; n++) {
        let s = "";
        for (let i = 0, x = n; i < length; i++, x = Math.floor(x / alphabet.length)) s += alphabet[x % alphabet.length];
        const m = OLD.exec(s);
        expect(atxHeading(s), JSON.stringify(s)).toEqual(m ? [m[1], m[2]] : null);
      }
    }
  });

  it("trims long runs of spaces inside a line, an XLSX format of semicolons and a cue of spaces in linear time", async () => {
    expect((await measured(utf8(`a${" ".repeat(200_000)}b\n`), "spaces.txt")).ms).toBeLessThan(1000);
    const styles = `<styleSheet><numFmts><numFmt numFmtId="200" formatCode="${";".repeat(20_000)}"/></numFmts><cellXfs>${'<xf numFmtId="200"/>'.repeat(200)}</cellXfs></styleSheet>`;
    const workbook = xlsxParts({ "xl/styles.xml": styles, "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>1</v></c></row></sheetData></worksheet>' });
    expect((await measured(workbook, "formats.xlsx")).ms).toBeLessThan(2000);
    const cue = await measured(utf8(`WEBVTT\n\n00:00.000 --> 00:01.000\nx${" ".repeat(500_000)}y\n`), "spaces.vtt");
    expect(cue.ms).toBeLessThan(1000);
    expect(cue.r.segments[0]!.text).toBe("x y");
  });
});

describe("oversized files", () => {
  it("marks a file over the cap too large without reading it, in every format", async () => {
    const big = new Uint8Array(DEFAULT_PARSE_CAP_BYTES + 1);
    for (const name of ["a.docx", "a.xlsx", "a.doc", "a.pdf", "a.html", "a.md", "a.csv", "a.vtt"]) {
      const { r, ms } = await measured(big, name);
      expect(r.status, name).toBe("too_large");
      expect(ms, name).toBeLessThan(500);
    }
  });
});
