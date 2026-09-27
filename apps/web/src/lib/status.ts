import type { StatusTone } from "../ui/index.tsx";

/**
 * What a source's derived status means to a person, and what to do next. `detail` marks the
 * statuses whose server detail (a size or an error) adds to `explain`; for the rest, `explain`
 * already says what the detail would.
 */
export const DERIVED_STATUS: Record<string, { label: string; tone: StatusTone; explain: string; next?: string; detail?: true }> = {
  ready: { label: "Ready", tone: "positive", explain: "Parsed into passages; its primary file is searched." },
  pending: { label: "Processing", tone: "progress", explain: "Queued for parsing. Passages and the outline appear when it finishes." },
  awaiting_file: { label: "No file yet", tone: "neutral", explain: "This source has no primary file yet.", next: "Add a file." },
  needs_transcript: {
    label: "Needs transcript",
    tone: "attention",
    explain: "A recording is stored and playable, but WhatBuild does not transcribe.",
    next: "Add the transcript as its own source, with the transcript as its primary file.",
  },
  unsupported: {
    label: "Not parsed",
    tone: "neutral",
    explain: "No parser reads this format. The file is stored and downloadable.",
    next: "Add a text, Markdown, VTT, SRT, DOCX, XLSX, PDF or HTML version as a new source.",
  },
  too_large: { label: "Too large to parse", tone: "attention", explain: "Stored in full, but over the parsing limit.", next: "Add a shorter digest as a new source and keep this file as its origin.", detail: true },
  failed: { label: "Parsing failed", tone: "negative", explain: "The file is stored, but its text could not be read.", next: "Check it opens elsewhere; upload a clean copy as a new source.", detail: true },
};

export function derivedStatus(status: string) {
  return DERIVED_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone, explain: "" };
}

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

export const ROLE_LABEL: Record<string, string> = { primary: "Primary", origin: "Origin", supplement: "Supplement" };

export const PROVENANCE_LABEL: Record<string, string> = {
  primary: "Primary source",
  derived: "Derived material",
  analysis_of_analysis: "Analysis of analysis",
  unknown: "Not specified",
};

/**
 * The written map from every other domain status to a StatusBadge tone. positive: done and good;
 * attention: needs a person; negative: failed or refuted; progress: running; neutral: a plain state.
 */
export const STATUS_TONE = {
  insight: { draft: "attention", published: "positive", archived: "neutral" },
  objective: { active: "neutral", achieved: "positive", archived: "neutral" },
  review: { unreviewed: "attention", changed: "attention", reviewed: "positive" },
  citation: { ok: "positive", relocated: "attention", text_changed: "attention", record_archived: "neutral", record_deleted: "negative", record_missing: "negative" },
  upload: { queued: "neutral", uploading: "progress", done: "positive", failed: "negative" },
} as const satisfies Record<string, Record<string, StatusTone>>;

export function toneFor<K extends keyof typeof STATUS_TONE>(domain: K, status: string): StatusTone {
  return (STATUS_TONE[domain] as Record<string, StatusTone>)[status] ?? "neutral";
}
