import type { ColumnType, Generated, Kysely, Transaction } from "kysely";

/** A jsonb column: read as the value, written as a JSON string. */
export type Json<T> = ColumnType<T, string, string>;
/** A timestamptz column read as an ISO string. */
export type Ts = ColumnType<string, string | undefined, string>;
export type TsNull = ColumnType<string | null, string | null | undefined, string | null>;
/** A nullable jsonb column that defaults to null. */
export type JsonNull<T> = ColumnType<T | null, string | null | undefined, string | null>;
/** A column with a database default: optional on insert. */
export type Def<T> = ColumnType<T, T | undefined, T>;

export interface ActorSnapshot {
  account_id: string;
  display_name: string;
  surface: "web" | "rest" | "mcp" | null;
  client: string | null;
}

export interface Dimensions {
  customer?: string | null;
  product_area?: string | null;
  lifecycle_stage?: string | null;
}

export interface Refs {
  objectives: string[];
  sources: string[];
  insights: string[];
  assumptions: string[];
  decisions: string[];
}

export interface CitationSnapshot {
  record_id: string;
  seq_start: number;
  seq_end: number;
  char_start: number;
  char_end: number;
  start_ms: number | null;
  end_ms: number | null;
  speakers: string[];
  source_file: string;
  file_version_id: string;
  derivation_id: string;
  quote: string;
  quote_hash: string;
  anchors_hash: string;
  captured_at: string;
}

export interface RegisterLink {
  id: string;
  type: "supports" | "contradicts" | "supersedes";
}

export interface StoryNode {
  page_id: string;
  children: StoryNode[];
}

export interface LineageInput {
  kind: "record" | "assumption" | "decision";
  id: string;
  fingerprint: string;
}

// ---- Directory tables (no row-level security; reached only through the auth layer) --------------

export interface AccountsTable {
  account_id: string;
  email: string;
  display_name: string;
  email_verified_at: TsNull;
  created_at: Ts;
  deleted_at: TsNull;
}

export interface SessionsTable {
  session_hash: string;
  account_id: string;
  created_at: Ts;
  expires_at: Ts;
  last_seen_at: Ts;
  user_agent: string | null;
}

export interface EmailTokensTable {
  token_hash: string;
  email: string;
  purpose: string;
  redirect: string | null;
  expires_at: Ts;
  used_at: TsNull;
  created_at: Ts;
}

export interface PersonalAccessTokensTable {
  token_id: string;
  account_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  created_at: Ts;
  last_used_at: TsNull;
  revoked_at: TsNull;
}

export interface OauthClientsTable {
  client_id: string;
  client_name: string;
  redirect_uris: Json<string[]>;
  created_at: Ts;
}

export interface OauthCodesTable {
  code_hash: string;
  client_id: string;
  account_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string;
  expires_at: Ts;
  used_at: TsNull;
}

export interface OauthTokensTable {
  token_hash: string;
  kind: "access" | "refresh";
  client_id: string;
  account_id: string;
  resource: string;
  scope: string;
  family_id: string;
  created_at: Ts;
  expires_at: Ts;
  last_used_at: TsNull;
  revoked_at: TsNull;
}

export interface TenantsTable {
  tenant_id: string;
  slug: string;
  name: string;
  plan: Def<string>;
  status: Def<string>;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

export interface TeamsTable {
  team_id: string;
  tenant_id: string;
  slug: string;
  name: string;
  archived_at: TsNull;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

export interface ProductsTable {
  product_id: string;
  tenant_id: string;
  team_id: string;
  slug: string;
  name: string;
  idea: string;
  archived_at: TsNull;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface MembershipsTable {
  membership_id: string;
  tenant_id: string;
  scope_type: "tenant" | "team" | "product";
  scope_id: string;
  account_id: string;
  role: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

export interface InvitationsTable {
  invitation_id: string;
  tenant_id: string;
  scope_type: "tenant" | "team" | "product";
  scope_id: string;
  email: string;
  role: string;
  token_hash: string;
  expires_at: Ts;
  accepted_at: TsNull;
  accepted_by: string | null;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

export interface JobsTable {
  job_id: Generated<number>;
  tenant_id: string;
  kind: string;
  payload: Json<Record<string, unknown>>;
  run_after: Ts;
  attempts: Generated<number>;
  locked_at: TsNull;
  locked_by: string | null;
  done_at: TsNull;
  error: string | null;
  created_at: Ts;
}

export interface FeedbackTable {
  feedback_id: string;
  tenant_id: string | null;
  category: string;
  message: string;
  tool: string | null;
  details: string | null;
  server_version: string;
  submitted_by: Json<ActorSnapshot>;
  received_at: Ts;
}

// ---- Content tables (row-level security on tenant_id) -------------------------------------------

export interface RecordsTable {
  record_id: string;
  tenant_id: string;
  team_id: string;
  product_id: string;
  kind: string;
  title: string;
  date: string | null;
  organization: string | null;
  participants: string[];
  source_system: string | null;
  tags: string[];
  related_records: string[];
  dimensions: Json<Dimensions>;
  provenance_depth: string;
  folder: string;
  slug: string;
  copied_from: JsonNull<{ product_id: string; record_id: string }>;
  current_derivation_id: string | null;
  archived_at: TsNull;
  archived_by: JsonNull<ActorSnapshot>;
  etag: string;
  uploaded_at: Ts;
  uploaded_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface FilesTable {
  file_id: string;
  tenant_id: string;
  record_id: string;
  path: string;
  role: "primary" | "origin" | "supplement";
  current_version_id: string | null;
  derived_from: string[];
  derivation_note: string | null;
  derived_by: string | null;
  added_at: Ts;
  added_by: Json<ActorSnapshot>;
  role_changed_at: TsNull;
  role_changed_by: JsonNull<ActorSnapshot>;
}

export interface FileVersionsTable {
  file_version_id: string;
  tenant_id: string;
  record_id: string;
  file_id: string;
  blob_key: string;
  size: number;
  sha256: string;
  media_type: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

export interface UploadGrantsTable {
  grant_id: string;
  tenant_id: string;
  product_id: string;
  record_id: string;
  path: string;
  role: "primary" | "origin" | "supplement";
  media_type: string | null;
  max_bytes: number;
  derived_from: string[];
  derivation_note: string | null;
  derived_by: string | null;
  principal: Json<ActorSnapshot>;
  expires_at: Ts;
  uploaded_at: TsNull;
  blob_key: string | null;
  size: number | null;
  sha256: string | null;
  sniffed_type: string | null;
  completed_at: TsNull;
  file_version_id: string | null;
  created_at: Ts;
}

export interface DerivationsTable {
  derivation_id: string;
  tenant_id: string;
  record_id: string;
  file_version_id: string;
  source_path: string;
  status: string;
  status_detail: string | null;
  parser: string;
  parser_version: string;
  segment_count: number;
  text_chars: number;
  duration_ms: number | null;
  facts: Json<Record<string, unknown>>;
  blob_prefix: string;
  created_at: Ts;
}

export interface SegmentsTable {
  tenant_id: string;
  record_id: string;
  derivation_id: string;
  seq: number;
  text: string;
  speaker: string | null;
  start_ms: number | null;
  end_ms: number | null;
  char_start: number;
  char_end: number;
  heading_level: number | null;
  page: number | null;
  is_current: boolean;
}

export interface AnnotationsTable {
  annotation_id: string;
  tenant_id: string;
  product_id: string;
  record_id: string;
  seq_start: number | null;
  seq_end: number | null;
  note: string;
  tags: string[];
  anchor: JsonNull<Record<string, unknown>>;
  archived_at: TsNull;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface AgentNotesTable {
  record_id: string;
  kind: "summary" | "outline" | "notes";
  tenant_id: string;
  content: string;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface ObjectivesTable {
  objective_id: string;
  tenant_id: string;
  product_id: string;
  title: string;
  description: string;
  status: "active" | "achieved" | "archived";
  position: number;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface InsightsTable {
  insight_id: string;
  tenant_id: string;
  product_id: string;
  title: string;
  summary: string;
  body: string;
  status: "draft" | "published" | "archived";
  refs: Json<Refs>;
  revision: Def<number>;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface RevisionsTable {
  revision_id: string;
  tenant_id: string;
  object_type: string;
  object_id: string;
  n: number;
  content: Json<Record<string, unknown>>;
  replaced_at: Ts;
  replaced_by: Json<ActorSnapshot>;
  written_at: Ts;
  written_by: Json<ActorSnapshot>;
}

export interface RegisterEntriesTable {
  entry_id: string;
  tenant_id: string;
  product_id: string;
  kind: "assumption" | "decision";
  statement: string;
  body: string;
  citations: Json<CitationSnapshot[]>;
  links: Json<RegisterLink[]>;
  objective_ids: string[];
  tags: string[];
  dimensions: Json<Dimensions>;
  provenance_depth: string;
  author: Json<ActorSnapshot>;
  author_type: "human" | "agent";
  status: Def<"unconfirmed" | "confirmed" | "refuted" | "superseded">;
  review_count: Def<number>;
  archived_at: TsNull;
  etag: string;
  created_at: Ts;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface ReviewsTable {
  review_id: string;
  tenant_id: string;
  entry_id: string;
  status: string;
  note: string;
  reviewer: Json<ActorSnapshot>;
  reviewer_type: "human" | "agent";
  confidence: string | null;
  created_at: Ts;
}

export interface StoryPagesTable {
  tenant_id: string;
  product_id: string;
  page_id: string;
  title: string;
  summary: string;
  current_version_id: string;
  version_count: number;
  archived_at: TsNull;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface StoryVersionsTable {
  version_id: string;
  tenant_id: string;
  product_id: string;
  page_id: string;
  n: number;
  title: string;
  summary: string;
  html: string;
  note: string;
  refs: Json<Refs>;
  previous_version_id: string | null;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

export interface StoryHierarchiesTable {
  product_id: string;
  tenant_id: string;
  items: Json<StoryNode[]>;
  etag: string;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface LineageTable {
  record_id: string;
  tenant_id: string;
  product_id: string;
  inputs: Json<LineageInput[]>;
  query_spec: Json<Record<string, unknown>>;
  generated_at: Ts;
  generated_by: Json<ActorSnapshot>;
}

export interface ActivityTable {
  activity_id: string;
  tenant_id: string;
  team_id: string | null;
  product_id: string | null;
  occurred_at: Ts;
  actor: Json<ActorSnapshot>;
  actor_account_id: string;
  channel: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_title: string | null;
  summary: string;
}

export interface TombstonesTable {
  tenant_id: string;
  product_id: string;
  object_type: string;
  object_id: string;
  title: string;
  reason: string;
  deleted_at: Ts;
  deleted_by: Json<ActorSnapshot>;
}

export interface ExportsTable {
  export_id: string;
  tenant_id: string;
  product_id: string;
  status: Def<"pending" | "ready" | "failed">;
  blob_key: string | null;
  size: number | null;
  file_count: number | null;
  error: string | null;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  completed_at: TsNull;
  expires_at: Ts;
}

export interface DB {
  accounts: AccountsTable;
  sessions: SessionsTable;
  email_tokens: EmailTokensTable;
  personal_access_tokens: PersonalAccessTokensTable;
  oauth_clients: OauthClientsTable;
  oauth_codes: OauthCodesTable;
  oauth_tokens: OauthTokensTable;
  tenants: TenantsTable;
  teams: TeamsTable;
  products: ProductsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  jobs: JobsTable;
  feedback: FeedbackTable;
  records: RecordsTable;
  files: FilesTable;
  file_versions: FileVersionsTable;
  upload_grants: UploadGrantsTable;
  derivations: DerivationsTable;
  segments: SegmentsTable;
  annotations: AnnotationsTable;
  agent_notes: AgentNotesTable;
  objectives: ObjectivesTable;
  insights: InsightsTable;
  revisions: RevisionsTable;
  register_entries: RegisterEntriesTable;
  reviews: ReviewsTable;
  story_pages: StoryPagesTable;
  story_versions: StoryVersionsTable;
  story_hierarchies: StoryHierarchiesTable;
  lineage: LineageTable;
  activity: ActivityTable;
  tombstones: TombstonesTable;
  exports: ExportsTable;
}

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

/** Serialize a value for a jsonb column. */
export function json<T>(value: T): string {
  return JSON.stringify(value);
}
