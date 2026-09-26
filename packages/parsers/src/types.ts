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
  outline: string;
  /** Largest cue end for timed sources, else null. */
  duration_ms: number | null;
  /** Human-readable reason when status is not `ready`. */
  status_detail: string | null;
  /** Format-specific facts (table counts, tracked changes, sheet counts, skipped cues). */
  facts: Record<string, number | string | boolean | string[]>;
}

/** A block produced by a format parser before segmentation and offset assignment. */
export interface Block {
  text: string;
  speaker?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
  heading_level?: number;
  page?: number;
}

export interface FormatParser {
  name: string;
  version: string;
  /** Returns blocks plus facts; throws on a malformed file. */
  parse(bytes: Uint8Array, fileName: string): Promise<{ blocks: Block[]; facts?: ParseResult["facts"]; outline?: string }> | { blocks: Block[]; facts?: ParseResult["facts"]; outline?: string };
  timed?: boolean;
}
