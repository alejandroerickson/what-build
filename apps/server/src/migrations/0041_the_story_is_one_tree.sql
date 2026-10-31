-- The Story is one tree. A page that shows a mockup page, or a mockup's whole canvas, is placed and
-- moved like any other page, so the Published mockups are no longer a section of their own.
--
-- Each product's Published mockups go to the end of its tree, in the order readers flipped through
-- them: the section's saved order, then the rest as their current versions were published. A page
-- the tree already names stays where it is, which is where it would have gone back to anyway. A
-- product whose tree was never saved gets one here, holding only them, so they keep that order; its
-- other pages stay unplaced, at the end of the tree.
--
-- Row-level security hides every row unless app.tenant_id is set, so the rows are rewritten once
-- per tenant.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    WITH moving AS (
      SELECT p.product_id, p.tenant_id, p.page_id, v.created_at, v.created_by,
             (SELECT min(o.n) FROM jsonb_array_elements_text(h.mockups) WITH ORDINALITY AS o(page_id, n) WHERE o.page_id = p.page_id) AS saved_at
      FROM story_pages p
      JOIN story_versions v ON v.version_id = p.current_version_id
      LEFT JOIN story_hierarchies h ON h.product_id = p.product_id
      WHERE p.archived_at IS NULL
        AND v.mockup IS NOT NULL
        AND NOT coalesce(jsonb_path_exists(h.items, '$.** ? (@.page_id == $id)', jsonb_build_object('id', p.page_id)), false)
    ), appended AS (
      SELECT product_id, tenant_id,
             jsonb_agg(jsonb_build_object('page_id', page_id, 'children', '[]'::jsonb) ORDER BY saved_at NULLS LAST, created_at, page_id) AS nodes,
             (array_agg(created_by ORDER BY created_at DESC))[1] AS actor
      FROM moving
      GROUP BY product_id, tenant_id
    )
    INSERT INTO story_hierarchies (product_id, tenant_id, items, etag, updated_by)
    SELECT product_id, tenant_id, nodes, md5(random()::text || clock_timestamp()::text), actor FROM appended
    ON CONFLICT (product_id) DO UPDATE SET items = story_hierarchies.items || EXCLUDED.items, etag = EXCLUDED.etag;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

ALTER TABLE story_hierarchies DROP COLUMN mockups;
