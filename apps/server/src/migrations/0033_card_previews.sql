-- A front outcomes.card_preview checked: what a write would store, held for the preview's grant to
-- GET, in the document the Idea screen shows it in, until it expires. Nothing else reads it and
-- nothing points at it. A product keeps its newest few, and the worker drops expired ones.
CREATE TABLE card_previews (
  preview_id  text PRIMARY KEY,
  tenant_id   text NOT NULL,
  product_id  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('concept', 'outcome')),
  title       text NOT NULL,
  card_html   text NOT NULL,
  created_by  jsonb NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_previews_product ON card_previews (product_id, created_at);

ALTER TABLE card_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON card_previews USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
