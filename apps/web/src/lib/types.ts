export interface Actor {
  account_id: string;
  display_name: string;
  surface: "web" | "rest" | "mcp" | null;
  client: string | null;
}

export interface RecordSummary {
  record_id: string;
  kind: string;
  kind_label: string;
  title: string;
  date: string | null;
  organization: string | null;
  tags: string[];
  dimensions: { customer?: string | null; product_area?: string | null; lifecycle_stage?: string | null };
  provenance_depth: string;
  folder: string;
  folder_label: string;
  uploaded_by: Actor;
  uploaded_at: string;
  archived_at: string | null;
  derived_status: string;
  segment_count: number;
  file_count: number;
  etag: string;
  /** The primary file's path; sources.list includes it. */
  primary_file?: string | null;
}

export interface FileEntry {
  path: string;
  role: "primary" | "origin" | "supplement";
  media_type: string | null;
  size: number | null;
  file_version_id: string | null;
  versions: { file_version_id: string; size: number; media_type: string; created_at: string; created_by: Actor }[];
  derived_from: string[];
  derivation_note: string | null;
  derived_by: string | null;
  added_at: string;
  added_by: Actor;
  searchable: boolean;
  search_status: string;
}

export interface RecordFull extends RecordSummary {
  text_chars: number;
  duration_ms: number | null;
  status_detail: string | null;
  annotation_count: number;
  participants: string[];
  source_system: string | null;
  related_records: string[];
  updated_at: string;
  updated_by: Actor;
  pending_primary_path: string | null;
  files: FileEntry[];
  search_rule: string;
  manifest: {
    derivation_id: string;
    status: string;
    status_detail: string | null;
    parser: string;
    parser_version: string;
    source_path: string;
    segment_count: number;
    text_chars: number;
    duration_ms: number | null;
    facts: Record<string, unknown>;
    created_at: string;
  } | null;
  outline: string | null;
  annotations: Annotation[];
  has_lineage: boolean;
}

export interface Annotation {
  annotation_id: string;
  record_id: string;
  seq_start: number | null;
  seq_end: number | null;
  note: string;
  tags: string[];
  etag: string;
  created_at: string;
  created_by: Actor;
}

export interface Segment {
  seq: number;
  text: string;
  speaker: string | null;
  start_ms: number | null;
  end_ms: number | null;
  char_start: number;
  char_end: number;
  heading_level: number | null;
  page: number | null;
}

export interface KindInfo {
  kind: string;
  label: string;
  short: string;
  group: string;
  description: string;
  dated: boolean;
  organizational: boolean;
  recording: boolean;
  root: string;
}

export interface KindsResponse {
  groups: { group: string; label: string; description: string }[];
  kinds: KindInfo[];
  search_rule: string;
}

export interface CitationView {
  index: number;
  record_id: string;
  seq_start: number;
  seq_end: number;
  quote: string;
  speakers: string[];
  start_ms: number | null;
  source_title: string | null;
  captured_at: string;
}

export interface Review {
  status: string;
  note: string;
  reviewer: Actor;
  reviewer_type: "human" | "agent";
  confidence: string | null;
  created_at: string;
}

export interface RegisterEntry {
  id: string;
  kind: "assumption" | "decision";
  statement: string;
  body: string;
  status: "unconfirmed" | "confirmed" | "refuted" | "superseded";
  frozen: boolean;
  citations: CitationView[];
  links: { id: string; type: string; kind?: string; statement?: string; status?: string }[];
  linked_from: { id: string; type: string; kind: string; statement: string; status: string }[];
  objective_ids: string[];
  tags: string[];
  dimensions: Record<string, string | null>;
  provenance_depth: string;
  author: Actor;
  author_type: "human" | "agent";
  reviews: Review[];
  review_count: number;
  human_review: { confidence: string; reviewer: Actor | null; reviewed_at: string | null };
  archived_at: string | null;
  etag: string;
  created_at: string;
  updated_at: string;
}

export interface RegisterSummary {
  id: string;
  kind: "assumption" | "decision";
  statement: string;
  status: RegisterEntry["status"];
  author: Actor;
  author_type: "human" | "agent";
  citation_count: number;
  record_ids: string[];
  review_count: number;
  human_review: RegisterEntry["human_review"];
  /** The entries that supersede this one, newest first. */
  superseded_by: string[];
  archived_at: string | null;
  updated_at: string;
}

export interface Refs {
  objectives: string[];
  sources: string[];
  insights: string[];
  assumptions: string[];
  decisions: string[];
}

export interface InsightSummary {
  insight_id: string;
  title: string;
  summary: string;
  status: "draft" | "published" | "archived";
  refs: Refs;
  revision: number;
  body_chars: number;
  etag: string;
  created_at: string;
  created_by: Actor;
  updated_at: string;
  updated_by: Actor;
  /** unreviewed: never reviewed; reviewed: the current revision is; changed: an earlier one was. */
  review_state: InsightReviewState;
  reviewed_revision: number | null;
  reviewed_at: string | null;
  reviewed_by: Actor | null;
}

export type InsightReviewState = "unreviewed" | "reviewed" | "changed";

export interface Insight extends InsightSummary {
  body: string;
  truncated: boolean;
}
