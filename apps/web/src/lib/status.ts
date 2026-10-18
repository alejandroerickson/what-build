import type { StatusTone } from "../ui/index.tsx";

/**
 * What a source's text status means to a person, and what to do next. `detail` marks the statuses
 * whose server detail (a size or an error) adds to `explain`; for the rest, `explain` already says
 * what the detail would.
 */
export const DERIVED_STATUS: Record<string, { label: string; tone: StatusTone; explain: string; next?: string; detail?: true }> = {
  ready: { label: "Ready", tone: "positive", explain: "Its text is ready to read and search." },
  pending: { label: "Reading", tone: "progress", explain: "Its text appears once its attachment has been read." },
  awaiting_file: { label: "No text yet", tone: "neutral", explain: "This source has no attachment and no text yet.", next: "Add an attachment, or write its text." },
  awaiting_text: { label: "No text", tone: "attention", explain: "This source has an attachment with text, but no text of its own.", next: "Use an attachment’s text, or write it." },
  needs_transcript: {
    label: "Needs transcript",
    tone: "attention",
    explain: "WhatBuild doesn’t transcribe recordings.",
    next: "Add the transcript as another attachment.",
  },
  unsupported: {
    label: "Not read as text",
    tone: "neutral",
    explain: "WhatBuild can’t read this format. The attachment is kept for download.",
    next: "Add a text, Markdown, VTT, SRT, DOC, DOCX, XLSX, CSV, TSV, PDF or HTML version as another attachment, or write the text.",
  },
  too_large: { label: "Too large to read", tone: "attention", explain: "The attachment is kept, but it’s over the size limit for reading its text.", next: "Add a shorter version as another attachment, or write the text.", detail: true },
  failed: { label: "Couldn’t be read", tone: "negative", explain: "The attachment is kept, but its text couldn’t be read.", next: "Check that it opens elsewhere, then add a clean copy, or write the text.", detail: true },
};

/** How one attachment's text was read, in a word or two. */
export const ATTACHMENT_TEXT: Record<string, { label: string; tone: StatusTone }> = {
  ready: { label: "Text read", tone: "positive" },
  pending: { label: "Reading", tone: "progress" },
  needs_transcript: { label: "Recording, no text", tone: "neutral" },
  unsupported: { label: "Format not read", tone: "neutral" },
  too_large: { label: "Too large to read", tone: "attention" },
  failed: { label: "Couldn’t be read", tone: "negative" },
};

export function derivedStatus(status: string) {
  return DERIVED_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone, explain: "" };
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif", "svg"];

/**
 * Whether an attachment is pictures WhatBuild reads no words from: an image, or a PDF with no text
 * layer, whose pages are pictures as a scan's are. Neither is a failure, and reading it again
 * changes nothing; an agent that can see it gives the source its words.
 */
export function pictureKind(a: { path: string; media_type: string | null; text: { status: string } }): "image" | "scan" | null {
  if (a.text.status !== "unsupported") return null;
  const type = a.media_type ?? "";
  const ext = a.path.toLowerCase().split(".").pop() ?? "";
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (type === "application/pdf" || ext === "pdf") return "scan";
  return null;
}

/** What a source whose only readings are pictures says instead of the format's words. */
export const PICTURES = {
  image: "WhatBuild reads no words from an image. The image is kept and shown.",
  scan: "This PDF’s pages are pictures, as a scan’s are, so WhatBuild reads no words from it. It is kept for download.",
  both: "Its attachments are pictures: images, or PDFs whose pages are pictures. WhatBuild reads no words from pictures; they are kept.",
  next: (many: boolean) =>
    many
      ? "An agent that can see them can write the source’s summary, and its text if search should find their words; or write the text."
      : "An agent that can see it can write the source’s summary, and its text if search should find its words; or write the text.",
};

/** The server's status detail, only when it adds to the explanation (an unknown status always shows it). */
export function derivedStatusDetail(status: string, detail: string | null | undefined): string | null {
  if (!detail) return null;
  const known = DERIVED_STATUS[status];
  return !known || known.detail ? detail : null;
}

export const REVIEW_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  unconfirmed: { label: "Unconfirmed", tone: "attention" },
  confirmed: { label: "Confirmed", tone: "positive" },
  refuted: { label: "Refuted", tone: "negative" },
  superseded: { label: "Superseded", tone: "neutral" },
};

/**
 * The written map from every other domain status to a StatusBadge tone. positive: done and good;
 * attention: needs a person; negative: failed or refuted; progress: running; neutral: a plain state.
 */
export const STATUS_TONE = {
  upload: { queued: "neutral", uploading: "progress", done: "positive", failed: "negative" },
} as const satisfies Record<string, Record<string, StatusTone>>;

export function toneFor<K extends keyof typeof STATUS_TONE>(domain: K, status: string): StatusTone {
  return (STATUS_TONE[domain] as Record<string, StatusTone>)[status] ?? "neutral";
}
