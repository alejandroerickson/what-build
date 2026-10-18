import type { DerivationStatus } from "./types.ts";

/**
 * The statuses a file's name, media type and size settle before its bytes are read, the words each
 * status gives, and how a reading made by an earlier version is said now.
 */

export const RECORDING_EXTENSIONS = [
  ".mp3", ".mp4", ".m4a", ".wav", ".mov", ".webm", ".mkv", ".aac", ".flac", ".ogg", ".wma", ".m4v", ".opus",
];

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".svg"];

export function extensionOf(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i).toLowerCase() : "";
}

export function isRecording(fileName: string, mediaType?: string | null): boolean {
  if (mediaType && /^(audio|video)\//.test(mediaType)) return true;
  return RECORDING_EXTENSIONS.includes(extensionOf(fileName));
}

export function isImage(fileName: string, mediaType?: string | null): boolean {
  if (mediaType && /^image\//.test(mediaType)) return true;
  return IMAGE_EXTENSIONS.includes(extensionOf(fileName));
}

/** A recording's detail. */
export const RECORDING_DETAIL = "a recording is stored and playable but has no text; add its transcript as another attachment";

/** An image's detail: WhatBuild reads no words from a picture, and says how an agent gives it its words. */
export const IMAGE_DETAIL =
  'WhatBuild reads no words from an image, as it performs no OCR; an agent that can see it should describe it in the source\'s summary, and write any words it shows as the source\'s text with derived(action="write_text") if search should find them';

/** A PDF with no text layer: its pages are pictures, and it is read as an image is. */
export const SCAN_DETAIL =
  'the PDF has no text layer: its pages are pictures, as a scan\'s are, and WhatBuild performs no OCR; an agent that can see its pages should read them and write the source\'s summary, and its text with derived(action="write_text") if search should find its words';

/** Why no parser reads a file. */
export function unsupportedDetail(fileName: string, mediaType?: string | null): string {
  return isImage(fileName, mediaType) ? IMAGE_DETAIL : `no parser reads ${extensionOf(fileName) || "(no extension)"} files`;
}

/** A file over the parse cap, which is stored but never read. */
export function tooLargeDetail(size: number, capBytes: number): string {
  return `the file is ${size} bytes; files over ${capBytes} bytes are stored but not read`;
}

/**
 * How a file will be read when its name, media type and size already settle it, before its bytes
 * are read: too large past the cap, a recording, or a format no parser reads. Undefined when only
 * reading the bytes can tell. `readable` says whether a parser reads the format.
 */
export function settle(
  file: { name: string; mediaType?: string | null | undefined; size: number },
  capBytes: number,
  readable: boolean,
): { status: DerivationStatus; status_detail: string } | undefined {
  if (file.size > capBytes) return { status: "too_large", status_detail: tooLargeDetail(file.size, capBytes) };
  if (isRecording(file.name, file.mediaType)) return { status: "needs_transcript", status_detail: RECORDING_DETAIL };
  if (!readable) return { status: "unsupported", status_detail: unsupportedDetail(file.name, file.mediaType) };
  return undefined;
}

/** Details earlier versions gave, and the reading each is said as now. */
const RETIRED: Record<string, { status: DerivationStatus; status_detail: string }> = {
  // Before a source's words were one text, a transcript was a source of its own.
  "needs_transcript a recording is stored and playable but has no text; add a transcript as a new source": { status: "needs_transcript", status_detail: RECORDING_DETAIL },
  // A PDF of pictures was once a failure, as if reading it again might help.
  "failed the PDF has no text layer (a scan?); no OCR is performed": { status: "unsupported", status_detail: SCAN_DETAIL },
};

/**
 * A stored reading's status and detail as this version says them. A reading is never rewritten;
 * one made before a status or its words changed (a row a backup or a sandbox's baseline brings back
 * among them) is read as a reading made now would say it.
 */
export function currentReading(status: string, detail: string | null): { status: string; status_detail: string | null } {
  const retired = RETIRED[`${status} ${detail ?? ""}`];
  if (retired) return retired;
  // An image an earlier version said only "no parser reads .png files" of.
  const ext = status === "unsupported" ? /^no parser reads (\.[a-z0-9]+) files$/.exec(detail ?? "")?.[1] : undefined;
  if (ext && IMAGE_EXTENSIONS.includes(ext)) return { status, status_detail: IMAGE_DETAIL };
  return { status, status_detail: detail };
}
