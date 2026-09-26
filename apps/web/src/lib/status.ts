import type { Tone } from "../ui/index.tsx";

/** What a source's derived status means to a person, and what to do next. */
export const DERIVED_STATUS: Record<string, { label: string; tone: Tone; explain: string; next?: string }> = {
  ready: { label: "Ready", tone: "success", explain: "Parsed into passages; its primary file is searched." },
  pending: { label: "Processing", tone: "info", explain: "Queued for parsing. Passages and the outline appear when it finishes." },
  awaiting_file: { label: "No file yet", tone: "neutral", explain: "This source has no primary file yet.", next: "Add a file." },
  needs_transcript: {
    label: "Needs transcript",
    tone: "warning",
    explain: "A recording is stored and playable, but WhatBuild does not transcribe.",
    next: "Add the transcript as its own source, with the transcript as its primary file.",
  },
  unsupported: {
    label: "Not parsed",
    tone: "neutral",
    explain: "No parser reads this format. The file is stored and downloadable.",
    next: "Add a text, Markdown, VTT, SRT, DOCX, XLSX, PDF or HTML version as a new source.",
  },
  too_large: { label: "Too large to parse", tone: "warning", explain: "Stored in full, but over the parsing limit.", next: "Add a shorter digest as a new source and keep this file as its origin." },
  failed: { label: "Parsing failed", tone: "danger", explain: "The file is stored, but its text could not be read.", next: "Check it opens elsewhere; upload a clean copy as a new source." },
};

export function derivedStatus(status: string) {
  return DERIVED_STATUS[status] ?? { label: status, tone: "neutral" as Tone, explain: "" };
}

export const REVIEW_STATUS: Record<string, { label: string; tone: Tone }> = {
  unconfirmed: { label: "Unconfirmed", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "success" },
  refuted: { label: "Refuted", tone: "danger" },
  superseded: { label: "Superseded", tone: "warning" },
};

export const ROLE_LABEL: Record<string, string> = { primary: "Primary", origin: "Origin", supplement: "Supplement" };

export const PROVENANCE_LABEL: Record<string, string> = {
  primary: "Primary source",
  derived: "Derived material",
  analysis_of_analysis: "Analysis of analysis",
  unknown: "Not specified",
};
