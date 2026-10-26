import type { ColumnType, Generated, Kysely, Transaction } from "kysely";
import type { ConnectionLevel } from "./registry.ts";

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

/** What an insight referred to, as stored before insights and decisions moved into Evidence. */
export interface LegacyRefs {
  outcomes?: string[];
  sources?: string[];
  assumptions?: string[];
  insights?: string[];
  decisions?: string[];
}

export interface RegisterLink {
  id: string;
  type: "supports" | "contradicts" | "supersedes";
}

export interface StoryNode {
  page_id: string;
  children: StoryNode[];
}

// ---- Directory tables (no row-level security; reached only through the auth layer) --------------

export interface AccountsTable {
  account_id: string;
  email: string;
  display_name: string;
  email_verified_at: TsNull;
  created_at: Ts;
  deleted_at: TsNull;
  /** The person hid the example organization from the app's panel. */
  hide_example: Def<boolean>;
}

export interface SessionsTable {
  session_hash: string;
  account_id: string;
  created_at: Ts;
  expires_at: Ts;
  last_seen_at: Ts;
  user_agent: string | null;
  /** Issued under the session cookie's old name, `wb_session`, which is still taken for it over HTTPS. */
  legacy_cookie: Def<boolean>;
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
  /** The connection (`oauth_tokens.family_id`) the code made when it was exchanged; null until then. */
  family_id: string | null;
  /** The connection level the person chose when they approved it. */
  level: Def<ConnectionLevel>;
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
  /** What the connection may do: the same on every token of one connection (`family_id`). */
  level: Def<ConnectionLevel>;
  /** Whether the connection is offered submit_feedback; like the level, the same on every token of one connection. */
  feedback: Def<boolean>;
}

export interface TenantsTable {
  tenant_id: string;
  slug: string;
  name: string;
  /** Guards the name and the slug, which its owners and the instance's owners change. */
  name_etag: Def<string>;
  /** `free` or `unlimited` (`limits.ts`). */
  plan: Def<string>;
  status: Def<string>;
  /** The example organization, as the deployment's configuration says. Set by the server at start-up. */
  example: Def<boolean>;
  /** The limits an instance owner changed from the free plan's; read through `readLimits`, which supplies the rest. */
  limits: ColumnType<Record<string, unknown>, string | undefined, string>;
  limits_etag: string | null;
  limits_updated_at: TsNull;
  limits_updated_by: JsonNull<ActorSnapshot>;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

/** A slug an organization had before its current one, which an address may still name it by. */
export interface TenantSlugsTable {
  slug: string;
  tenant_id: string;
  retired_at: Ts;
  retired_by: Json<ActorSnapshot>;
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
  /** The back of the product concept's card, for agents: Markdown. */
  concept: string;
  /** The front of the product concept's card, for people: agent-written HTML in the card kit, or "". */
  card_html: Generated<string>;
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
  /** Who sent a report made before feedback named nobody; null since. */
  submitted_by: JsonNull<ActorSnapshot>;
  /** The door it came through: `web` or `mcp`. */
  surface: string | null;
  /** An agent's family (`clientFamily`), never the name its client registered. */
  client: string | null;
  /** The part of the web app the person was on. */
  screen: string | null;
  /** The person's address, only when they chose to share it for a reply. */
  reply_to: string | null;
  /** When the report went out in the daily digest; null until then. */
  sent_at: TsNull;
  received_at: Ts;
}

/** How many reports a person sent on one day, for the daily limit; it never says which. */
export interface FeedbackCountsTable {
  account_id: string;
  day: string;
  sent: number;
}

/** A request, from the public site, to hear when WhatBuild opens. Write-only; operators read it directly. */
export interface InterestTable {
  interest_id: string;
  email: string;
  name: string | null;
  organization: string | null;
  note: string | null;
  created_at: Ts;
  updated_at: Ts;
}

/**
 * How the service is used: calls per day, operation, door, agent client and outcome. Names no
 * organization, product, record or person (`usage.ts`).
 */
export interface UsageCallsTable {
  day: string;
  operation: string;
  surface: string;
  client: string;
  /** The call was in the example organization (before 0034, in the public sandbox). */
  example: boolean;
  owner: boolean;
  outcome: string;
  calls: Generated<number>;
}

/** Each day a person used a part of WhatBuild, the person named by a keyed hash of their account. */
export interface UsagePeopleTable {
  day: string;
  person: string;
  feature: string;
  surface: string;
  client: string;
  /** The call was in the example organization (before 0034, in the public sandbox). */
  example: boolean;
  owner: boolean;
}

// ---- Content tables (row-level security on tenant_id) -------------------------------------------

export interface RecordsTable {
  record_id: string;
  tenant_id: string;
  team_id: string;
  product_id: string;
  title: string;
  date: string | null;
  tags: string[];
  slug: string;
  copied_from: JsonNull<{ product_id: string; record_id: string }>;
  archived_at: TsNull;
  archived_by: JsonNull<ActorSnapshot>;
  etag: string;
  uploaded_at: Ts;
  uploaded_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

/** A source's attachments: files kept with it, never searched. */
export interface FilesTable {
  file_id: string;
  tenant_id: string;
  record_id: string;
  path: string;
  current_version_id: string | null;
  added_at: Ts;
  added_by: Json<ActorSnapshot>;
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
  media_type: string | null;
  max_bytes: number;
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

/** A ZIP of a mockup canvas on its way to mockups.publish: the grant's state and the bytes' place. */
export interface MockupUploadsTable {
  upload_id: string;
  tenant_id: string;
  product_id: string;
  blob_key: string;
  max_bytes: number;
  principal: Json<ActorSnapshot>;
  expires_at: Ts;
  uploaded_at: TsNull;
  size: number | null;
  sha256: string | null;
  used_at: TsNull;
  used_by_version_id: string | null;
  created_at: Ts;
}

/** A document story.preview made, held for its grant to GET until it expires. */
export interface StoryPreviewsTable {
  preview_id: string;
  tenant_id: string;
  product_id: string;
  page_id: string;
  html: string;
  shows_mockup: boolean;
  created_by: Json<ActorSnapshot>;
  expires_at: Ts;
  created_at: Ts;
}

/** A front outcomes.card_preview checked, held for its grant (0033). */
export interface CardPreviewsTable {
  preview_id: string;
  tenant_id: string;
  product_id: string;
  kind: "concept" | "outcome";
  title: string;
  card_html: string;
  created_by: Json<ActorSnapshot>;
  expires_at: Ts;
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
  text_chars: number;
  duration_ms: number | null;
  facts: Json<Record<string, unknown>>;
  blob_prefix: string;
  created_at: Ts;
}

/** A source's derived text: the Markdown search reads, taken from an attachment or written by someone. */
export interface SourceTextsTable {
  record_id: string;
  tenant_id: string;
  content: string;
  /** Its length in code points. */
  chars: number;
  /** The attachment version whose text it is, until someone edits it. */
  from_file_version_id: string | null;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
  etag: string;
}

/** What search reads of a source: its title, tags, summary, notes, derived text and comments. */
export type TextField = "title" | "tags" | "summary" | "notes" | "text" | "comment";

/** The search index: each searchable text of a source, cut into pieces that are matched one at a time. */
export interface TextChunksTable {
  tenant_id: string;
  record_id: string;
  field: TextField;
  /** A comment's annotation_id; empty for the other fields. */
  ref: string;
  n: number;
  /** Code points into the field's text, half-open. */
  char_start: number;
  char_end: number;
  text: string;
}

export interface AnnotationsTable {
  annotation_id: string;
  tenant_id: string;
  product_id: string;
  record_id: string;
  note: string;
  tags: string[];
  archived_at: TsNull;
  archive_reason: ColumnType<string | null, string | null | undefined, string | null>;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

export interface AgentNotesTable {
  record_id: string;
  kind: "summary" | "notes";
  tenant_id: string;
  content: string;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
  /**
   * Changes on every write. The column has a default only for rows written before it existed; code
   * names a new one on every insert and update.
   */
  etag: string;
}

export interface OutcomesTable {
  outcome_id: string;
  tenant_id: string;
  product_id: string;
  title: string;
  /** The back of the outcome's card, for agents: Markdown. */
  description: string;
  /** The front of the outcome's card, for people: agent-written HTML in the card kit, or "". */
  card_html: Generated<string>;
  position: number;
  archived_at: TsNull;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

/**
 * Insights are retired. A row here is waiting for the worker to move it into Evidence as a source
 * (evidence-move.ts); nothing else reads or writes the table.
 */
export interface InsightsTable {
  insight_id: string;
  tenant_id: string;
  product_id: string;
  title: string;
  summary: string;
  body: string;
  status: "draft" | "published" | "archived";
  refs: Json<LegacyRefs>;
  revision: Def<number>;
  /** The revision a person last marked reviewed; null when never reviewed. */
  reviewed_revision: ColumnType<number | null, number | null | undefined, number | null>;
  reviewed_at: TsNull;
  reviewed_by: JsonNull<ActorSnapshot>;
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
  /** Decisions are retired: a decision row is waiting for the worker to move it into Evidence. */
  kind: "assumption" | "decision";
  statement: string;
  body: string;
  links: Json<RegisterLink[]>;
  outcome_ids: string[];
  tags: string[];
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
  /** Markdown notes agents keep about the page; not versioned with the HTML. */
  agent_notes: Def<string>;
  agent_notes_etag: Def<string>;
  agent_notes_updated_at: TsNull;
  agent_notes_updated_by: JsonNull<ActorSnapshot>;
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
  /** No longer written or read; kept so older versions keep their row as it was. */
  note: Def<string>;
  /** Set when the version shows one page of a mockup version instead of HTML of its own (html is then empty). */
  mockup: JsonNull<MockupPageRef>;
  previous_version_id: string | null;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

/** One page of one mockup version, as a Story page version shows it. */
export interface MockupPageRef {
  mockup_id: string;
  mockup_version_id: string;
  version: number;
  page_id: string;
}

export interface MockupsTable {
  mockup_id: string;
  tenant_id: string;
  product_id: string;
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

export interface MockupVersionsTable {
  version_id: string;
  tenant_id: string;
  product_id: string;
  mockup_id: string;
  n: number;
  title: string;
  summary: string;
  /** Markdown: what the canvas explores and why. */
  brief: string;
  /** How many pages sit side by side before the canvas wraps; null keeps them in one row. */
  columns: number | null;
  previous_version_id: string | null;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
}

export interface MockupFilesTable {
  version_id: string;
  tenant_id: string;
  product_id: string;
  path: string;
  content: string;
}

export interface MockupPagesTable {
  version_id: string;
  tenant_id: string;
  product_id: string;
  position: number;
  page_id: string;
  title: string;
  /** Markdown design notes shown beside the page on the canvas. */
  notes: string;
  width: number;
  height: number;
  /** The page's own document, or null for a page that enters the version's prototype. */
  html: string | null;
  /** A path in the version's prototype, with a query and a fragment if wanted; null for a page with HTML of its own. */
  entry: ColumnType<string | null, string | null | undefined, string | null>;
  /** A prototype image the Story's print view shows for an entry page. */
  poster: ColumnType<string | null, string | null | undefined, string | null>;
}

/** One file of a mockup version's prototype: its bytes are a blob, given back byte for byte. */
export interface MockupPrototypeFilesTable {
  version_id: string;
  tenant_id: string;
  product_id: string;
  /** Relative, `/` between folders, NFC (prototype.ts). */
  path: string;
  size: number;
  sha256: string;
  /** Chosen once at publish from the path (prototypeMediaType). */
  media_type: string;
  /** t/<tenant>/p/<product>/mockup-prototypes/<upload_id>/<sha256>: ids and a hash, never the path. */
  blob_key: string;
}

export interface StoryHierarchiesTable {
  product_id: string;
  tenant_id: string;
  items: Json<StoryNode[]>;
  /** The order of the Published mockups section: ids of pages whose current version shows a mockup page. */
  mockups: ColumnType<string[], string | undefined, string>;
  etag: string;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

/** A product's Story style: the design system every Story page follows. One per product. */
export interface StoryStylesTable {
  product_id: string;
  tenant_id: string;
  name: string;
  summary: string;
  /** The house style it was adopted from, or null for the team's own design system. */
  based_on: string | null;
  rules: string;
  stylesheet: string;
  /** A page that shows the style; null means the shared-vocabulary specimen in this stylesheet. */
  specimen_html: string | null;
  etag: string;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
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

// ---- Instance ----------------------------------------------------------------------------------

/** How many organizations an address may create, given by an instance owner. Keyed by the lower-cased address. */
export interface TenantAllowancesTable {
  email: string;
  allowed: number;
  note: Def<string>;
  etag: string;
  created_at: Ts;
  created_by: Json<ActorSnapshot>;
  updated_at: Ts;
  updated_by: Json<ActorSnapshot>;
}

/** Counters behind the limits of a free organization (`limits.ts`). */
export interface LimitCountersTable {
  tenant_id: string;
  /** The person, or "" for the whole organization. */
  account_id: string;
  bucket: "minute" | "day";
  starts_at: string;
  counter: string;
  n: number;
}

export interface DB {
  accounts: AccountsTable;
  sessions: SessionsTable;
  email_tokens: EmailTokensTable;
  oauth_clients: OauthClientsTable;
  oauth_codes: OauthCodesTable;
  oauth_tokens: OauthTokensTable;
  tenants: TenantsTable;
  tenant_slugs: TenantSlugsTable;
  teams: TeamsTable;
  products: ProductsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  jobs: JobsTable;
  feedback: FeedbackTable;
  feedback_counts: FeedbackCountsTable;
  interest: InterestTable;
  records: RecordsTable;
  files: FilesTable;
  file_versions: FileVersionsTable;
  upload_grants: UploadGrantsTable;
  mockup_uploads: MockupUploadsTable;
  derivations: DerivationsTable;
  source_texts: SourceTextsTable;
  text_chunks: TextChunksTable;
  annotations: AnnotationsTable;
  agent_notes: AgentNotesTable;
  outcomes: OutcomesTable;
  insights: InsightsTable;
  revisions: RevisionsTable;
  register_entries: RegisterEntriesTable;
  reviews: ReviewsTable;
  story_pages: StoryPagesTable;
  story_versions: StoryVersionsTable;
  story_hierarchies: StoryHierarchiesTable;
  story_styles: StoryStylesTable;
  story_previews: StoryPreviewsTable;
  card_previews: CardPreviewsTable;
  mockups: MockupsTable;
  mockup_versions: MockupVersionsTable;
  mockup_pages: MockupPagesTable;
  mockup_files: MockupFilesTable;
  mockup_prototype_files: MockupPrototypeFilesTable;
  activity: ActivityTable;
  tombstones: TombstonesTable;
  exports: ExportsTable;
  limit_counters: LimitCountersTable;
  tenant_allowances: TenantAllowancesTable;
  usage_calls: UsageCallsTable;
  usage_people: UsagePeopleTable;
}

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

/** Serialize a value for a jsonb column. */
export function json<T>(value: T): string {
  return JSON.stringify(value);
}
