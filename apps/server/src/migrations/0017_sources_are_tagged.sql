-- Sources are described by tags. The closed list of kinds, the logical folder derived from it and
-- the organization field are gone: each source's kind becomes a tag naming what the material is
-- (an interview, a deck, an analysis; "other" adds none), and its organization becomes a tag as
-- well, written as the service writes every tag: lower-case, spacing collapsed, and NFKC-normalized
-- where the database is UTF-8. Both go in front of the tags it already has, without repeats,
-- keeping at most 50. Public sandbox baselines hold sources as JSON, so their saved rows are
-- rewritten the same way and a reset puts back tagged sources.
--
-- A view's lineage fingerprints each input source over its kind and organization among the rest.
-- Lineage written since parts were stored is checked part by part, so dropping those parts changes
-- nothing. An input written before then is checked whole, so each such input keeps the kind and
-- organization it had (`was`), and the check fingerprints it as it was fingerprinted then. Saved
-- baselines get the same, from the source rows they hold, before those rows lose their kind.
--
-- Row-level security hides every row unless app.tenant_id is set, so all of it runs once per tenant.
CREATE FUNCTION tags_from_kind_0017(kind text, organization text, tags text[]) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT ARRAY(
    SELECT t FROM (
      SELECT t, min(n) AS n
      FROM unnest(
        ARRAY[
          CASE kind
            WHEN 'interview_transcript' THEN 'interview'
            WHEN 'interview_recording' THEN 'interview'
            WHEN 'interviewer_notes' THEN 'interview'
            WHEN 'sales_call_recording' THEN 'sales'
            WHEN 'sales_call_transcript' THEN 'sales'
            WHEN 'user_research_export' THEN 'research'
            WHEN 'usability_session_notes' THEN 'usability'
            WHEN 'wiki_export' THEN 'wiki'
            WHEN 'prd' THEN 'prd'
            WHEN 'deck' THEN 'deck'
            WHEN 'contract_sow' THEN 'contract'
            WHEN 'rfp' THEN 'rfp'
            WHEN 'analysis' THEN 'analysis'
            WHEN 'digest' THEN 'digest'
            WHEN 'view' THEN 'view'
            WHEN 'design_insight' THEN 'design'
          END,
          btrim(left(lower(btrim(regexp_replace(
            CASE WHEN current_setting('server_encoding') = 'UTF8' THEN normalize(coalesce(organization, ''), NFKC) ELSE coalesce(organization, '') END,
            '\s+', ' ', 'g'))), 50))
        ] || coalesce(tags, '{}')
      ) WITH ORDINALITY AS u(t, n)
      WHERE t IS NOT NULL AND t <> ''
      GROUP BY t
    ) x
    ORDER BY n
    LIMIT 50
  )
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE lineage l SET inputs = (
      SELECT jsonb_agg(CASE WHEN r.record_id IS NULL THEN e.i
        ELSE e.i || jsonb_build_object('was', jsonb_build_object('kind', r.kind, 'organization', r.organization)) END ORDER BY e.n)
      FROM jsonb_array_elements(l.inputs) WITH ORDINALITY AS e(i, n)
      LEFT JOIN records r ON e.i->>'kind' = 'record' AND NOT (e.i ? 'parts') AND r.record_id = e.i->>'id')
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(l.inputs) x WHERE x->>'kind' = 'record' AND NOT (x ? 'parts'));
    UPDATE sandbox_baseline_rows b SET row = jsonb_set(b.row, '{inputs}', (
      SELECT jsonb_agg(CASE WHEN r.row IS NULL THEN e.i
        ELSE e.i || jsonb_build_object('was', jsonb_build_object('kind', r.row->>'kind', 'organization', r.row->'organization')) END ORDER BY e.n)
      FROM jsonb_array_elements(b.row->'inputs') WITH ORDINALITY AS e(i, n)
      LEFT JOIN sandbox_baseline_rows r ON r.baseline_id = b.baseline_id AND r.table_name = 'records'
        AND e.i->>'kind' = 'record' AND NOT (e.i ? 'parts') AND r.row->>'record_id' = e.i->>'id'))
    WHERE b.table_name = 'lineage'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.row->'inputs') x WHERE x->>'kind' = 'record' AND NOT (x ? 'parts'));
    UPDATE records SET tags = tags_from_kind_0017(kind, organization, tags);
    UPDATE sandbox_baseline_rows
      SET row = (row - 'kind' - 'organization' - 'folder') || jsonb_build_object('tags', to_jsonb(tags_from_kind_0017(
        row->>'kind',
        row->>'organization',
        ARRAY(SELECT jsonb_array_elements_text(coalesce(row->'tags', '[]'::jsonb)))
      )))
      WHERE table_name = 'records';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

DROP FUNCTION tags_from_kind_0017(text, text, text[]);

ALTER TABLE records DROP COLUMN kind, DROP COLUMN organization, DROP COLUMN folder;
