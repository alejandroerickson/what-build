-- Citations are retired, and so is the graph around them: the references a Story page version or a
-- mockup version listed, a view's lineage, and a source's related sources. Agents find what bears on
-- a page or an assumption by searching, and nothing keeps that graph up to date.
--
-- The quotes an assumption cited are the evidence it rests on, so before the column goes each
-- assumption's citations become a list at the end of its body: every quote on one line, at most 500
-- characters, with the title of its source. A decision still waiting to move into Evidence gets the
-- same, so the move writes them into its document. Story page and mockup versions keep their HTML,
-- which holds whatever a page quotes. Kept revisions lose their citations. Public sandbox baselines
-- hold rows as JSON, so their saved rows are rewritten the same way and a reset puts back what this
-- leaves.
--
-- Row-level security hides every row unless app.tenant_id is set, so all of it runs once per tenant.
CREATE FUNCTION passages_cited_0028(body text, cited jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(E'\n\n', nullif(rtrim(body, E' \t\r\n'), ''), E'**Passages cited**\n\n' || string_agg(
    format('- “%s” (%s)',
      CASE WHEN length(q) > 500 THEN rtrim(left(q, 499)) || '…' ELSE q END,
      coalesce(nullif(c->>'title', ''), 'a source no longer in WhatBuild')),
    E'\n' ORDER BY n))
  FROM jsonb_array_elements(cited) WITH ORDINALITY AS x(c, n)
  CROSS JOIN LATERAL (SELECT btrim(regexp_replace(coalesce(c->>'quote', ''), '\s+', ' ', 'g')) AS q) y
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE register_entries e SET
      body = passages_cited_0028(e.body, (
        SELECT jsonb_agg(c || jsonb_build_object('title', coalesce(
          (SELECT r.title FROM records r WHERE r.record_id = c->>'record_id'),
          (SELECT d.title FROM tombstones d WHERE d.object_type = 'source' AND d.object_id = c->>'record_id' LIMIT 1))) ORDER BY n)
        FROM jsonb_array_elements(e.citations) WITH ORDINALITY AS x(c, n))),
      etag = md5(random()::text || clock_timestamp()::text)
    WHERE e.citations->0 IS NOT NULL;
    UPDATE revisions SET content = content - 'citations' WHERE content ? 'citations';

    UPDATE sandbox_baseline_rows b SET row = jsonb_set(b.row, '{body}', to_jsonb(passages_cited_0028(b.row->>'body', (
        SELECT jsonb_agg(c || jsonb_build_object('title', coalesce(
          (SELECT r.row->>'title' FROM sandbox_baseline_rows r WHERE r.baseline_id = b.baseline_id AND r.table_name = 'records' AND r.row->>'record_id' = c->>'record_id' LIMIT 1),
          (SELECT d.row->>'title' FROM sandbox_baseline_rows d WHERE d.baseline_id = b.baseline_id AND d.table_name = 'tombstones' AND d.row->>'object_type' = 'source' AND d.row->>'object_id' = c->>'record_id' LIMIT 1))) ORDER BY n)
        FROM jsonb_array_elements(b.row->'citations') WITH ORDINALITY AS x(c, n)))))
    WHERE b.table_name = 'register_entries' AND b.row->'citations'->0 IS NOT NULL;
    UPDATE sandbox_baseline_rows SET row = row - 'citations' WHERE table_name = 'register_entries' AND row ? 'citations';
    UPDATE sandbox_baseline_rows SET row = row - 'refs' - 'citations' WHERE table_name IN ('story_versions', 'mockup_versions') AND (row ? 'refs' OR row ? 'citations');
    UPDATE sandbox_baseline_rows SET row = row - 'related_records' WHERE table_name = 'records' AND row ? 'related_records';
    UPDATE sandbox_baseline_rows SET row = jsonb_set(row, '{content}', (row->'content') - 'citations') WHERE table_name = 'revisions' AND (row->'content') ? 'citations';
    DELETE FROM sandbox_baseline_rows WHERE table_name = 'lineage';
    UPDATE sandbox_baselines SET counts = counts - 'lineage' WHERE counts ? 'lineage';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

DROP FUNCTION passages_cited_0028(text, jsonb);

ALTER TABLE register_entries DROP COLUMN citations;
ALTER TABLE story_versions DROP COLUMN refs, DROP COLUMN citations;
ALTER TABLE mockup_versions DROP COLUMN refs, DROP COLUMN citations;
ALTER TABLE records DROP COLUMN related_records;
DROP TABLE lineage;
