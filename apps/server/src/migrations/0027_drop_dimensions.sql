-- Sources and assumptions have no dimensions. The customer, product area and lifecycle stage each
-- held are dropped, not kept anywhere else. Public sandbox baselines hold rows as JSON, so their
-- saved sources and register entries lose the field as well.
--
-- No lineage fingerprint covers dimensions, so views' lineage is left as it is.
--
-- Row-level security hides every row unless app.tenant_id is set, so the baselines are rewritten
-- once per tenant.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    UPDATE sandbox_baseline_rows SET row = row - 'dimensions'
      WHERE table_name IN ('records', 'register_entries') AND row ? 'dimensions';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

ALTER TABLE records DROP COLUMN dimensions;
ALTER TABLE register_entries DROP COLUMN dimensions;
