-- A public sandbox: one organization, named by the deployment, that invited visitors work in. Its
-- content is put back to a saved baseline on a schedule, and what visitors do is limited.

-- Set by the server at start-up from WHATBUILD_SANDBOX_TENANT. A visitor's grant counts only while
-- this is true, so taking the setting away closes the sandbox to visitors.
ALTER TABLE tenants ADD COLUMN sandbox boolean NOT NULL DEFAULT false;

-- An account created on the strength of a sandbox invitation alone. It cannot create an
-- organization while sign-up is limited and nobody has given it a role outside a sandbox.
ALTER TABLE accounts ADD COLUMN sandbox_only boolean NOT NULL DEFAULT false;

-- ---- Directory and operational tables (no row-level security, like tenants and jobs) -----------

-- One row per sandbox: its switches, schedule and limits (validated by the application), the
-- baseline a reset restores, and what the last reset did.
CREATE TABLE sandbox_settings (
  tenant_id     text PRIMARY KEY REFERENCES tenants,
  settings      jsonb NOT NULL DEFAULT '{}',
  baseline_id   text,
  last_reset_at timestamptz,
  last_reset    jsonb,
  etag          text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    jsonb
);

-- An invitation to the sandbox: a link that admits up to max_uses people. Looked up by its code
-- before the caller belongs to anything, so it sits beside invitations, outside row-level security.
CREATE TABLE sandbox_invites (
  invite_id  text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants,
  code_hash  text NOT NULL UNIQUE,
  label      text NOT NULL,
  max_uses   integer NOT NULL CHECK (max_uses > 0),
  used       integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL
);
CREATE INDEX sandbox_invites_tenant ON sandbox_invites (tenant_id, invite_id DESC);

-- Counters behind the limits: per visitor, and per organization under account_id ''. A minute
-- bucket starts on the minute; a day bucket starts at the sandbox's last scheduled reset.
CREATE TABLE sandbox_usage (
  tenant_id  text NOT NULL,
  account_id text NOT NULL,
  bucket     text NOT NULL CHECK (bucket IN ('minute', 'day')),
  starts_at  timestamptz NOT NULL,
  counter    text NOT NULL,
  n          bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, account_id, bucket, starts_at, counter)
);

-- ---- Content (row-level security) -------------------------------------------------------------

CREATE TABLE sandbox_baselines (
  baseline_id text PRIMARY KEY,
  tenant_id   text NOT NULL,
  note        text NOT NULL DEFAULT '',
  counts      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  jsonb NOT NULL
);
CREATE INDEX sandbox_baselines_tenant ON sandbox_baselines (tenant_id, baseline_id DESC);

-- A baseline holds each row as JSON, so a table's later columns need no change here. Blobs are
-- immutable and are referenced, not copied.
CREATE TABLE sandbox_baseline_rows (
  baseline_id text NOT NULL REFERENCES sandbox_baselines ON DELETE CASCADE,
  tenant_id   text NOT NULL,
  table_name  text NOT NULL,
  row         jsonb NOT NULL
);
CREATE INDEX sandbox_baseline_rows_table ON sandbox_baseline_rows (baseline_id, table_name);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sandbox_baselines', 'sandbox_baseline_rows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
