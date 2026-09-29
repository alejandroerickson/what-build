-- A product's Story style: the design system its Story pages follow, either the team's own or a
-- house style adopted for the product. One per product, replaced whole, with its own etag.
CREATE TABLE story_styles (
  product_id    text PRIMARY KEY REFERENCES products,
  tenant_id     text NOT NULL,
  name          text NOT NULL,
  summary       text NOT NULL DEFAULT '',
  based_on      text,
  rules         text NOT NULL,
  stylesheet    text NOT NULL,
  specimen_html text,
  etag          text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    jsonb NOT NULL
);
ALTER TABLE story_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_styles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON story_styles USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
