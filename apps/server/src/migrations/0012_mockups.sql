-- Mockups: canvases of agent-made HTML pages in Exploration, each with a brief. A version is the
-- whole canvas (brief, pages, notes, refs, citations), immutable once published.
CREATE TABLE mockups (
  mockup_id          text PRIMARY KEY,
  tenant_id          text NOT NULL,
  product_id         text NOT NULL REFERENCES products,
  title              text NOT NULL,
  summary            text NOT NULL DEFAULT '',
  current_version_id text NOT NULL,
  version_count      integer NOT NULL,
  archived_at        timestamptz,
  etag               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         jsonb NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         jsonb NOT NULL
);
CREATE INDEX mockups_product ON mockups (product_id, updated_at DESC);

CREATE TABLE mockup_versions (
  version_id          text PRIMARY KEY,
  tenant_id           text NOT NULL,
  product_id          text NOT NULL,
  mockup_id           text NOT NULL REFERENCES mockups,
  n                   integer NOT NULL,
  title               text NOT NULL,
  summary             text NOT NULL DEFAULT '',
  brief               text NOT NULL DEFAULT '',
  columns             integer,
  refs                jsonb NOT NULL,
  citations           jsonb NOT NULL DEFAULT '[]',
  previous_version_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          jsonb NOT NULL,
  UNIQUE (mockup_id, n)
);

CREATE TABLE mockup_pages (
  version_id  text NOT NULL REFERENCES mockup_versions,
  tenant_id   text NOT NULL,
  product_id  text NOT NULL,
  position    integer NOT NULL,
  page_id     text NOT NULL,
  title       text NOT NULL,
  notes       text NOT NULL DEFAULT '',
  width       integer NOT NULL,
  height      integer NOT NULL,
  html        text NOT NULL,
  PRIMARY KEY (version_id, page_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mockups', 'mockup_versions', 'mockup_pages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;
