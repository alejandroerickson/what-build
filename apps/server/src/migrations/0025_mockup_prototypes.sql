-- A mockup version may carry a prototype: a team's multi-file prototype as it is, whose canvas
-- pages are entries into it. A page is either its own document (html) or an entry (a path in the
-- prototype, with a query and a fragment if wanted), never both. The prototype's files are rows of
-- their version, as a version's pages and files are, and their bytes are blobs under the tenant's
-- folder, keyed by the upload that brought them and their SHA-256, never by their paths.
ALTER TABLE mockup_pages ALTER COLUMN html DROP NOT NULL;
ALTER TABLE mockup_pages ADD COLUMN entry text;
ALTER TABLE mockup_pages ADD COLUMN poster text;
ALTER TABLE mockup_pages ADD CONSTRAINT mockup_pages_html_or_entry CHECK ((html IS NULL) <> (entry IS NULL));

CREATE TABLE mockup_prototype_files (
  version_id text NOT NULL REFERENCES mockup_versions,
  tenant_id  text NOT NULL,
  product_id text NOT NULL,
  path       text NOT NULL,
  size       integer NOT NULL,
  sha256     text NOT NULL,
  media_type text NOT NULL,
  blob_key   text NOT NULL,
  PRIMARY KEY (version_id, path)
);
CREATE INDEX mockup_prototype_files_product ON mockup_prototype_files (product_id, blob_key);

ALTER TABLE mockup_prototype_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_prototype_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mockup_prototype_files USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
