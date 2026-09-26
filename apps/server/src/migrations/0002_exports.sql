-- Product exports: built by the worker, downloadable for seven days.
CREATE TABLE exports (
  export_id    text PRIMARY KEY,
  tenant_id    text NOT NULL,
  product_id   text NOT NULL REFERENCES products,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  blob_key     text,
  size         bigint,
  file_count   integer,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   jsonb NOT NULL,
  completed_at timestamptz,
  expires_at   timestamptz NOT NULL
);
CREATE INDEX exports_product ON exports (product_id, export_id DESC);
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exports USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
