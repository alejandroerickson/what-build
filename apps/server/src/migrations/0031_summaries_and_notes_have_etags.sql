-- A source's summary and its notes each get an etag of their own, as its derived text has, so a
-- write over one that changed since it was read is refused (409 stale_etag) instead of replacing
-- it unseen. Every summary and note already written gets an etag of its own here.
--
-- Public sandbox baselines hold rows as JSON, so their saved summaries and notes get one too, and
-- a reset puts each back with the etag it was saved with. The column's default gives one to any
-- row written without it.
--
-- Row-level security hides every row unless app.tenant_id is set, so the saved rows are rewritten
-- once per tenant. The table keeps its policy as it is.

ALTER TABLE agent_notes ADD COLUMN etag text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE sandbox_baseline_rows SET row = row || jsonb_build_object('etag', md5(random()::text || clock_timestamp()::text))
      WHERE table_name = 'agent_notes' AND NOT row ? 'etag';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
