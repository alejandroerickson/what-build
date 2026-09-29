-- A product's concept (who it is for, the problem, how it solves it) and its outcomes (what its
-- users should be able to achieve with it) together make up the product's idea.
ALTER TABLE products RENAME COLUMN idea TO concept;

ALTER TABLE objectives RENAME TO outcomes;
ALTER TABLE outcomes RENAME COLUMN objective_id TO outcome_id;
ALTER TABLE outcomes RENAME CONSTRAINT objectives_pkey TO outcomes_pkey;
ALTER TABLE outcomes RENAME CONSTRAINT objectives_product_id_fkey TO outcomes_product_id_fkey;
ALTER INDEX objectives_product RENAME TO outcomes_product;

ALTER TABLE register_entries RENAME COLUMN objective_ids TO outcome_ids;

-- Stored references and history name the outcome too. Row-level security hides every row unless
-- app.tenant_id is set, so the rewrite runs once per tenant.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE insights SET refs = (refs - 'objectives') || jsonb_build_object('outcomes', refs->'objectives')
      WHERE refs ? 'objectives';
    UPDATE story_versions SET refs = (refs - 'objectives') || jsonb_build_object('outcomes', refs->'objectives')
      WHERE refs ? 'objectives';
    UPDATE revisions SET object_type = 'outcome' WHERE object_type = 'objective';
    UPDATE revisions SET content = (content - 'idea') || jsonb_build_object('concept', content->'idea')
      WHERE object_type = 'product' AND content ? 'idea';
    UPDATE tombstones SET object_type = 'outcome' WHERE object_type = 'objective';
    UPDATE activity SET entity_type = 'outcome' WHERE entity_type = 'objective';
    UPDATE activity SET summary = replace(summary, 'objective', 'outcome') WHERE summary LIKE '%objective%';
    UPDATE activity SET summary = regexp_replace(summary, '\midea\M', 'concept', 'g')
      WHERE entity_type = 'product' AND summary ~ '\midea\M';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
