export interface Actor {
  account_id: string;
  display_name: string;
  surface: "web" | "rest" | "mcp" | null;
  client: string | null;
}

export interface RecordSummary {
  record_id: string;
  title: string;
  date: string | null;
  tags: string[];
  uploaded_by: Actor;
  uploaded_at: string;
  updated_at: string;
  updated_by: Actor;
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
  annotations: Annotation[];
}

export interface Annotation {
  annotation_id: string;
  record_id: string;
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

/** sources.facets: what a product's sources can be filtered by. */
export interface SourceFacets {
  sources: number;
  tags: { tag: string; count: number }[];
  tags_truncated: boolean;
  added_by: { account_id: string; display_name: string; count: number }[];
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
  kind: "assumption";
  statement: string;
  body: string;
  status: "unconfirmed" | "confirmed" | "refuted" | "superseded";
  frozen: boolean;
  links: { id: string; type: string; kind?: string; statement?: string; status?: string }[];
  linked_from: { id: string; type: string; kind: string; statement: string; status: string }[];
  outcome_ids: string[];
  tags: string[];
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
  kind: "assumption";
  statement: string;
  status: RegisterEntry["status"];
  author: Actor;
  author_type: "human" | "agent";
  outcome_ids: string[];
  review_count: number;
  human_review: RegisterEntry["human_review"];
  /** The entries that supersede this one, newest first. */
  superseded_by: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

