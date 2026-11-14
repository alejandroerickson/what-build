-- Assumptions are removed: WhatBuild no longer keeps them. Every assumption in every product goes,
-- with its reviews (deleted with it, ON DELETE CASCADE), its earlier wordings, its entries in the
-- activity log and the tombstones of the ones deleted before. Nothing else points at an assumption:
-- an outcome is named by an assumption, never the other way round, and a Story page that linked to
-- one keeps its HTML, whose link now opens Exploration.
--
-- register_entries and reviews stay, as insights does, for the decisions still waiting for the
-- worker to move them into Evidence with their reviews (packages/core/src/evidence-move.ts).
--
-- Row-level security hides every row unless app.tenant_id is set, so the deleting runs once per tenant.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    DELETE FROM revisions WHERE object_type = 'assumption';
    DELETE FROM activity WHERE entity_type = 'assumption';
    DELETE FROM tombstones WHERE object_type = 'assumption';
    DELETE FROM register_entries WHERE kind = 'assumption';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

ALTER TABLE register_entries DROP CONSTRAINT register_entries_kind_check;
ALTER TABLE register_entries ADD CONSTRAINT register_entries_kind_check CHECK (kind = 'decision');
