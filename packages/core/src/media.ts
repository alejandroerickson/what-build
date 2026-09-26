const BY_EXTENSION: Record<string, string> = {
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".jsonl": "application/jsonl",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".log": "text/plain",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".zip": "application/zip",
};

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i).toLowerCase() : "";
}

/** The media type of a stored file: by extension, then the declared type, then octet-stream. */
export function mediaTypeFor(path: string, declared?: string | null): string {
  const byExt = BY_EXTENSION[extensionOf(path)];
  if (byExt) return byExt;
  const d = declared?.split(";")[0]?.trim().toLowerCase();
  if (d && d !== "application/octet-stream" && /^[a-z]+\/[a-z0-9.+-]+$/.test(d)) return d;
  return "application/octet-stream";
}

export function extensionForMediaType(mediaType: string | null): string {
  if (!mediaType) return "";
  const base = mediaType.split(";")[0]!.trim().toLowerCase();
  for (const [ext, mt] of Object.entries(BY_EXTENSION)) if (mt === base) return ext;
  return "";
}

/** Text formats an inline note may use. */
export const NOTE_EXTENSIONS = [".txt", ".md", ".markdown", ".vtt", ".srt", ".csv", ".tsv", ".json", ".jsonl", ".html", ".htm", ".xml", ".yaml", ".yml", ".log"];

/** Record-relative file paths: no traversal, no backslashes, no control characters. */
export function validFilePath(path: string): string | null {
  if (!path || path.length > 200) return "a file path is 1 to 200 characters";
  if (path.includes("\\")) return "a file path may not contain a backslash";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return "a file path may not contain control characters";
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return "a file path may not have empty, '.' or '..' segments";
  return null;
}
