-- Insights and decisions are retired: each one becomes a Markdown source in Evidence with the same
-- id, and what pointed at it points at the source. The text goes to object storage, which only the
-- worker reaches, so this queues one move_to_evidence job per product that holds any; the worker
-- writes the sources, rewrites the references and deletes the originals
-- (packages/core/src/evidence-move.ts). Row-level security hides every row unless app.tenant_id is
-- set, so the queueing runs once per tenant.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    INSERT INTO jobs (tenant_id, kind, payload)
      SELECT t, 'move_to_evidence', jsonb_build_object('product_id', p.product_id)
      FROM (SELECT product_id FROM insights UNION SELECT product_id FROM register_entries WHERE kind = 'decision') p
      ORDER BY p.product_id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
