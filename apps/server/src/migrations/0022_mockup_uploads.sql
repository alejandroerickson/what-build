-- A canvas uploaded as a ZIP for mockups.publish to read, so an agent never sends a page's HTML
-- through a tool call. A row is the grant's state: bytes arrive under it once, publish reads them
-- once and the blob goes; the worker drops what was never published a day after it expired.
CREATE TABLE mockup_uploads (
  upload_id   text PRIMARY KEY,
  tenant_id   text NOT NULL,
  product_id  text NOT NULL,
  blob_key    text NOT NULL,
  max_bytes   bigint NOT NULL,
  principal   jsonb NOT NULL,
  expires_at  timestamptz NOT NULL,
  uploaded_at timestamptz,
  size        bigint,
  sha256      text,
  used_at     timestamptz,
  used_by_version_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mockup_uploads_product ON mockup_uploads (product_id);

ALTER TABLE mockup_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mockup_uploads USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
