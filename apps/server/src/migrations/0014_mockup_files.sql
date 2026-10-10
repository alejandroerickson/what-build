-- Files a mockup version carries for collaborators to pull into their own projects: design notes
-- such as DESIGN.md, components, tokens. Text only, never used to draw a page. Like the pages,
-- they belong to one version and are immutable once published.
CREATE TABLE mockup_files (
  version_id text NOT NULL REFERENCES mockup_versions,
  tenant_id  text NOT NULL,
  product_id text NOT NULL,
  path       text NOT NULL,
  content    text NOT NULL,
  PRIMARY KEY (version_id, path)
);

ALTER TABLE mockup_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mockup_files USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
