-- Grants to upload a mockup version as a ZIP, so a canvas's pages and files reach the server through
-- the upload relay rather than through a tool call. A grant belongs to the product and the account
-- that asked for it, and to one mockup (or to a new one when mockup_id is null). The bytes sit in
-- object storage under blob_key until publish reads them once and marks the grant used; the worker
-- deletes a grant and its bytes a day after it expires, used or not.
CREATE TABLE mockup_uploads (
  upload_id   text PRIMARY KEY,
  tenant_id   text NOT NULL,
  product_id  text NOT NULL,
  mockup_id   text REFERENCES mockups,
  principal   jsonb NOT NULL,
  max_bytes   bigint NOT NULL,
  blob_key    text NOT NULL,
  expires_at  timestamptz NOT NULL,
  uploaded_at timestamptz,
  size        bigint,
  sha256      text,
  used_at     timestamptz,
  version_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mockup_uploads_expiry ON mockup_uploads (expires_at);

ALTER TABLE mockup_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mockup_uploads USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
