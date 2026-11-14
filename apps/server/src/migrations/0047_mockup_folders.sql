-- A product's mockups are arranged by hand: each sits in one folder or in none, folders are one
-- level deep, and both the folders and the mockups in each keep the order they are given.
CREATE TABLE mockup_folders (
  folder_id  text PRIMARY KEY,
  tenant_id  text NOT NULL,
  product_id text NOT NULL REFERENCES products,
  name       text NOT NULL,
  position   integer NOT NULL,
  etag       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb NOT NULL
);
CREATE INDEX mockup_folders_product ON mockup_folders (product_id, position);
-- A folder is named once in a product, whatever its capitals.
CREATE UNIQUE INDEX mockup_folders_name ON mockup_folders (product_id, lower(name));

ALTER TABLE mockup_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE mockup_folders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mockup_folders USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mockups ADD COLUMN folder_id text REFERENCES mockup_folders;
ALTER TABLE mockups ADD COLUMN position integer NOT NULL DEFAULT 0;
CREATE INDEX mockups_folder ON mockups (folder_id) WHERE folder_id IS NOT NULL;

-- Every mockup starts in no folder, in the order the list showed them until now: most recently
-- changed first. Row-level security hides every row unless app.tenant_id is set, so the rows are
-- rewritten once per tenant.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE mockups m
    SET position = o.n
    FROM (SELECT mockup_id, row_number() OVER (PARTITION BY product_id ORDER BY updated_at DESC, mockup_id DESC) AS n FROM mockups) o
    WHERE o.mockup_id = m.mockup_id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
