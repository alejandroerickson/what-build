-- A document story.preview made: what story.publish would store for the same call, held for the
-- preview's grant to GET until it expires. Nothing else reads it and nothing points at it. A
-- product keeps its newest few, and the worker drops expired ones.
CREATE TABLE story_previews (
  preview_id   text PRIMARY KEY,
  tenant_id    text NOT NULL,
  product_id   text NOT NULL,
  page_id      text NOT NULL,
  html         text NOT NULL,
  shows_mockup boolean NOT NULL DEFAULT false,
  created_by   jsonb NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX story_previews_product ON story_previews (product_id, created_at);

ALTER TABLE story_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON story_previews USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
