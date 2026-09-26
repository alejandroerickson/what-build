-- WhatBuild schema, first migration.
--
-- Directory tables (accounts, sessions, tokens, tenants, teams, products, memberships) are reached
-- only through the authorization layer. Content tables carry tenant_id and are guarded by
-- row-level security keyed on the transaction-local setting app.tenant_id, so a query that escaped
-- the application's scoping still returns nothing from another tenant.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---- Directory -------------------------------------------------------------------------------

CREATE TABLE accounts (
  account_id        text PRIMARY KEY,
  email             text NOT NULL,
  display_name      text NOT NULL,
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX accounts_email ON accounts (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE sessions (
  session_hash text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text
);
CREATE INDEX sessions_account ON sessions (account_id);

CREATE TABLE email_tokens (
  token_hash text PRIMARY KEY,
  email      text NOT NULL,
  purpose    text NOT NULL,
  redirect   text,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personal_access_tokens (
  token_id     text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE TABLE oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text NOT NULL,
  redirect_uris jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES oauth_clients,
  account_id     text NOT NULL REFERENCES accounts,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  resource       text NOT NULL,
  scope          text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);

CREATE TABLE oauth_tokens (
  token_hash   text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id    text NOT NULL REFERENCES oauth_clients,
  account_id   text NOT NULL REFERENCES accounts,
  resource     text NOT NULL,
  scope        text NOT NULL,
  family_id    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX oauth_tokens_family ON oauth_tokens (family_id);

CREATE TABLE tenants (
  tenant_id  text PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  plan       text NOT NULL DEFAULT 'free',
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL
);

CREATE TABLE teams (
  team_id     text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants,
  slug        text NOT NULL,
  name        text NOT NULL,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  jsonb NOT NULL,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE products (
  product_id  text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants,
  team_id     text NOT NULL REFERENCES teams,
  slug        text NOT NULL,
  name        text NOT NULL,
  idea        text NOT NULL DEFAULT '',
  archived_at timestamptz,
  etag        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  jsonb NOT NULL,
  UNIQUE (team_id, slug)
);

CREATE TABLE memberships (
  membership_id text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants,
  scope_type    text NOT NULL CHECK (scope_type IN ('tenant', 'team', 'product')),
  scope_id      text NOT NULL,
  account_id    text NOT NULL REFERENCES accounts,
  role          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    jsonb NOT NULL,
  UNIQUE (scope_type, scope_id, account_id)
);
CREATE INDEX memberships_account ON memberships (account_id);

CREATE TABLE invitations (
  invitation_id text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants,
  scope_type    text NOT NULL,
  scope_id      text NOT NULL,
  email         text NOT NULL,
  role          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    jsonb NOT NULL
);

-- The job queue: claimed with SELECT … FOR UPDATE SKIP LOCKED. No broker to run.
CREATE TABLE jobs (
  job_id     bigserial PRIMARY KEY,
  tenant_id  text NOT NULL,
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  run_after  timestamptz NOT NULL DEFAULT now(),
  attempts   integer NOT NULL DEFAULT 0,
  locked_at  timestamptz,
  locked_by  text,
  done_at    timestamptz,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready ON jobs (run_after) WHERE done_at IS NULL;

-- Write-only from both front doors; operators read it directly.
CREATE TABLE feedback (
  feedback_id    text PRIMARY KEY,
  tenant_id      text,
  category       text NOT NULL,
  message        text NOT NULL,
  tool           text,
  details        text,
  server_version text NOT NULL,
  submitted_by   jsonb NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- Content ---------------------------------------------------------------------------------

CREATE TABLE records (
  record_id             text PRIMARY KEY,
  tenant_id             text NOT NULL,
  team_id               text NOT NULL,
  product_id            text NOT NULL REFERENCES products,
  kind                  text NOT NULL,
  title                 text NOT NULL,
  date                  date,
  organization          text,
  participants          text[] NOT NULL DEFAULT '{}',
  source_system         text,
  tags                  text[] NOT NULL DEFAULT '{}',
  related_records       text[] NOT NULL DEFAULT '{}',
  dimensions            jsonb NOT NULL DEFAULT '{}',
  provenance_depth      text NOT NULL DEFAULT 'unknown',
  folder                text NOT NULL,
  slug                  text NOT NULL,
  copied_from           jsonb,
  current_derivation_id text,
  archived_at           timestamptz,
  archived_by           jsonb,
  etag                  text NOT NULL,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  uploaded_by           jsonb NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            jsonb NOT NULL
);
CREATE INDEX records_product ON records (product_id, record_id DESC);
CREATE INDEX records_title_trgm ON records USING gin (title gin_trgm_ops);
CREATE INDEX records_tags ON records USING gin (tags);

CREATE TABLE files (
  file_id            text PRIMARY KEY,
  tenant_id          text NOT NULL,
  record_id          text NOT NULL REFERENCES records ON DELETE CASCADE,
  path               text NOT NULL,
  role               text NOT NULL CHECK (role IN ('primary', 'origin', 'supplement')),
  current_version_id text,
  derived_from       text[] NOT NULL DEFAULT '{}',
  derivation_note    text,
  derived_by         text,
  added_at           timestamptz NOT NULL DEFAULT now(),
  added_by           jsonb NOT NULL,
  role_changed_at    timestamptz,
  role_changed_by    jsonb,
  UNIQUE (record_id, path)
);
-- Exactly one primary per record.
CREATE UNIQUE INDEX files_one_primary ON files (record_id) WHERE role = 'primary';

CREATE TABLE file_versions (
  file_version_id text PRIMARY KEY,
  tenant_id       text NOT NULL,
  record_id       text NOT NULL REFERENCES records ON DELETE CASCADE,
  file_id         text NOT NULL REFERENCES files ON DELETE CASCADE,
  blob_key        text NOT NULL,
  size            bigint NOT NULL,
  sha256          text NOT NULL,
  media_type      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      jsonb NOT NULL
);

CREATE TABLE upload_grants (
  grant_id        text PRIMARY KEY,
  tenant_id       text NOT NULL,
  product_id      text NOT NULL,
  record_id       text NOT NULL REFERENCES records ON DELETE CASCADE,
  path            text NOT NULL,
  role            text NOT NULL,
  media_type      text,
  max_bytes       bigint NOT NULL,
  derived_from    text[] NOT NULL DEFAULT '{}',
  derivation_note text,
  derived_by      text,
  principal       jsonb NOT NULL,
  expires_at      timestamptz NOT NULL,
  uploaded_at     timestamptz,
  blob_key        text,
  size            bigint,
  sha256          text,
  sniffed_type    text,
  completed_at    timestamptz,
  file_version_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upload_grants_record ON upload_grants (record_id);

CREATE TABLE derivations (
  derivation_id   text PRIMARY KEY,
  tenant_id       text NOT NULL,
  record_id       text NOT NULL REFERENCES records ON DELETE CASCADE,
  file_version_id text NOT NULL,
  source_path     text NOT NULL,
  status          text NOT NULL,
  status_detail   text,
  parser          text NOT NULL,
  parser_version  text NOT NULL,
  segment_count   integer NOT NULL,
  text_chars      integer NOT NULL,
  duration_ms     bigint,
  facts           jsonb NOT NULL DEFAULT '{}',
  blob_prefix     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX derivations_record ON derivations (record_id, derivation_id DESC);

CREATE TABLE segments (
  tenant_id     text NOT NULL,
  record_id     text NOT NULL REFERENCES records ON DELETE CASCADE,
  derivation_id text NOT NULL REFERENCES derivations ON DELETE CASCADE,
  seq           integer NOT NULL,
  text          text NOT NULL,
  speaker       text,
  start_ms      bigint,
  end_ms        bigint,
  char_start    integer NOT NULL,
  char_end      integer NOT NULL,
  heading_level smallint,
  page          integer,
  is_current    boolean NOT NULL DEFAULT false,
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  PRIMARY KEY (derivation_id, seq)
);
CREATE INDEX segments_current ON segments (record_id, seq) WHERE is_current;
CREATE INDEX segments_tsv ON segments USING gin (tsv) WHERE is_current;
CREATE INDEX segments_trgm ON segments USING gin (text gin_trgm_ops) WHERE is_current;

CREATE TABLE annotations (
  annotation_id text PRIMARY KEY,
  tenant_id     text NOT NULL,
  product_id    text NOT NULL,
  record_id     text NOT NULL REFERENCES records ON DELETE CASCADE,
  seq_start     integer,
  seq_end       integer,
  note          text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  anchor        jsonb,
  archived_at   timestamptz,
  etag          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    jsonb NOT NULL
);
CREATE INDEX annotations_record ON annotations (record_id);

CREATE TABLE agent_notes (
  record_id  text NOT NULL REFERENCES records ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('summary', 'outline', 'notes')),
  tenant_id  text NOT NULL,
  content    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb NOT NULL,
  PRIMARY KEY (record_id, kind)
);

CREATE TABLE objectives (
  objective_id text PRIMARY KEY,
  tenant_id    text NOT NULL,
  product_id   text NOT NULL REFERENCES products,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'active',
  position     double precision NOT NULL,
  etag         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   jsonb NOT NULL
);
CREATE INDEX objectives_product ON objectives (product_id, position);

CREATE TABLE insights (
  insight_id text PRIMARY KEY,
  tenant_id  text NOT NULL,
  product_id text NOT NULL REFERENCES products,
  title      text NOT NULL,
  summary    text NOT NULL DEFAULT '',
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'draft',
  refs       jsonb NOT NULL,
  revision   integer NOT NULL DEFAULT 1,
  etag       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb NOT NULL,
  tsv        tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', title || ' ' || summary || ' ' || body)) STORED
);
CREATE INDEX insights_product ON insights (product_id, insight_id DESC);
CREATE INDEX insights_tsv ON insights USING gin (tsv);

-- The previous text of an authored body, kept whenever that body is overwritten.
CREATE TABLE revisions (
  revision_id text PRIMARY KEY,
  tenant_id   text NOT NULL,
  object_type text NOT NULL,
  object_id   text NOT NULL,
  n           integer NOT NULL,
  content     jsonb NOT NULL,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  replaced_by jsonb NOT NULL,
  written_at  timestamptz NOT NULL,
  written_by  jsonb NOT NULL,
  UNIQUE (object_type, object_id, n)
);

CREATE TABLE register_entries (
  entry_id         text PRIMARY KEY,
  tenant_id        text NOT NULL,
  product_id       text NOT NULL REFERENCES products,
  kind             text NOT NULL CHECK (kind IN ('assumption', 'decision')),
  statement        text NOT NULL,
  body             text NOT NULL DEFAULT '',
  citations        jsonb NOT NULL,
  links            jsonb NOT NULL DEFAULT '[]',
  objective_ids    text[] NOT NULL DEFAULT '{}',
  tags             text[] NOT NULL DEFAULT '{}',
  dimensions       jsonb NOT NULL DEFAULT '{}',
  provenance_depth text NOT NULL DEFAULT 'unknown',
  author           jsonb NOT NULL,
  author_type      text NOT NULL,
  status           text NOT NULL DEFAULT 'unconfirmed',
  review_count     integer NOT NULL DEFAULT 0,
  archived_at      timestamptz,
  etag             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       jsonb NOT NULL,
  tsv              tsvector GENERATED ALWAYS AS (to_tsvector('simple', statement || ' ' || body)) STORED
);
CREATE INDEX register_entries_product ON register_entries (product_id, kind, entry_id DESC);
CREATE INDEX register_entries_tsv ON register_entries USING gin (tsv);

CREATE TABLE reviews (
  review_id     text PRIMARY KEY,
  tenant_id     text NOT NULL,
  entry_id      text NOT NULL REFERENCES register_entries ON DELETE CASCADE,
  status        text NOT NULL,
  note          text NOT NULL,
  reviewer      jsonb NOT NULL,
  reviewer_type text NOT NULL,
  confidence    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_entry ON reviews (entry_id, review_id DESC);

CREATE TABLE story_pages (
  tenant_id          text NOT NULL,
  product_id         text NOT NULL REFERENCES products,
  page_id            text NOT NULL,
  title              text NOT NULL,
  summary            text NOT NULL DEFAULT '',
  current_version_id text NOT NULL,
  version_count      integer NOT NULL,
  archived_at        timestamptz,
  etag               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         jsonb NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         jsonb NOT NULL,
  PRIMARY KEY (product_id, page_id)
);

CREATE TABLE story_versions (
  version_id          text PRIMARY KEY,
  tenant_id           text NOT NULL,
  product_id          text NOT NULL,
  page_id             text NOT NULL,
  n                   integer NOT NULL,
  title               text NOT NULL,
  summary             text NOT NULL DEFAULT '',
  html                text NOT NULL,
  note                text NOT NULL DEFAULT '',
  refs                jsonb NOT NULL,
  previous_version_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          jsonb NOT NULL,
  UNIQUE (product_id, page_id, n)
);

CREATE TABLE story_hierarchies (
  product_id text PRIMARY KEY REFERENCES products,
  tenant_id  text NOT NULL,
  items      jsonb NOT NULL,
  etag       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb NOT NULL
);

CREATE TABLE lineage (
  record_id    text PRIMARY KEY REFERENCES records ON DELETE CASCADE,
  tenant_id    text NOT NULL,
  product_id   text NOT NULL,
  inputs       jsonb NOT NULL,
  query_spec   jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by jsonb NOT NULL
);

-- Append-only. Never holds content: summaries name objects, they do not quote them.
CREATE TABLE activity (
  activity_id      text PRIMARY KEY,
  tenant_id        text NOT NULL,
  team_id          text,
  product_id       text,
  occurred_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor            jsonb NOT NULL,
  actor_account_id text NOT NULL,
  channel          text,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text,
  entity_title     text,
  summary          text NOT NULL
);
CREATE INDEX activity_product ON activity (product_id, activity_id DESC);
CREATE INDEX activity_entity ON activity (entity_id, activity_id DESC);

CREATE TABLE tombstones (
  tenant_id   text NOT NULL,
  product_id  text NOT NULL,
  object_type text NOT NULL,
  object_id   text PRIMARY KEY,
  title       text NOT NULL,
  reason      text NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  deleted_by  jsonb NOT NULL
);

-- ---- Row-level security ----------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'records', 'files', 'file_versions', 'upload_grants', 'derivations', 'segments', 'annotations',
    'agent_notes', 'objectives', 'insights', 'revisions', 'register_entries', 'reviews',
    'story_pages', 'story_versions', 'story_hierarchies', 'lineage', 'activity', 'tombstones'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
