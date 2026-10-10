import { srtParser, vttParser } from "./cues.ts";
import { csvParser } from "./csv.ts";
import { docParser } from "./doc.ts";
import { docxParser } from "./docx.ts";
import { htmlParser } from "./html.ts";
import { bytesReader, recordingDurationMs } from "./media.ts";
import { pdfParser } from "./pdf.ts";
import { markdownParser, plaintextParser } from "./plaintext.ts";
import { assemble, codePointLength, decodeText, headingOutline, speakerOutline } from "./text.ts";
import { DEFAULT_PARSE_CAP_BYTES, type FormatParser, type ParseResult } from "./types.ts";
import { xlsxParser } from "./xlsx.ts";
import { TooLargeError } from "./zip.ts";

export type { Block, DerivationStatus, ParseResult, Segment } from "./types.ts";
export { codePointLength, sliceCodePoints, MAX_SEGMENT_CHARS } from "./text.ts";
export { recordingDurationMs, type ByteReader } from "./media.ts";
export { DEFAULT_PARSE_CAP_BYTES } from "./types.ts";
export { HtmlLimitError, MAX_HTML_DEPTH, parseHtml } from "./html.ts";

export const RECORDING_EXTENSIONS = [
  ".mp3", ".mp4", ".m4a", ".wav", ".mov", ".webm", ".mkv", ".aac", ".flac", ".ogg", ".wma", ".m4v", ".opus",
];

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

export function extensionOf(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i).toLowerCase() : "";
}

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

export function isRecording(fileName: string, mediaType?: string | null): boolean {
  if (mediaType && /^(audio|video)\//.test(mediaType)) return true;
  return RECORDING_EXTENSIONS.includes(extensionOf(fileName));
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
    outline: `- (${detail})\n`,
    duration_ms: null,
    status_detail: detail,
    facts: {},
  };
}

/**
 * Derive passage-addressable text from one file. A pure function of bytes: it never throws for a
 * bad file — every outcome is a status — so the worker can always record what happened.
 */
export async function derive(
  bytes: Uint8Array,
  fileName: string,
  options: { mediaType?: string | null; parseCapBytes?: number } = {},
): Promise<ParseResult> {
  const cap = options.parseCapBytes ?? DEFAULT_PARSE_CAP_BYTES;
  if (bytes.byteLength > cap) {
    return nonReady("too_large", `the file is ${bytes.byteLength} bytes; files over ${cap} bytes are stored but not parsed`);
  }
  if (isRecording(fileName, options.mediaType)) {
    return {
      ...nonReady("needs_transcript", "a recording is stored and playable but has no text; add a transcript as a new source"),
      duration_ms: await recordingDurationMs(bytesReader(bytes), bytes.byteLength),
    };
  }
  const parser = parserFor(fileName, options.mediaType);
  if (!parser) {
    const ext = extensionOf(fileName) || "(no extension)";
    return nonReady("unsupported", `no parser reads ${ext} files`);
  }
  let parsed: Awaited<ReturnType<FormatParser["parse"]>>;
  try {
    parsed = await parser.parse(bytes, fileName, { maxBytes: cap });
  } catch (err) {
    const e = err as Error;
    // A package that unpacks past the cap is too large to parse, as a file over it is.
    if (err instanceof TooLargeError) return nonReady("too_large", e.message, parser.name, parser.version);
    return nonReady("failed", `${e.name ?? "Error"}: ${e.message ?? String(err)}`.slice(0, 200), parser.name, parser.version);
  }
  const { segments, text } = assemble(parsed.blocks);
  const facts = parsed.facts ?? {};
  // Silent loss is the worst failure: a text parse that keeps almost nothing reports `failed`.
  const ext = extensionOf(fileName);
  if (TEXT_LIKE.has(ext)) {
    const sourceChars = codePointLength(decodeText(bytes).replace(/\s+/g, ""));
    const keptChars = codePointLength(segments.map((s) => s.text).join("").replace(/\s+/g, ""));
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
  if (parser === pdfParser && Number(facts["text_layer_chars"] ?? 0) === 0) {
    return {
      ...nonReady("failed", "the PDF has no text layer (a scan?); no OCR is performed", parser.name, parser.version),
      facts,
    };
  }
  const timed = Boolean(parser.timed);
  const duration = timed ? segments.reduce((m, s) => Math.max(m, s.end_ms ?? 0), 0) : null;
  return {
    status: "ready",
    parser: parser.name,
    parser_version: parser.version,
    segments,
    text,
    outline: parsed.outline ?? (timed ? speakerOutline(segments) : headingOutline(segments)),
    duration_ms: timed ? duration : null,
    status_detail: null,
    facts,
  };
}
