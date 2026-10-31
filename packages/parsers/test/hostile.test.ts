import { strToU8, zipSync } from "fflate";
import { constants, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { stripCueMarkup, voiceName } from "../src/cues.ts";
import { DEFAULT_PARSE_CAP_BYTES, derive, MAX_HTML_DEPTH, MAX_PDF_PAGES, MAX_SEGMENTS, parseHtml, toParsedFile, type ParseResult } from "../src/index.ts";
import { formatNumber, formatText, readFormat } from "../src/numfmt.ts";
import { layoutPage, pageBlocks, repeatedLines, type TextRun } from "../src/pdf-layout.ts";
import { atxHeading, MAX_LIST_DEPTH, stripInlineMarkdown } from "../src/plaintext.ts";
import { speakerLine } from "../src/speakers.ts";
import { codePointLength, isSpaceUnit, nonSpaceCodePoints } from "../src/text.ts";
import { makeBlankPdf, makeDocx, makePdf, makePdfOfLines, makePdfOfStreams, makeXlsx, utf8 } from "./fixtures.ts";

// Hostile files: each must end in a status (never a crash or a hang) within bounded time and
// memory. The server parses each file in a process of its own held to a memory and a time limit, so
// even a parse that ran away would end as a failed derivation (apps/server/test/hostile-uploads.test.ts
// and parse-process.test.ts show those limits at work); these tests hold the parsers to bounds of their own, so what stops a
// hostile file is a reason, not a limit. Every hostile file is made here; none is committed.

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

  it("keeps the lines of a paragraph of half a million lines, and bounds a list nested without end", async () => {
    const lines = await measured(utf8("a short line\n".repeat(500_000)), "lines.txt");
    expect(lines.r.status).toBe("ready");
    expect(lines.ms).toBeLessThan(5000);
    expect(lines.r.markdown.startsWith("a short line  \na short line  \n")).toBe(true);
    // Each item one space deeper than the last: laid out no deeper than MAX_LIST_DEPTH.
    const deep = Array.from({ length: 3000 }, (_, i) => `${" ".repeat(i)}- item ${i}`).join("\n");
    const nested = await measured(utf8(deep), "deep.txt");
    expect(nested.r.status).toBe("ready");
    expect(nested.ms).toBeLessThan(2000);
    const indents = nested.r.markdown.split("\n").map((l) => l.length - l.trimStart().length);
    expect(Math.max(...indents)).toBe(2 * (MAX_LIST_DEPTH - 1));
  });

  it("applies number formats of any shape without throwing, in bounded time and length", () => {
    const pieces = ["0", "#", "?", ",", ".", "%", "E+", "e-", '"', '"x"', "[", "]", ";", "@", "y", "mm", "d", "hh", "ss", ".00", "AM/PM", "A/P", "/", "/8", "\\", "_", "*", "[Red]", "[<0]", "[>=1000]", "[h]", "[$€-407]", "[$-F800]", "General", " ", "-", "(", ")", "\u{1F4CA}"];
    const values = [0, -0.5, 1, 1234567.891, -1e-9, 9.99e20, 1e22, 46086.75, -3, Number.NaN];
    const started = performance.now();
    for (const code of randomStrings(pieces, 5000, 24)) {
      const f = readFormat(code);
      for (const v of values) expect((formatNumber(f, v, false) ?? "").length, code).toBeLessThan(1000);
      expect(formatText(f, "text").length).toBeLessThan(1000);
    }
    expect(performance.now() - started).toBeLessThan(3000);
    // The longest code Excel takes, applied to many cells: each cell costs what the code's length does.
    const widest = readFormat(`#,${"0".repeat(120)}.${"0".repeat(120)}%`);
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) formatNumber(widest, i * 1.5, false);
    expect(performance.now() - t0).toBeLessThan(3000);
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

/** Every string over `alphabet` of at most `maxLength` symbols. */
function* allStrings(alphabet: string[], maxLength: number): Generator<string> {
  for (let length = 0; length <= maxLength; length++) {
    for (let n = 0; n < alphabet.length ** length; n++) {
      let s = "";
      for (let i = 0, x = n; i < length; i++, x = Math.floor(x / alphabet.length)) s += alphabet[x % alphabet.length];
      yield s;
    }
  }
}

/** `count` strings of 1 to `maxParts` pieces drawn from `pieces`, the same every run. */
function* randomStrings(pieces: string[], count: number, maxParts: number): Generator<string> {
  let x = 20261010;
  const next = (k: number) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x % k;
  };
  for (let i = 0; i < count; i++) yield Array.from({ length: 1 + next(maxParts) }, () => pieces[next(pieces.length)]).join("");
}

/** The strings among `inputs` where `now` and `before` disagree, at most five. */
function disagreements(inputs: Iterable<string>, now: (s: string) => unknown, before: (s: string) => unknown): string[] {
  const out: string[] = [];
  for (const s of inputs) {
    const a = JSON.stringify(now(s));
    const b = JSON.stringify(before(s));
    if (a !== b && out.push(`${JSON.stringify(s)}: ${a} instead of ${b}`) >= 5) break;
  }
  return out;
}

/** The patterns stripInlineMarkdown replaced, as it applied them. */
function stripInlineMarkdownByPatterns(line: string): string {
  const code: string[] = [];
  let s = line.replace(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g, (_m, _ticks: string, body: string) => {
    code.push(body.trim() || body);
    return `\ue000${code.length - 1}\ue001`;
  });
  s = s
    .replace(/(?<![\p{L}\p{N}\\*])\*\*(?=\S)(.+?)(?<=[^\s\\])\*\*(?![\p{L}\p{N}])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}\\_])__(?=\S)(.+?)(?<=[^\s\\])__(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}\\*])\*(?=[^\s*])(.+?)(?<=[^\s\\*])\*(?![\p{L}\p{N}*])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}\\_])_(?=[^\s_])(.+?)(?<=[^\s\\_])_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1");
  return s.replace(/\ue000(\d+)\ue001/g, (_m, i: string) => code[Number(i)] ?? "");
}

describe("patterns that once backtracked in quadratic time", () => {
  const timed = (f: () => unknown) => {
    const started = performance.now();
    f();
    return performance.now() - started;
  };

  it("strips Markdown emphasis and code spans in linear time, exactly as the old patterns did", async () => {
    // A 64 KB line of any of these took up to a second, and a 256 KB one about sixteen.
    for (const unit of ["*a ", "**a ", "_a ", "__a ", "`", "`a ``"]) {
      const line = unit.repeat(Math.ceil((256 * 1024) / unit.length));
      expect(timed(() => stripInlineMarkdown(line)), JSON.stringify(unit)).toBeLessThan(1000);
    }
    const { r, ms } = await measured(utf8(`${"*a ".repeat(100_000)}\n\n${"`".repeat(200_000)}\n`), "marks.md");
    expect(r.status).toBe("ready");
    expect(ms).toBeLessThan(2000);
    expect(disagreements(allStrings(["*", "_", "`", "a", " ", "\\", "\u2028", "😀"], 6), stripInlineMarkdown, stripInlineMarkdownByPatterns)).toEqual([]);
    const pieces = ["*", "_", "`", "**", "__", "``", "a", "é", "1", " ", "\t", "\\", "\n", "\u2028", "😀", "\ud83d", "\ude00", "\ue000", "0", "\ue001"];
    expect(disagreements(randomStrings(pieces, 20_000, 30), stripInlineMarkdown, stripInlineMarkdownByPatterns)).toEqual([]);
  });

  it("reads a speaker line in linear time, exactly as the old pattern did", () => {
    // Spaces, then a line separator inside the words: a 32 KB line took nearly three seconds.
    const line = `Dana: ${" ".repeat(256 * 1024)}\u2028x\u2028y`;
    expect(timed(() => speakerLine(line))).toBeLessThan(500);
    const OLD = /^([A-Z][\p{L}\p{M}'’.\- ]{0,40}|\[[^\]]{1,40}\]):\s+(.+)$/u;
    const before = (s: string) => {
      const m = OLD.exec(s);
      return m ? [m[1], m[2]] : null;
    };
    expect(disagreements(allStrings(["A", "a", ":", " ", "\u2028", "[", "]", "x"], 6), speakerLine, before)).toEqual([]);
    const pieces = ["A", "Dana", "a", ":", " ", "\t", "\u00a0", "\u2028", "\u2029", "\n", "[", "]", "x", "'", "é", "\ud83d"];
    expect(disagreements(randomStrings(pieces, 20_000, 20), speakerLine, before)).toEqual([]);
  });

  it("strips cue markup and finds the voice in linear time, exactly as the old patterns did", async () => {
    // A 48 KB cue of any of these took from half a second to more than two.
    for (const unit of ["<v ", "<v.a", "<b ", "{\\", "<1:00."]) {
      const cue = unit.repeat(Math.ceil((256 * 1024) / unit.length));
      expect(timed(() => voiceName(cue) ?? stripCueMarkup(cue)), JSON.stringify(unit)).toBeLessThan(500);
    }
    const { r, ms } = await measured(utf8(`WEBVTT\n\n00:00.000 --> 00:01.000\n${"<v ".repeat(300_000)}\n`), "voices.vtt");
    expect(r.status).toBe("ready");
    expect(ms).toBeLessThan(2000);
    const voiceBefore = (s: string) => s.match(/<v(?:\.[^\s>]*)?\s+([^>]+)>/)?.[1] ?? null;
    const stripBefore = (s: string) =>
      s.replace(/\{\\[^}]*\}/g, "").replace(/<\/?(?:v|c|i|b|u|ruby|rt|lang)(?:[.\s][^>]*)?>/g, "").replace(/<\d{1,2}:\d{2}[:.][^>]*>/g, "");
    for (const alphabet of [["<", "v", ".", " ", ">", "a", "\n", "/"], ["<", "1", ":", ".", ">", "x", "{", "\\", "}"]]) {
      expect(disagreements(allStrings(alphabet, 6), voiceName, voiceBefore)).toEqual([]);
      expect(disagreements(allStrings(alphabet, 6), stripCueMarkup, stripBefore)).toEqual([]);
    }
    const pieces = ["<v", "<v.", "<v ", " ", ">", "<", "/", "v", "c", "b", "ruby", "rt", "lang", ".", "\t", "\u00a0", "\n", "x", "{\\", "}", "1", "12", ":", ":0", "<1:00.", "Dana"];
    expect(disagreements(randomStrings(pieces, 20_000, 16), voiceName, voiceBefore)).toEqual([]);
    expect(disagreements(randomStrings(pieces, 20_000, 16), stripCueMarkup, stripBefore)).toEqual([]);
  });

  it("counts the characters a text-like parse kept without copying them, as the old count did", () => {
    for (let c = 0; c <= 0xffff; c++) expect(isSpaceUnit(c), c.toString(16)).toBe(/\s/.test(String.fromCharCode(c)));
    const pieces = ["a", " ", "\n", "\u00a0", "\u3000", "😀", "\ud83d", "\ude00", "é", "\ufeff"];
    const before = (texts: string[]) => codePointLength(texts.join("").replace(/\s+/g, ""));
    for (const s of randomStrings(pieces, 5_000, 12)) {
      const texts = s.split("a");
      expect(nonSpaceCodePoints(texts), JSON.stringify(s)).toBe(before(texts));
    }
  });
});

describe("files that would make too much", () => {
  it(`marks a PDF of more than ${MAX_PDF_PAGES} pages too large without reading its pages`, async () => {
    // Twenty thousand blank pages in 2 MB took 18 seconds, and a hundred thousand more than five minutes.
    for (const pages of [MAX_PDF_PAGES + 1, 20_000]) {
      const { r, ms } = await measured(makeBlankPdf(pages), "blank.pdf");
      expect(r.status, `${pages} pages`).toBe("too_large");
      expect(r.status_detail).toBe(`the PDF has ${pages} pages; PDFs over ${MAX_PDF_PAGES} pages are stored but not parsed`);
      expect(r.parser_version).toBe("6");
      expect(ms).toBeLessThan(3000);
    }
    expect(await derive(makeBlankPdf(3), "blank.pdf")).toMatchObject({ status: "unsupported", status_detail: expect.stringContaining("no text layer") });
  });

  it(`marks a file that would make more than ${MAX_SEGMENTS} passages too large, in every format that could`, async () => {
    // A 5 MB file of one-letter paragraphs made 1.75 million passages, and a 25 MB one more than a string can hold.
    const many = MAX_SEGMENTS + 50_000;
    for (const [name, text] of [
      ["letters.txt", "a\n\n".repeat(many)],
      ["letters.md", "- a\n".repeat(many)],
      ["letters.html", "<p>a</p>".repeat(many)],
      ["letters.vtt", "WEBVTT\n\n" + "00:00.000 --> 00:01.000\na\n\n".repeat(many)],
    ] as const) {
      const { r, ms } = await measured(utf8(text), name);
      expect(r.status, name).toBe("too_large");
      expect(r.status_detail).toBe(`the file makes more than ${MAX_SEGMENTS} paragraphs; files that make more are stored but not read`);
      expect(ms, name).toBeLessThan(4000);
    }
  });

  it("parses a file of very many headings quickly", async () => {
    const { r, ms } = await measured(utf8("# a\n".repeat(150_000)), "headings.md");
    expect(r.status).toBe("ready");
    expect(r.segments.filter((s) => s.heading_level)).toHaveLength(150_000);
    expect(ms).toBeLessThan(3000);
  });

  it("writes a parse as its readable text, counted in code points", async () => {
    const r = await derive(utf8("# Notes 😀\n\nCrews text the office.\n\nA lone \ud83d half and 𝔘nicode.\n"), "notes.md");
    const stored = toParsedFile(r);
    expect(stored).toMatchObject({ status: "ready", char_count: Array.from(r.markdown).length });
    expect(new TextDecoder().decode(stored.text_md)).toBe(new TextDecoder().decode(new TextEncoder().encode(r.markdown)));
    expect(toParsedFile({ ...r, segments: [], text: "", markdown: "" })).toMatchObject({ char_count: 0, text_md: new Uint8Array(0) });
  });
});

describe("PDF pages that would take long to lay out", () => {
  const run = (text: string, x: number, y: number, order: number, size = 10): TextRun => ({ text, x, y, width: text.length * size * 0.5, size, order, rtl: false });

  it("lays out a line of very many runs, and many lines of cells that never make a table, in bounded time", () => {
    // Two hundred thousand runs on one baseline: more than a function call takes arguments.
    const wide = Array.from({ length: 200_000 }, (_, i) => run("a", i * 6, 700, i));
    let started = performance.now();
    expect(layoutPage(wide, [], 0, 792).lines).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(3000);
    // Ten thousand lines of three cells, one under the next, set where no column lines up: a
    // table is looked for under each, and the search stops at the page's budget.
    const rows = Array.from({ length: 10_000 }, (_, i) => [0, 1, 2].map((j) => run("cell", 72 + j * 120 + ((i * 37 + j * 11) % 23), 130_000 - i * 12, i * 3 + j))).flat();
    started = performance.now();
    const page = layoutPage(rows, [], 0, 130_100);
    expect(page.lines).toHaveLength(10_000);
    expect(page.lines.some((l) => l.table)).toBe(false);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("reads a page of very many short lines, a paragraph each, in time linear in them", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => run("Short line", 72, 10_000_000 - i * 12, i));
    const timed = (n: number) => {
      const page = layoutPage(lines(n), [], 0, 10_000_100);
      const started = performance.now();
      const { blocks } = pageBlocks(page, 1, new Map());
      expect(blocks).toHaveLength(n);
      return performance.now() - started;
    };
    expect(timed(100_000)).toBeLessThan(6000);
  }, 60_000);

  it("gives up a line of more cells than any table has columns at once", () => {
    // Set apart by a cell's gap, fitting them to columns would cost the square of their number.
    const wide = Array.from({ length: 200_000 }, (_, i) => run("ab", i * 16, 700, i));
    const started = performance.now();
    expect(layoutPage(wide, [], 0, 792).lines.some((l) => l.table)).toBe(false);
    expect(performance.now() - started).toBeLessThan(6000);
  }, 60_000);

  it("stops looking for tables set tight at the page's budget, whatever the lines hold", () => {
    const y = (i: number) => 1_000_000 - i * 12;
    const timed = (name: string, runs: TextRun[], lines: number) => {
      const started = performance.now();
      expect(layoutPage(runs, [], 0, 1_000_100).lines, name).toHaveLength(lines);
      expect(performance.now() - started, name).toBeLessThan(6000);
    };
    // Numbers in one run, every row a table's until a row that is not.
    timed("numbers", Array.from({ length: 40_000 }, (_, i) => run("11.25 12.00 15.50 13.75 14.25", 72, y(i), i)), 40_000);
    // The most runs a row may have, never standing in the same columns.
    timed("runs", Array.from({ length: 1500 }, (_, i) => Array.from({ length: 96 }, (_, j) => run("ab", 72 + j * 13 + (i % 7), y(i), i * 96 + j))).flat(), 1500);
    // Too many words to be a row, and numbers among them: read as lines.
    timed("words", Array.from({ length: 3000 }, (_, i) => run(Array.from({ length: 400 }, () => "1").join(" "), 72, y(i), i)), 3000);
    // Rows that read as prose only once their columns are found, again and again.
    timed("prose", Array.from({ length: 40_000 }, (_, i) => [run("the crew", 72, y(i), i * 2), run("went home and left 12", 130, y(i), i * 2 + 1)]).flat(), 40_000);
  }, 120_000);

  it("reads a file of more short lines than a reading may hold paragraphs as it reads text that runs on, not as too large", async () => {
    const { r } = await measured(makePdfOfLines(MAX_SEGMENTS + 5000, "Short"), "lines.pdf");
    expect(r.status).toBe("ready");
    expect(r.segments.length).toBeLessThan(5000);
    const fewer = await derive(makePdfOfLines(30_000, "Short"), "lines.pdf");
    expect(fewer.segments).toHaveLength(30_001);
  }, 120_000);

  it("counts the pieces a long paragraph is split into, so a file just under the limit in blocks still reads", async () => {
    // Short lines just under the limit, and a page of long lines with no full stop that split into more than the rest.
    const short = 199_900;
    const leading = 780 / short;
    const shortLines = `BT /F1 ${(leading * 0.6).toFixed(6)} Tf 72 785 Td ${leading.toFixed(6)} TL\n${"(Short) Tj T* ".repeat(short)}ET`;
    const longLines = `BT /F1 0.05 Tf 10 700 Td 1 TL\n${`(${"word ".repeat(4000)}) Tj T* `.repeat(40)}ET`;
    const { r } = await measured(makePdfOfStreams([shortLines, longLines]), "lines.pdf");
    expect(r.status).toBe("ready");
    // Every word of the long page is kept, read with the short lines to the sentences' ends.
    expect(r.segments.length).toBeLessThan(5000);
    expect(r.segments.map((g) => g.text).join(" ").match(/word/g)).toHaveLength(160_000);
  }, 120_000);

  it("compares lines repeated up the margin in time linear in their length", () => {
    const pages = [1, 2, 3].map(() => layoutPage([run("The text of the page.", 72, 400, 0)], [[run("9".repeat(200_000), 580, 300, 1)]], 0, 792));
    const started = performance.now();
    expect(repeatedLines(pages).said).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
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
