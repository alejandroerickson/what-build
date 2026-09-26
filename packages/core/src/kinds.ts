/**
 * The intake taxonomy. Kinds describe discovery work and source formats, never the domain of the
 * product being studied. The list is closed; a retired kind stays readable under its stored value.
 */

export interface KindInfo {
  kind: string;
  label: string;
  short: string;
  group: KindGroup;
  description: string;
  /** Intake asks for the event date. */
  dated: boolean;
  /** Intake asks which organization the material concerns. */
  organizational: boolean;
  /** The primary is usually audio or video with no transcript. */
  recording: boolean;
  /** Folder root; dated kinds add a year segment. */
  root: string;
}

export type KindGroup = "interviews" | "sales-calls" | "research" | "documents" | "design" | "other";

export const GROUPS: { group: KindGroup; label: string; description: string }[] = [
  { group: "interviews", label: "Interviews", description: "Conversations with customers and users, filed by year." },
  { group: "sales-calls", label: "Sales calls", description: "Calls with prospects and accounts, filed by year." },
  { group: "research", label: "Research", description: "Studies, sessions and tool exports, filed by year." },
  { group: "documents", label: "Documents", description: "Written material: exports, requirements, decks, analyses." },
  { group: "design", label: "Design", description: "Findings and notes from the design practice." },
  { group: "other", label: "Other", description: "Anything that fits none of the groups above." },
];

export const KINDS: KindInfo[] = [
  { kind: "interview_transcript", label: "Interview transcript", short: "Interview transcript", group: "interviews", root: "interviews", dated: true, organizational: true, recording: false, description: "A written record of a customer or user interview: VTT, SRT, DOCX or plain text." },
  { kind: "interview_recording", label: "Interview recording", short: "Interview recording", group: "interviews", root: "interviews", dated: true, organizational: true, recording: true, description: "Audio or video of an interview. Stored and playable; add a transcript as its own source to search it." },
  { kind: "interviewer_notes", label: "Interviewer notes", short: "Interviewer notes", group: "interviews", root: "interviews", dated: true, organizational: true, recording: false, description: "Notes taken during or after an interview." },
  { kind: "sales_call_recording", label: "Sales call recording", short: "Sales recording", group: "sales-calls", root: "sales-calls", dated: true, organizational: true, recording: true, description: "Audio or video of a call with a prospect or account." },
  { kind: "sales_call_transcript", label: "Sales call transcript", short: "Sales transcript", group: "sales-calls", root: "sales-calls", dated: true, organizational: true, recording: false, description: "A written record of a call with a prospect or account." },
  { kind: "user_research_export", label: "User research export", short: "Research export", group: "research", root: "research", dated: true, organizational: false, recording: false, description: "An export from a research tool: survey results, study summaries, tagged highlights." },
  { kind: "usability_session_notes", label: "Usability session notes", short: "Session notes", group: "research", root: "research", dated: true, organizational: false, recording: false, description: "Notes or a transcript from a usability session." },
  { kind: "wiki_export", label: "Wiki export", short: "Wiki export", group: "documents", root: "documents/wiki", dated: false, organizational: false, recording: false, description: "A page or space exported from a team wiki." },
  { kind: "prd", label: "Product requirements document", short: "PRD", group: "documents", root: "documents/prds", dated: false, organizational: false, recording: false, description: "A requirements document or product brief." },
  { kind: "deck", label: "Deck", short: "Deck", group: "documents", root: "documents/decks", dated: false, organizational: false, recording: false, description: "Slides: a readout, a pitch, a strategy deck." },
  { kind: "contract_sow", label: "Contract or statement of work", short: "Contract", group: "documents", root: "documents/contracts", dated: false, organizational: true, recording: false, description: "A contract, SOW or order form that bears on discovery. Prefer a digest as the primary." },
  { kind: "rfp", label: "Request for proposal", short: "RFP", group: "documents", root: "documents/rfps", dated: false, organizational: false, recording: false, description: "An RFP or RFI and its requirements." },
  { kind: "analysis", label: "Analysis", short: "Analysis", group: "documents", root: "documents/analysis", dated: false, organizational: false, recording: false, description: "An authored interpretation that draws conclusions from one or more sources." },
  { kind: "digest", label: "Digest", short: "Digest", group: "documents", root: "documents/digests", dated: false, organizational: false, recording: false, description: "A short, focused extract of a longer original, which is kept as an origin file." },
  { kind: "view", label: "View", short: "View", group: "documents", root: "documents/views", dated: false, organizational: false, recording: false, description: "A materialized cross-source view built from a defined set of inputs, with lineage." },
  { kind: "design_insight", label: "Design insight", short: "Design insight", group: "design", root: "design", dated: false, organizational: false, recording: false, description: "A finding or note from design work: a critique, a pattern, a review." },
  { kind: "other", label: "Something else", short: "Other", group: "other", root: "misc", dated: false, organizational: false, recording: false, description: "Discovery material that fits none of the kinds above." },
];

export const KIND_VALUES = KINDS.map((k) => k.kind) as [string, ...string[]];
const BY_KIND = new Map(KINDS.map((k) => [k.kind, k]));

export function kindInfo(kind: string): KindInfo {
  return BY_KIND.get(kind) ?? { ...BY_KIND.get("other")!, kind };
}

const DATED_ROOTS = new Set(KINDS.filter((k) => k.dated).map((k) => k.root));

/** The logical folder: a browse facet and an export path, never a storage location. */
export function folderFor(kind: string, date: string | null): string {
  const info = kindInfo(kind);
  if (!DATED_ROOTS.has(info.root)) return info.root;
  return `${info.root}/${date ? date.slice(0, 4) : "undated"}`;
}

const ROOT_LABELS: Record<string, string> = {
  interviews: "Interviews",
  "sales-calls": "Sales calls",
  research: "Research",
  documents: "Documents",
  wiki: "Wiki exports",
  prds: "Requirements documents",
  decks: "Decks",
  contracts: "Contracts and SOWs",
  rfps: "RFPs",
  analysis: "Analysis",
  digests: "Digests",
  views: "Views",
  design: "Design",
  misc: "Other",
  undated: "Undated",
};

/** "interviews/2026" → "Interviews › 2026". Never invents a segment the folder lacks. */
export function describeFolder(folder: string): string {
  return folder
    .split("/")
    .filter(Boolean)
    .map((p) => ROOT_LABELS[p] ?? p)
    .join(" › ");
}

export const PROVENANCE_DEPTHS = ["primary", "derived", "analysis_of_analysis", "unknown"] as const;
export const LIFECYCLE_STAGES = ["discovery", "sales", "research"] as const;
export const FILE_ROLES = ["primary", "origin", "supplement"] as const;

/** The sentence repeated wherever files are added or listed. */
export const SEARCH_RULE =
  "Only the primary file is searched. Origin and supplement files are kept in full for download and never affect search.";
