-- An outcome is current or archived, archived the way a source, an assumption or a mockup is: by
-- archived_at. Its status goes. An archived outcome keeps the time it was last changed as the time
-- it was archived; an achieved one becomes current, as it already showed among the current ones.
-- Public sandbox baselines hold outcomes as JSON, so their saved rows are rewritten the same way and
-- a reset puts back the archived ones archived.
--
-- Row-level security hides every row unless app.tenant_id is set, so the rewrite runs once per tenant.
ALTER TABLE outcomes ADD COLUMN archived_at timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE outcomes SET archived_at = updated_at WHERE status = 'archived';
    UPDATE sandbox_baseline_rows
      SET row = (row - 'status') || jsonb_build_object('archived_at', CASE WHEN row->>'status' = 'archived' THEN row->'updated_at' ELSE 'null'::jsonb END)
      WHERE table_name = 'outcomes';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

ALTER TABLE outcomes DROP COLUMN status;
