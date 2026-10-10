import { strToU8, zipSync } from "fflate";

export const utf8 = (s: string) => new TextEncoder().encode(s);

/** A minimal DOCX with a heading, a paragraph with tracked changes, a table and a comment. */
export function makeDocx(): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Pricing review</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">We export to a spreadsheet </w:t></w:r><w:ins w:id="1" w:author="A"><w:r><w:t>every Friday</w:t></w:r></w:ins><w:del w:id="2" w:author="A"><w:r><w:delText>sometimes</w:delText></w:r></w:del><w:r><w:t>.</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Plan</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Starter</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$10</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:instrText>HYPERLINK "x"</w:instrText></w:r><w:r><w:t>Closing line</w:t></w:r></w:p>
</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles ${W}><w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/></w:style></w:styles>`;
  const comments = `<?xml version="1.0" encoding="UTF-8"?>
<w:comments ${W}><w:comment w:id="0" w:author="Reviewer B"><w:p><w:r><w:t>Check the price.</w:t></w:r></w:p></w:comment></w:comments>`;
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8(styles),
    "word/comments.xml": strToU8(comments),
  });
}

/** A DOCX whose body is the given paragraphs: `{ style }` sets a paragraph style, `{ boldLead }` a bold first run. */
export function makeDocxParagraphs(paras: { text: string; style?: string; boldLead?: string }[]): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = paras
    .map((p) => {
      const pPr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : "";
      const lead = p.boldLead ? `<w:r><w:rPr><w:b/></w:rPr><w:t>${esc(p.boldLead)}</w:t></w:r>` : "";
      return `<w:p>${pPr}${lead}<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`;
    })
    .join("\n");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<w:document ${W}><w:body>${body}</w:body></w:document>`),
  });
}

/** A minimal XLSX with a header row and two data rows. */
export function makeXlsx(): Uint8Array {
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Accounts" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`;
  const shared = `<?xml version="1.0"?><sst><si><t>Account</t></si><si><t>Seats</t></si><si><t>Acme</t></si><si><t>Globex</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>3.5</v></c></row>
</sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
    "xl/sharedStrings.xml": strToU8(shared),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}

/**
 * A one-sheet XLSX from rows of cells: a string is an inline text cell, `[value, style]` a number
 * with a `cellXfs` style index. `numFmts` are custom formats (id 164 up) and `xfs` the number format
 * id of each cell style, written to `xl/styles.xml`.
 */
export function makeXlsxSheet(
  rows: (string | [number, number])[][],
  options: { numFmts?: string[]; xfs?: number[]; date1904?: boolean } = {},
): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const col = (i: number) => String.fromCharCode(65 + i);
  const pr = options.date1904 ? '<workbookPr date1904="1"/>' : "";
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pr}<sheets><sheet name="Register" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`;
  const body = rows
    .map((cells, r) => {
      const xml = cells
        .map((c, i) => {
          const ref = `${col(i)}${r + 1}`;
          if (typeof c === "string") return `<c r="${ref}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`;
          return `<c r="${ref}" s="${c[1]}"><v>${c[0]}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join("\n");
  const numFmts = (options.numFmts ?? []).map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(code)}"/>`).join("");
  const xfs = (options.xfs ?? [0]).map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0"/>`).join("");
  const styles = `<?xml version="1.0"?><styleSheet><numFmts count="${options.numFmts?.length ?? 0}">${numFmts}</numFmts><cellXfs count="1">${xfs}</cellXfs></styleSheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`),
  });
}

/**
 * A DOCX of list paragraphs, with a `word/numbering.xml`: `numId` 1 is a decimal list (`%1.` then
 * `%1.%2.`), 2 a bullet list, and 3 restarts the decimal list at 1. `style` names a paragraph style
 * whose own numbering is list 1.
 */
export function makeDocxList(paras: { text: string; numId?: number; ilvl?: number; style?: string }[]): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const body = paras
    .map((p) => {
      const style = p.style ? `<w:pStyle w:val="${p.style}"/>` : "";
      const num = p.numId ? `<w:numPr><w:ilvl w:val="${p.ilvl ?? 0}"/><w:numId w:val="${p.numId}"/></w:numPr>` : "";
      return `<w:p><w:pPr>${style}${num}</w:pPr><w:r><w:t xml:space="preserve">${p.text}</w:t></w:r></w:p>`;
    })
    .join("\n");
  const lvl = (ilvl: number, fmt: string, text: string) =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/></w:lvl>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="10">${lvl(0, "decimal", "%1.")}${lvl(1, "decimal", "%1.%2.")}</w:abstractNum>
<w:abstractNum w:abstractNumId="20">${lvl(0, "bullet", "\u2022")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="10"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
</w:numbering>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles ${W}><w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>`;
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/numbering.xml": strToU8(numbering),
    "word/styles.xml": strToU8(styles),
  });
}

/** A one-page PDF with a real text layer, written by hand with a correct xref table. */
export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = ["BT", "/F1 12 Tf", "72 720 Td", "14 TL", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return utf8(out);
}

/** A PDF of `pages` blank pages: a few bytes each, so a small file can have very many. */
export function makeBlankPdf(pages: number): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>")];
  const parts = ["%PDF-1.4\n"];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const part = `${i + 1} 0 obj\n${body}\nendobj\n`;
    parts.push(part);
    length += part.length;
  });
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`));
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`);
  return utf8(parts.join(""));
}

// ---- Recordings: container headers only, around silent (zeroed) media data ----------------------

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const chars = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const box = (type: string, body: number[]) => [...be32(8 + body.length), ...chars(type), ...body];

/**
 * An M4A: `ftyp`, then `moov` holding an `mvhd` (version 0 or 1), with a zeroed `mdat` of
 * `mdatBytes` placed before `moov` unless the file is fast-start.
 */
export function makeMp4(o: { timescale: number; duration: number; version?: 0 | 1; fastStart?: boolean; mdatBytes?: number }): Uint8Array {
  const times =
    o.version === 1
      ? [...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(o.timescale), ...be32(Math.floor(o.duration / 2 ** 32)), ...be32(o.duration >>> 0)]
      : [...be32(0), ...be32(0), ...be32(o.timescale), ...be32(o.duration)];
  const moov = box("moov", box("mvhd", [o.version ?? 0, 0, 0, 0, ...times, ...new Array(80).fill(0)]));
  const ftyp = box("ftyp", [...chars("M4A "), ...be32(0), ...chars("M4A isom")]);
  const mdat = new Uint8Array(8 + (o.mdatBytes ?? 64));
  mdat.set([...be32(mdat.byteLength), ...chars("mdat")]);
  const parts = o.fastStart ? [ftyp, moov, mdat] : [ftyp, mdat, moov];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A 16-bit mono PCM WAV with a `LIST` chunk before the audio, `byteRate` bytes per second. */
export function makeWav(dataBytes: number, byteRate: number): Uint8Array {
  const fmt = [...chars("fmt "), ...le32(16), 1, 0, 1, 0, ...le32(byteRate / 2), ...le32(byteRate), 2, 0, 16, 0];
  const list = [...chars("LIST"), ...le32(5), ...chars("INFOx"), 0];
  const data = [...chars("data"), ...le32(dataBytes), ...new Array(dataBytes).fill(0)];
  const body = [...chars("WAVE"), ...fmt, ...list, ...data];
  return new Uint8Array([...chars("RIFF"), ...le32(body.length), ...body]);
}

/** A FLAC whose STREAMINFO block states a sample rate and a total sample count (under 2^32). */
export function makeFlac(sampleRate: number, samples: number): Uint8Array {
  const info = [0, 16, 0, 16, 0, 0, 0, 0, 0, 0, (sampleRate >> 12) & 255, (sampleRate >> 4) & 255, ((sampleRate & 15) << 4) | (1 << 1), 15 << 4, ...be32(samples), ...new Array(16).fill(0)];
  return new Uint8Array([...chars("fLaC"), 0x80, 0, 0, 34, ...info]);
}

/**
 * An MP3 of 128 kbit/s, 44.1 kHz MPEG-1 Layer III frames (417 bytes each) after an ID3v2 tag;
 * with `xingFrames`, a leading Xing frame states that frame count.
 */
export function makeMp3(frames: number, xingFrames?: number): Uint8Array {
  const id3 = [...chars("ID3"), 3, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)];
  const frame = (xing?: number) => {
    const f = new Array(417).fill(0);
    f.splice(0, 4, 0xff, 0xfb, 0x90, 0x00);
    if (xing !== undefined) f.splice(36, 12, ...chars("Xing"), ...be32(1), ...be32(xing));
    return f;
  };
  const out = [...id3];
  if (xingFrames !== undefined) out.push(...frame(xingFrames));
  for (let i = 0; i < frames; i++) out.push(...frame());
  return new Uint8Array(out);
}
