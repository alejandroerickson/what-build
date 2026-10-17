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
  /** Where the source's derived text stands: ready, pending, awaiting_file, awaiting_text, or how its newest attachment was read. */
  derived_status: string;
  text_chars: number;
  attachment_count: number;
  etag: string;
  /** The attachment the derived text was taken from; sources.list includes it. */
  text_from?: string | null;
}

/** How an attachment's text was read: kept with the source, never searched. */
export interface AttachmentText {
  status: string;
  status_detail: string | null;
  chars: number;
  duration_ms: number | null;
  parser: string | null;
  derivation_id: string | null;
  read_at: string | null;
}

export interface Attachment {
  path: string;
  media_type: string | null;
  size: number | null;
  file_version_id: string | null;
  versions: { file_version_id: string; size: number; media_type: string; created_at: string; created_by: Actor }[];
  added_at: string;
  added_by: Actor;
  text: AttachmentText;
  /** Whether the source's derived text is this attachment's. */
  is_text_source: boolean;
}

export interface RecordFull extends RecordSummary {
  duration_ms: number | null;
  status_detail: string | null;
  annotation_count: number;
  pending_upload_path: string | null;
  attachments: Attachment[];
  /** The derived text's state; its words come from derived/text. */
  text: { chars: number; etag: string; updated_at: string; updated_by: Actor; taken_from: { path: string; file_version_id: string } | null } | null;
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

/** A window of a source's derived text. */
export interface DerivedText {
  record_id: string;
  of: "derived_text";
  offset: number;
  total_chars: number;
  truncated: boolean;
  text: string;
  etag: string;
  updated_at: string;
  updated_by: Actor;
  taken_from: { path: string; file_version_id: string } | null;
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

