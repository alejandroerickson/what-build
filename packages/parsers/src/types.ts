/** One addressable span of derived text. Offsets are half-open Unicode code points into `text`. */
export interface Segment {
  seq: number;
  text: string;
  speaker: string | null;
  start_ms: number | null;
  end_ms: number | null;
  char_start: number;
  char_end: number;
  /** Heading level (1–6) when this segment is a heading. */
  heading_level?: number;
  /** PDF page number (1-based) when the source is paginated. */
  page?: number;
}

export type DerivationStatus =
  | "ready"
  | "needs_transcript"
  | "unsupported"
  | "too_large"
  | "failed";

export interface ParseResult {
  status: DerivationStatus;
  parser: string;
  parser_version: string;
  segments: Segment[];
  /** The full derived text the segment offsets index into. Ends with one newline when non-empty. */
  text: string;
  /**
   * The text as people read it: Markdown, with each speaker and cue time written into it and each
   * table laid out whole. What a derivation stores. Ends with one newline when non-empty.
   */
  markdown: string;
  /** Largest cue end for timed sources, the container's playing time for a recording, else null. */
  duration_ms: number | null;
  /** Human-readable reason when status is not `ready`. */
  status_detail: string | null;
  /** Format-specific facts (table counts, tracked changes, sheet counts, skipped cues). */
  facts: Record<string, number | string | boolean | string[]>;
}

/**
 * A parse as a derivation stores it: what its row records, and the bytes of `text.md`. Bytes
 * rather than a string, so a parse made in a worker thread reaches the server as a buffer handed
 * over without a copy, however long the text is.
 */
export interface ParsedFile {
  status: DerivationStatus;
  parser: string;
  parser_version: string;
  status_detail: string | null;
  duration_ms: number | null;
  facts: ParseResult["facts"];
  /** The length of `text.md` in code points. */
  char_count: number;
  /** `text.md`: the readable Markdown, UTF-8. */
  text_md: Uint8Array;
}

/** A table whose rows are blocks of their own. Its blocks share it, so the readable text lays it out whole. */
export interface TableRef {
  header: string[];
  rows: string[][];
}

/** A block produced by a format parser before segmentation and offset assignment. */
export interface Block {
  text: string;
  speaker?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
  heading_level?: number;
  page?: number;
  /** The table this block is a row of. */
  table?: TableRef;
}

/**
 * Thrown by a parser, or by assembly, when a file is too large to parse in some other way than its
 * size: a package that unpacks past the cap, a PDF with too many pages, too many paragraphs. The file
 * is `too_large`, like a file over the cap.
 */
export class TooLargeError extends Error {
  override name = "TooLargeError";
}

/** Sources over this size are stored but not parsed (`too_large`). Operator-configurable. */
export const DEFAULT_PARSE_CAP_BYTES = 25 * 1024 * 1024;

export interface ParseOptions {
  /**
   * The most bytes a parser may unpack a file into (the parts of a DOCX or XLSX package), which is
   * the parse cap: a file that unpacks to more is `too_large`, like a file that is larger.
   */
  maxBytes?: number;
}

/** What a format parser returns. */
export interface FormatParse {
  blocks: Block[];
  facts?: ParseResult["facts"];
  /** The readable text as it is, for a file that is already Markdown; otherwise it is laid out from the blocks. */
  markdown?: string;
}

export interface FormatParser {
  name: string;
  version: string;
  /**
   * Returns blocks plus facts, and the readable Markdown when the file already is Markdown; throws
   * on a malformed file, and `TooLargeError` past `options.maxBytes`.
   */
  parse(bytes: Uint8Array, fileName: string, options?: ParseOptions): Promise<FormatParse> | FormatParse;
  timed?: boolean;
}
