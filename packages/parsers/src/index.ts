import { srtParser, vttParser } from "./cues.ts";
import { csvParser } from "./csv.ts";
import { docParser } from "./doc.ts";
import { docxParser } from "./docx.ts";
import { htmlParser } from "./html.ts";
import { bytesReader, recordingDurationMs } from "./media.ts";
import { pdfParser } from "./pdf.ts";
import { renderMarkdown } from "./markdown.ts";
import { markdownParser, plaintextParser } from "./plaintext.ts";
import { extensionOf, SCAN_DETAIL, settle } from "./statuses.ts";
import { assemble, decodeText, nonSpaceCodePoints } from "./text.ts";
import { DEFAULT_PARSE_CAP_BYTES, TooLargeError, type DerivationStatus, type FormatParse, type FormatParser, type ParseResult, type Segment, type TableRef } from "./types.ts";
import { xlsxParser } from "./xlsx.ts";

export type { Block, DerivationStatus, FormatParse, ParsedFile, ParseResult, Segment, TableRef } from "./types.ts";
export { codePointLength, sliceCodePoints, splitLong, MAX_SEGMENT_CHARS, MAX_SEGMENTS, toParsedFile } from "./text.ts";
export { clock, markdownAsIs, renderMarkdown, tableMarkdown, TURN_CHARS } from "./markdown.ts";
export { MAX_PDF_PAGES } from "./pdf.ts";
export { recordingDurationMs, type ByteReader } from "./media.ts";
export { DEFAULT_PARSE_CAP_BYTES, TooLargeError } from "./types.ts";
export { HtmlLimitError, MAX_HTML_DEPTH, parseHtml } from "./html.ts";
export { TooManyEntriesError, unzipParts, zipEntries, type ZipEntry } from "./zip.ts";
export {
  currentReading, extensionOf, IMAGE_DETAIL, IMAGE_EXTENSIONS, isImage, isRecording, RECORDING_DETAIL, RECORDING_EXTENSIONS, SCAN_DETAIL, tooLargeDetail,
} from "./statuses.ts";

const PARSERS: Record<string, FormatParser> = {
  ".vtt": vttParser,
  ".srt": srtParser,
  ".txt": plaintextParser,
  ".text": plaintextParser,
  ".md": markdownParser,
  ".markdown": markdownParser,
  ".html": htmlParser,
  ".htm": htmlParser,
  ".docx": docxParser,
  ".doc": docParser,
  ".pdf": pdfParser,
  ".xlsx": xlsxParser,
  ".csv": csvParser,
  ".tsv": csvParser,
};

/** Formats whose parse should keep most of the decoded characters; used by the silent-loss check. */
const TEXT_LIKE = new Set([".txt", ".text", ".md", ".markdown", ".vtt", ".srt", ".csv", ".tsv"]);

export const SUPPORTED_EXTENSIONS = Object.keys(PARSERS);

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  "text/vtt": ".vtt",
  "application/x-subrip": ".srt",
  "text/markdown": ".md",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/tab-separated-values": ".tsv",
  "text/html": ".html",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

/** Pick the parser by extension, falling back to the media type when the name has no known extension. */
export function parserFor(fileName: string, mediaType?: string | null): FormatParser | undefined {
  const ext = extensionOf(fileName);
  return PARSERS[ext] ?? (mediaType ? PARSERS[MEDIA_TYPE_EXTENSIONS[mediaType.split(";")[0]!.trim()] ?? ""] : undefined);
}

/**
 * How a file will be read when its name, media type and size already say, before its bytes are:
 * `too_large` over the cap, `needs_transcript` for a recording, `unsupported` for a format no parser
 * reads (an image among them). Undefined when only its bytes can tell. `derive` decides by the same
 * rule, so a status said early is the status its reading records.
 */
export function settledReading(
  fileName: string,
  options: { mediaType?: string | null | undefined; size: number; parseCapBytes?: number },
): { status: DerivationStatus; status_detail: string } | undefined {
  const file = { name: fileName, mediaType: options.mediaType, size: options.size };
  return settle(file, options.parseCapBytes ?? DEFAULT_PARSE_CAP_BYTES, Boolean(parserFor(fileName, options.mediaType)));
}

function nonReady(
  status: ParseResult["status"],
  detail: string,
  parser = "none",
  version = "0",
): ParseResult {
  return {
    status,
    parser,
    parser_version: version,
    segments: [],
    text: "",
    markdown: "",
    duration_ms: null,
    status_detail: detail,
    facts: {},
  };
}

/** U+0000, which a Postgres text value cannot hold. */
const NUL = "\u0000";

const withoutNul = (s: string) => (s.includes(NUL) ? s.replaceAll(NUL, "") : s);

/**
 * Drop U+0000 from what a parser read, before it is laid out: from each block's text and speaker,
 * each table's cells and a Markdown file's own text. A text file read as UTF-8 keeps any it holds,
 * and Postgres refuses a text value with one in it, so the reading could not be stored. Returns how
 * many were dropped from the readable text: from a Markdown file's own text, or from its blocks.
 */
function dropNul(parsed: FormatParse): number {
  let dropped = 0;
  const asIs = parsed.markdown !== undefined;
  const strip = (s: string, counts: boolean) => {
    const t = withoutNul(s);
    if (counts) dropped += s.length - t.length;
    return t;
  };
  const tables = new Set<TableRef>();
  for (const b of parsed.blocks) {
    if (b.table && !tables.has(b.table)) {
      tables.add(b.table);
      b.table.header = b.table.header.map((c) => strip(c, !asIs));
      b.table.rows = b.table.rows.map((r) => r.map((c) => strip(c, !asIs)));
    }
    // A table's row repeats its cells, which are counted once, with the table.
    b.text = strip(b.text, !asIs && !b.table);
    if (b.speaker) b.speaker = strip(b.speaker, !asIs);
  }
  if (parsed.markdown !== undefined) parsed.markdown = strip(parsed.markdown, true);
  return dropped;
}

/** A reading's detail and facts without U+0000, which their columns cannot hold either. */
function stored(r: ParseResult): ParseResult {
  if (r.status_detail !== null) r.status_detail = withoutNul(r.status_detail);
  for (const [k, v] of Object.entries(r.facts)) {
    if (typeof v === "string") r.facts[k] = withoutNul(v);
    else if (Array.isArray(v)) r.facts[k] = v.map(withoutNul);
  }
  return r;
}

/**
 * Derive the text of one file: its segments, and the readable Markdown a derivation stores. A pure
 * function of bytes: it never throws for a bad file — every outcome is a status — so the worker can
 * always record what happened. What it may cost in memory and time is bounded where it runs: the
 * server runs it in a child process of its own (apps/server/src/parse-process.ts). Nothing it returns
 * holds U+0000: the facts say how many were dropped (`null_characters_dropped`).
 */
export async function derive(
  bytes: Uint8Array,
  fileName: string,
  options: { mediaType?: string | null; parseCapBytes?: number } = {},
): Promise<ParseResult> {
  return stored(await read(bytes, fileName, options));
}

async function read(bytes: Uint8Array, fileName: string, options: { mediaType?: string | null; parseCapBytes?: number }): Promise<ParseResult> {
  const cap = options.parseCapBytes ?? DEFAULT_PARSE_CAP_BYTES;
  const settled = settledReading(fileName, { mediaType: options.mediaType, size: bytes.byteLength, parseCapBytes: cap });
  if (settled) {
    const r = nonReady(settled.status, settled.status_detail);
    // A recording's playing time is in its container's headers.
    if (settled.status === "needs_transcript") r.duration_ms = await recordingDurationMs(bytesReader(bytes), bytes.byteLength);
    return r;
  }
  const parser = parserFor(fileName, options.mediaType)!;
  let parsed: FormatParse;
  let segments: Segment[];
  let text: string;
  let nul: number;
  try {
    parsed = await parser.parse(bytes, fileName, { maxBytes: cap });
    nul = dropNul(parsed);
    ({ segments, text } = assemble(parsed.blocks));
  } catch (err) {
    const e = err as Error;
    // A package that unpacks past the cap, a PDF of too many pages or a file of too many paragraphs is too large, as a file over the cap is.
    if (err instanceof TooLargeError) return nonReady("too_large", e.message, parser.name, parser.version);
    return nonReady("failed", `${e.name ?? "Error"}: ${e.message ?? String(err)}`.slice(0, 200), parser.name, parser.version);
  }
  const facts = nul ? { ...parsed.facts, null_characters_dropped: nul } : (parsed.facts ?? {});
  // Silent loss is the worst failure: a text parse that keeps almost nothing reports `failed`.
  const ext = extensionOf(fileName);
  if (TEXT_LIKE.has(ext)) {
    const sourceChars = nonSpaceCodePoints([decodeText(bytes)]);
    const keptChars = nonSpaceCodePoints(segments.map((s) => s.text));
    if (sourceChars >= 200 && (keptChars === 0 || keptChars < sourceChars * 0.1)) {
      return {
        ...nonReady("failed", `the parse kept only ${keptChars} of ${sourceChars} characters`, parser.name, parser.version),
        facts,
      };
    }
  }
  if (parser === htmlParser && segments.length === 0) {
    return {
      ...nonReady("failed", "the HTML has no readable text: a page built by scripts, such as a single-page app, keeps its text out of the file; add the page's text as a file instead", parser.name, parser.version),
      facts,
    };
  }
  // A PDF with no text layer is pictures of pages, as a scan is: unread as an image is, not a failure.
  if (parser === pdfParser && Number(facts["text_layer_chars"] ?? 0) === 0) {
    return { ...nonReady("unsupported", SCAN_DETAIL, parser.name, parser.version), facts };
  }
  const timed = Boolean(parser.timed);
  const duration = timed ? segments.reduce((m, s) => Math.max(m, s.end_ms ?? 0), 0) : null;
  return {
    status: "ready",
    parser: parser.name,
    parser_version: parser.version,
    segments,
    text,
    markdown: parsed.markdown ?? renderMarkdown(parsed.blocks),
    duration_ms: timed ? duration : null,
    status_detail: null,
    facts,
  };
}
