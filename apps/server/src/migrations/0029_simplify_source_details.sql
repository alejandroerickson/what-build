-- A source is described by its title, its date captured and its tags. Its participants, the system
-- it came from (source_system) and its provenance are dropped, as is an assumption's provenance,
-- and the values are kept nowhere else. A comment is on a whole source: the segment range and the
-- anchor an annotation held are dropped, and its text is kept. The agent outline of a source goes;
-- its summary and notes stay.
--
-- Public sandbox baselines hold rows as JSON, so their saved rows lose the same fields, and their
-- saved agent outlines go.
--
-- Row-level security hides every row unless app.tenant_id is set, so the rows are rewritten once
-- per tenant.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE sandbox_baseline_rows SET row = row - 'participants' - 'source_system' - 'provenance_depth'
      WHERE table_name = 'records' AND (row ? 'participants' OR row ? 'source_system' OR row ? 'provenance_depth');
    UPDATE sandbox_baseline_rows SET row = row - 'provenance_depth'
      WHERE table_name = 'register_entries' AND row ? 'provenance_depth';
    UPDATE sandbox_baseline_rows SET row = row - 'seq_start' - 'seq_end' - 'anchor'
      WHERE table_name = 'annotations' AND (row ? 'seq_start' OR row ? 'seq_end' OR row ? 'anchor');
    DELETE FROM sandbox_baseline_rows WHERE table_name = 'agent_notes' AND row->>'kind' = 'outline';
    DELETE FROM agent_notes WHERE kind = 'outline';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

ALTER TABLE records DROP COLUMN participants, DROP COLUMN source_system, DROP COLUMN provenance_depth;
ALTER TABLE register_entries DROP COLUMN provenance_depth;
ALTER TABLE annotations DROP COLUMN seq_start, DROP COLUMN seq_end, DROP COLUMN anchor;
ALTER TABLE agent_notes DROP CONSTRAINT agent_notes_kind_check;
ALTER TABLE agent_notes ADD CONSTRAINT agent_notes_kind_check CHECK (kind IN ('summary', 'notes'));
