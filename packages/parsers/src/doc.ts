import { isCompoundFile, readCompoundFile } from "./cfb.ts";
import { docxParser, levelOf, type HeadingStyle } from "./docx.ts";
import { htmlParser } from "./html.ts";
import { looksLikeTranscript, speakerTurn } from "./speakers.ts";
import { tableBlocks } from "./tables.ts";
import type { Block, FormatParser, ParseResult } from "./types.ts";

/**
 * `.doc`: a name several formats are saved under, so the format is read from the leading bytes,
 * never from the name.
 *
 * - **Word binary** (a compound file): Word 97-2003, and Word 6.0 and Word 95 when not fast-saved.
 *   The main document's text is read through the piece table ([MS-DOC]). Each paragraph is a
 *   segment, built-in heading styles (Title, Subtitle, Heading 1-9) are headings at the levels
 *   DOCX gives them, tables are one segment per row with the header repeated, field codes are
 *   dropped and their results kept, and "Name: words" paragraphs are speaker turns in a
 *   transcript. Headers, footnotes and comments are not read.
 * - **A DOCX package** renamed to `.doc`: read by the DOCX parser.
 * - **MIME HTML** (Word's "Web Page" save, wiki Word exports) or **plain HTML** saved as `.doc`:
 *   the HTML is read by the HTML parser.
 *
 * The `doc_format` fact records which one the file was: `word97`, `word6`, `docx`, `mhtml` or
 * `html`.
 */
export const docParser: FormatParser = {
  name: "doc",
  version: "4",
  async parse(bytes, fileName, options) {
    if (isCompoundFile(bytes)) return wordBinary(bytes);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      const r = await docxParser.parse(bytes, fileName, options);
      return { ...r, facts: { doc_format: "docx", ...r.facts } };
    }
    const start = hasUtf8Bom(bytes) ? 3 : 0;
    const head = latin1(bytes.subarray(start, start + SNIFF_BYTES)).trimStart().toLowerCase();
    if (head.startsWith("{\\rtf")) throw new Error("the file is Rich Text Format saved as .doc; save it as DOCX or PDF instead");
    if (/^[a-z-]+:/.test(head) && (head.includes("mime-version:") || /content-type:\s*multipart\/related/.test(head)))
      return html(htmlFromMime(bytes), "mhtml", fileName);
    if (head.startsWith("<")) return html(decodeHtml(bytes), "html", fileName);
    throw new Error("not a Word document: the file is neither a Word binary document, DOCX, nor HTML saved as .doc");
  },
};

/** How far into the file to look for MIME headers or an HTML tag. */
const SNIFF_BYTES = 4096;

async function html(source: string, format: "mhtml" | "html", fileName: string) {
  const r = await htmlParser.parse(new TextEncoder().encode(source), fileName);
  if (!r.blocks.length) throw new Error(`the ${format === "mhtml" ? "web page" : "HTML"} saved as .doc has no readable text`);
  return { ...r, facts: { doc_format: format, ...r.facts } };
}

const hasUtf8Bom = (bytes: Uint8Array) => bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

/** Bytes as a string of the same length, one character per byte. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

/** The labels that name Windows-1252 in the WHATWG Encoding Standard, ASCII and Latin-1 among them. */
const WINDOWS_1252 = /^(?:windows-1252|cp1252|x-cp1252|iso-8859-1|iso8859-1|iso_8859-1|iso-ir-100|latin1|l1|cp819|ibm819|ascii|us-ascii|ansi_x3\.4-1968)$/i;

/**
 * Decode in a named character set, falling back to UTF-8 for a name the platform does not know.
 * Windows-1252, which Word writes, is decoded here: some Node releases decode it as Latin-1.
 */
function decode(bytes: Uint8Array, charset: string | undefined): string {
  if (charset && WINDOWS_1252.test(charset.trim())) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000), (b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b)));
    return s;
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Plain HTML in the character set its `<meta>` declares (Word writes windows-1252), UTF-8 otherwise. */
function decodeHtml(bytes: Uint8Array): string {
  if (hasUtf8Bom(bytes)) return decode(bytes, "utf-8");
  const m = latin1(bytes.subarray(0, SNIFF_BYTES)).match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i);
  return decode(bytes, m?.[1]);
}

// ---------------------------------------------------------------------------------------------
// MIME HTML

interface MimeEntity {
  headers: Map<string, string>;
  body: string;
}

/** Split a MIME entity (as a one-character-per-byte string) into its unfolded headers and its body. */
function mimeEntity(raw: string): MimeEntity {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : "";
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return { headers, body };
}

function param(header: string, name: string): string | undefined {
  const m = header.match(new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  return m?.[1] ?? m?.[2];
}

function transferDecode(body: string, encoding: string): Uint8Array {
  let binary = body;
  if (encoding === "quoted-printable")
    binary = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  else if (encoding === "base64") binary = atob(body.replace(/[^A-Za-z0-9+/]/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first `text/html` part of a MIME HTML file, decoded to a string. */
function htmlFromMime(bytes: Uint8Array): string {
  const find = (entity: MimeEntity, depth: number): string | undefined => {
    const type = entity.headers.get("content-type") ?? "text/plain";
    const base = type.split(";")[0]!.trim().toLowerCase();
    if (base.startsWith("multipart/")) {
      const boundary = param(type, "boundary");
      if (!boundary || depth > 4) return undefined;
      const parts = entity.body.split(new RegExp(`(?:^|\\r?\\n)--${escapeRegExp(boundary)}`));
      for (const part of parts.slice(1)) {
        if (part.startsWith("--")) break;
        const found = find(mimeEntity(part.replace(/^[ \t]*\r?\n/, "")), depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (base !== "text/html") return undefined;
    const encoding = (entity.headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
    return decode(transferDecode(entity.body, encoding), param(type, "charset"));
  };
  const found = find(mimeEntity(latin1(bytes).replace(/^\s+/, "")), 0);
  if (found === undefined) throw new Error("the web page saved as .doc has no HTML part");
  return found;
}

// ---------------------------------------------------------------------------------------------
// Word binary

const WORD97_IDENT = 0xa5ec;
const WORD6_IDENT = 0xa5dc;
/** Word 97 introduced the 16-bit text and the separate table stream read here. */
const WORD97_NFIB = 0xc1;
/** Word 6.0; Word 95 is 0x68. Word 2 and older use another layout. */
const WORD6_NFIB = 0x65;
const F_COMPLEX = 0x0004;
const F_ENCRYPTED = 0x0100;
const F_WHICH_TABLE = 0x0200;
const F_OBFUSCATED = 0x8000;
const COMPRESSED = 0x40000000;
const FC_MASK = 0x3fffffff;
const FKP_BYTES = 512;

// Indexes of the (fc, lcb) pairs read here, the same in Word 6 and in Word 97's FibRgFcLcb97.
const FC_STSHF = 1;
const FC_PLCF_BTE_PAPX = 13;
const FC_CLX = 33;
/** Where Word 6 and Word 95 keep the main text's length and the (fc, lcb) pairs. */
const WORD6_CCP_TEXT = 0x34;
const WORD6_FC_LCB = 0x58;

// Built-in style identifiers (sti) of headings besides Heading 1-9 (sti 1-9).
const STI_TITLE = 62;
const STI_SUBTITLE = 74;

const PARAGRAPH = "\r";
const CELL = "\x07";
const FIELD_BEGIN = 0x13;
const FIELD_SEPARATOR = 0x14;
const FIELD_END = 0x15;
/** Page, section and column breaks inside a paragraph's text, split into separate paragraphs later. */
const BREAK = "\f";

interface Piece {
  cpStart: number;
  cpEnd: number;
  /** Byte offset of the piece's first character in the WordDocument stream. */
  fc: number;
  /** One byte per character (Windows-1252) rather than two (UTF-16). */
  compressed: boolean;
}

interface Paragraph {
  text: string;
  /** The paragraph or cell mark that ends it. */
  mark: string;
  /** Byte offset of that mark in the WordDocument stream, which keys its properties. */
  markFc: number;
}

interface ParagraphProps {
  /** The paragraph's style, an index into the style sheet. */
  istd: number;
  inTable: boolean;
  /** The mark ends a table row rather than a cell. */
  rowEnd: boolean;
}

/** The two layouts read: where the paragraph properties are and how their pages are laid out. */
interface Layout {
  format: "word97" | "word6";
  /** Bytes per page number in the PlcBtePapx. */
  pnBytes: 2 | 4;
  /** Bytes per BxPap entry in a PapxFkp page. */
  bxBytes: 7 | 13;
  /** Word 97 property lists use 2-byte sprms read here for table flags; Word 6 lists are not read. */
  tableFlags: boolean;
}

const WORD97: Layout = { format: "word97", pnBytes: 4, bxBytes: 13, tableFlags: true };
const WORD6: Layout = { format: "word6", pnBytes: 2, bxBytes: 7, tableFlags: false };

/** Windows-1252's characters for bytes 0x80-0x9F; the five it leaves undefined keep their Latin-1 meaning. */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** Little-endian reads that fail with a clear message instead of reading past the end. */
class Bytes {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly what: string;
  constructor(bytes: Uint8Array, what: string) {
    this.bytes = bytes;
    this.what = what;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  check(offset: number, size: number) {
    if (offset < 0 || size < 0 || offset + size > this.bytes.length) throw new Error(`the ${this.what} is truncated`);
  }
  u8(offset: number) {
    this.check(offset, 1);
    return this.bytes[offset]!;
  }
  u16(offset: number) {
    this.check(offset, 2);
    return this.view.getUint16(offset, true);
  }
  u32(offset: number) {
    this.check(offset, 4);
    return this.view.getUint32(offset, true);
  }
  i32(offset: number) {
    this.check(offset, 4);
    return this.view.getInt32(offset, true);
  }
  slice(offset: number, size: number) {
    this.check(offset, size);
    return new Bytes(this.bytes.subarray(offset, offset + size), this.what);
  }
}

function wordBinary(bytes: Uint8Array): { blocks: Block[]; facts: ParseResult["facts"] } {
  const cfb = readCompoundFile(bytes);
  const wordStream = cfb.stream("WordDocument");
  if (!wordStream) throw new Error("the compound file has no WordDocument stream, so it is not a Word document");
  const word = new Bytes(wordStream, "WordDocument stream");
  if (word.bytes.length < 0x40) throw new Error("the WordDocument stream has no valid File Information Block");
  const ident = word.u16(0);
  const nFib = word.u16(2);
  const flags = word.u16(0x0a);
  if (ident !== WORD97_IDENT && ident !== WORD6_IDENT) throw new Error("the WordDocument stream has no valid File Information Block");
  if (nFib < WORD6_NFIB) throw new Error("documents from Word 2 and older are not supported; save it as DOCX");
  if (flags & (F_ENCRYPTED | F_OBFUSCATED)) throw new Error("the document is encrypted (password-protected)");

  let layout: Layout;
  let table: Bytes;
  let ccpText: number;
  let fcLcb: (index: number) => { fc: number; lcb: number };
  if (ident === WORD97_IDENT && nFib >= WORD97_NFIB) {
    layout = WORD97;
    const tableName = flags & F_WHICH_TABLE ? "1Table" : "0Table";
    const tableStream = cfb.stream(tableName);
    if (!tableStream) throw new Error(`the document has no ${tableName} stream`);
    table = new Bytes(tableStream, `${tableName} stream`);
    // The FIB's variable parts: csw 16-bit words, then cslw 32-bit longs, then cbRgFcLcb (fc, lcb) pairs.
    const rgLw = 0x22 + word.u16(0x20) * 2 + 2;
    const cslw = word.u16(rgLw - 2);
    const rgFcLcb = rgLw + cslw * 4 + 2;
    if (cslw < 4 || word.u16(rgFcLcb - 2) <= FC_CLX) throw new Error("the WordDocument stream has no valid File Information Block");
    ccpText = word.i32(rgLw + 12);
    fcLcb = (index) => ({ fc: word.u32(rgFcLcb + index * 8), lcb: word.u32(rgFcLcb + index * 8 + 4) });
  } else {
    // Word 6.0 and Word 95 keep everything in the WordDocument stream, and the text in one run of bytes.
    layout = WORD6;
    if (flags & F_COMPLEX) throw new Error("a fast-saved Word 6 or Word 95 document is not supported; save it again, or as DOCX");
    table = word;
    ccpText = word.i32(WORD6_CCP_TEXT);
    fcLcb = (index) => ({ fc: word.u32(WORD6_FC_LCB + index * 8), lcb: word.u32(WORD6_FC_LCB + index * 8 + 4) });
  }
  // Every character takes at least one byte of the stream, so a longer main text is a malformed count.
  if (ccpText < 0 || ccpText > word.bytes.length) throw new Error("the document's main text length is out of range");

  let pieces: Piece[];
  if (layout === WORD97) {
    const clx = fcLcb(FC_CLX);
    pieces = pieceTable(table.slice(clx.fc, clx.lcb));
  } else {
    pieces = [{ cpStart: 0, cpEnd: ccpText, fc: word.u32(0x18), compressed: true }];
  }
  const paragraphs = mainParagraphs(word, pieces, ccpText);

  // Styles and table flags are read when present; a document without them still yields its text.
  const styles = styleIds(table, fcLcb(FC_STSHF));
  let props: (ParagraphProps | undefined)[] = [];
  try {
    const propsAt = paragraphProps(word, table, fcLcb(FC_PLCF_BTE_PAPX), layout);
    if (propsAt) props = paragraphs.map((p) => propsAt(p.markFc));
  } catch {
    props = [];
  }
  // Table flags are trusted only when every paragraph has them and every cell mark is in a table.
  const tableFlags =
    layout.tableFlags &&
    paragraphs.length > 0 &&
    paragraphs.every((p, i) => props[i] !== undefined && (p.mark !== CELL || props[i]!.inTable));
  const { blocks, tables, turns } = toBlocks(paragraphs, props, tableFlags, styles);
  return { blocks, facts: { doc_format: layout.format, table_count: tables, ...(turns ? { transcript_turns: turns } : {}) } };
}

/** The pieces of the CLX: which stream bytes hold each run of characters, and how they are encoded. */
function pieceTable(clx: Bytes): Piece[] {
  let at = 0;
  // Skip the property modifiers (Prc) that precede the piece table.
  while (at < clx.bytes.length && clx.u8(at) === 0x01) at += 3 + clx.u16(at + 1);
  if (at >= clx.bytes.length || clx.u8(at) !== 0x02) throw new Error("the document has no piece table");
  const size = clx.u32(at + 1);
  const plc = clx.slice(at + 5, Math.min(size, clx.bytes.length - at - 5));
  const count = Math.floor((plc.bytes.length - 4) / 12);
  if (count <= 0) return [];
  const cps = Array.from({ length: count + 1 }, (_, i) => plc.u32(i * 4));
  // Pieces must tile the text from character 0 in order; overlapping pieces would let a small file
  // repeat the same bytes into unbounded text.
  if (cps[0] !== 0 || cps.some((cp, i) => i > 0 && cp <= cps[i - 1]!)) throw new Error("the document's piece table is malformed");
  const descriptors = (count + 1) * 4;
  return Array.from({ length: count }, (_, i) => {
    const raw = plc.u32(descriptors + i * 8 + 2);
    const compressed = (raw & COMPRESSED) !== 0;
    return { cpStart: cps[i]!, cpEnd: cps[i + 1]!, fc: compressed ? (raw & FC_MASK) / 2 : raw & FC_MASK, compressed };
  });
}

/**
 * The main document's paragraphs, in the view a reader sees: field results kept and field codes
 * dropped, line breaks and tabs as spaces, the non-breaking hyphen and space in their plain forms,
 * and object anchors (pictures, footnote and comment references) and soft hyphens removed.
 */
function mainParagraphs(word: Bytes, pieces: Piece[], ccpText: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  /** One entry per open field: true once its displayed result has begun. */
  const fields: boolean[] = [];
  /** How many open fields are still in their code, which hides the text. */
  let inCode = 0;
  let buf = "";
  for (const piece of pieces) {
    if (piece.cpStart >= ccpText) break;
    const count = Math.min(piece.cpEnd, ccpText) - piece.cpStart;
    const width = piece.compressed ? 1 : 2;
    if (piece.fc + count * width > word.bytes.length) throw new Error("a piece of the document's text lies outside the WordDocument stream");
    for (let i = 0; i < count; i++) {
      const fc = piece.fc + i * width;
      let code = piece.compressed ? word.bytes[fc]! : word.view.getUint16(fc, true);
      if (piece.compressed && code >= 0x80 && code <= 0x9f) code = CP1252_HIGH[code - 0x80]!;
      if (code === FIELD_BEGIN) {
        fields.push(false);
        inCode++;
      } else if (code === FIELD_SEPARATOR) {
        if (fields.length && !fields[fields.length - 1]) {
          fields[fields.length - 1] = true;
          inCode--;
        }
      } else if (code === FIELD_END) {
        if (fields.length && !fields.pop()) inCode--;
      } else if (inCode === 0) {
        if (code === 0x0d || code === 0x07) {
          paragraphs.push({ text: buf, mark: String.fromCharCode(code), markFc: fc });
          buf = "";
        } else if (code === 0x0c || code === 0x0e) buf += BREAK;
        else if (code === 0x09 || code === 0x0b || code === 0xa0) buf += " ";
        else if (code === 0x1e) buf += "-";
        else if (code >= 0x20) buf += String.fromCharCode(code);
      }
    }
  }
  if (buf) paragraphs.push({ text: buf, mark: PARAGRAPH, markFc: -1 });
  return paragraphs;
}

/** The index of the range `[list[i], list[i + 1])` holding `x`, or -1. */
function rangeOf(list: number[], x: number): number {
  let lo = 0;
  let hi = list.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (x < list[mid]!) hi = mid - 1;
    else if (x >= list[mid + 1]!) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * A lookup from a paragraph mark's stream offset to the paragraph's style and table flags, read
 * from the paragraph property pages (the PlcBtePapx and its PapxFkp pages). Undefined when the
 * document has none.
 */
function paragraphProps(word: Bytes, table: Bytes, { fc, lcb }: { fc: number; lcb: number }, layout: Layout) {
  const entry = 4 + layout.pnBytes;
  if (lcb < 4 + entry) return undefined;
  const plc = table.slice(fc, lcb);
  const n = Math.floor((lcb - 4) / entry);
  const fcs = Array.from({ length: n + 1 }, (_, i) => plc.u32(i * 4));
  const pages = Array.from({ length: n }, (_, i) =>
    layout.pnBytes === 4 ? plc.u32((n + 1) * 4 + i * 4) & 0x3fffff : plc.u16((n + 1) * 4 + i * 2),
  );
  const pageCache = new Map<number, { fcs: number[]; bx: number[]; page: Bytes }>();
  const page = (pn: number) => {
    let p = pageCache.get(pn);
    if (!p) {
      const bytes = word.slice(pn * FKP_BYTES, FKP_BYTES);
      const crun = bytes.u8(FKP_BYTES - 1);
      p = {
        page: bytes,
        fcs: Array.from({ length: crun + 1 }, (_, i) => bytes.u32(i * 4)),
        bx: Array.from({ length: crun }, (_, i) => bytes.u8((crun + 1) * 4 + i * layout.bxBytes)),
      };
      pageCache.set(pn, p);
    }
    return p;
  };
  return (markFc: number): ParagraphProps | undefined => {
    const i = rangeOf(fcs, markFc);
    if (i < 0) return undefined;
    const p = page(pages[i]!);
    const j = rangeOf(p.fcs, markFc);
    if (j < 0) return undefined;
    const props: ParagraphProps = { istd: 0, inTable: false, rowEnd: false };
    const offset = p.bx[j]! * 2;
    if (offset === 0) return props;
    // Word 97: a count of 16-bit words less one byte, or 0 and the word count in the next byte. Word 6: a word count.
    const cb = p.page.u8(offset);
    const start = layout === WORD97 && cb === 0 ? offset + 2 : offset + 1;
    const size = layout === WORD6 ? 2 * cb : cb ? 2 * cb - 1 : 2 * p.page.u8(offset + 1);
    if (size < 2) return props;
    const papx = p.page.slice(start, Math.min(size, FKP_BYTES - start));
    props.istd = papx.u16(0);
    if (layout.tableFlags) {
      for (const [sprm, at] of sprms(papx, 2)) {
        if (sprm === 0x2416) props.inTable ||= papx.u8(at) !== 0; // sprmPFInTable
        else if (sprm === 0x2417) props.rowEnd = papx.u8(at) !== 0; // sprmPFTtp
        else if (sprm === 0x6649) props.inTable ||= papx.u32(at) > 0; // sprmPItap
        else if (sprm === 0x4600) props.istd = papx.u16(at); // sprmPIstd
      }
    }
    return props;
  };
}

/** The (sprm, operand offset) pairs of a Word 97 property list from `start`; stops at a truncated entry. */
function* sprms(list: Bytes, start: number): Generator<[number, number]> {
  let at = start;
  while (at + 2 <= list.bytes.length) {
    const sprm = list.u16(at);
    const operand = at + 2;
    let size: number;
    switch (sprm >> 13) {
      case 0:
      case 1:
        size = 1;
        break;
      case 2:
      case 4:
      case 5:
        size = 2;
        break;
      case 3:
        size = 4;
        break;
      case 7:
        size = 3;
        break;
      default:
        if (operand >= list.bytes.length) return;
        if (sprm === 0xd608) size = list.u16(operand) + 1; // sprmTDefTable: a 2-byte count, plus one
        else if (sprm === 0xc615 && list.u8(operand) === 255) {
          // sprmPChgTabs in its long form: deleted tabs (4 bytes each), then added tabs (3 bytes each).
          const del = operand + 1;
          if (del >= list.bytes.length) return;
          const add = del + 1 + list.u8(del) * 4;
          if (add >= list.bytes.length) return;
          size = add + 1 + list.u8(add) * 3 - operand;
        } else size = list.u8(operand) + 1;
    }
    if (operand + size > list.bytes.length) return;
    yield [sprm, operand];
    at = operand + size;
  }
}

/** The built-in style identifier (sti) of each style, by style index (istd), from the style sheet. */
function styleIds(table: Bytes, { fc, lcb }: { fc: number; lcb: number }): number[] {
  try {
    if (lcb < 4) return [];
    const stsh = table.slice(fc, lcb);
    const cstd = stsh.u16(2);
    const ids: number[] = [];
    let at = 2 + stsh.u16(0);
    for (let istd = 0; istd < cstd && at + 2 <= stsh.bytes.length; istd++) {
      const cbStd = stsh.u16(at);
      ids.push(cbStd >= 2 ? stsh.u16(at + 2) & 0x0fff : -1);
      at += 2 + cbStd;
    }
    return ids;
  } catch {
    return [];
  }
}

function headingStyle(istd: number, styles: number[]): HeadingStyle | undefined {
  // Style indexes 1-9 are reserved for Heading 1-9, so they hold without a readable style sheet.
  const sti = styles[istd] ?? (istd >= 1 && istd <= 9 ? istd : -1);
  if (sti >= 1 && sti <= 9) return { kind: "heading", n: sti };
  if (sti === STI_TITLE) return { kind: "title" };
  if (sti === STI_SUBTITLE) return { kind: "subtitle" };
  return undefined;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Paragraphs and table rows as blocks. With table flags, a paragraph is in a table when flagged
 * so and a row ends at the mark flagged as the row's end. Without them, a table starts at a cell
 * mark and a row ends at a cell mark that follows another with nothing between; an empty cell
 * looks the same, so the first row fixes the table's width and later rows end once that many
 * cells are read.
 */
function toBlocks(paragraphs: Paragraph[], props: (ParagraphProps | undefined)[], tableFlags: boolean, styles: number[]) {
  const blocks: Block[] = [];
  const headings: { block: Block; style: HeadingStyle }[] = [];
  const body: Block[] = [];
  let rows: string[][] = [];
  let cells: string[] = [];
  let cellText: string[] = [];
  let width: number | undefined;
  let tables = 0;
  let previousMark = "";
  const closeTable = () => {
    const pending = collapse(cellText.join(" "));
    if (pending) cells.push(pending);
    if (cells.length) rows.push(cells);
    if (rows.length) {
      for (const b of tableBlocks(rows)) blocks.push(b);
      tables++;
    }
    rows = [];
    cells = [];
    cellText = [];
    width = undefined;
  };
  paragraphs.forEach((p, i) => {
    const pr = props[i];
    const inTable = tableFlags ? pr!.inTable : p.mark === CELL || cells.length > 0;
    if (inTable) {
      cellText.push(p.text.replaceAll(BREAK, " "));
      if (p.mark === CELL) {
        const pending = collapse(cellText.join(" "));
        const rowEnd = tableFlags
          ? pr!.rowEnd
          : !pending && (width !== undefined ? cells.length >= width : previousMark === CELL && cells.length > 0);
        if (rowEnd) {
          rows.push(cells);
          width = cells.length;
          cells = [];
        } else cells.push(pending);
        cellText = [];
      }
    } else {
      closeTable();
      const style = pr ? headingStyle(pr.istd, styles) : undefined;
      for (const part of p.text.split(BREAK)) {
        const text = collapse(part);
        if (!text) continue;
        const block: Block = { text };
        if (style) headings.push({ block, style });
        else body.push(block);
        blocks.push(block);
      }
    }
    previousMark = p.mark;
  });
  closeTable();
  const hasTitle = headings.some((h) => h.style.kind === "title");
  for (const { block, style } of headings) {
    block.heading_level = levelOf(style, hasTitle);
    block.text = `${"#".repeat(block.heading_level)} ${block.text}`;
  }
  // "Name: words" paragraphs are speaker turns, decided exactly as for DOCX and plain text.
  let turns = 0;
  if (looksLikeTranscript(body.map((b) => b.text))) {
    for (const block of body) {
      const t = speakerTurn(block.text);
      if (!t) continue;
      block.speaker = t.speaker;
      block.text = t.text;
      turns++;
    }
  }
  return { blocks, tables, turns };
}
