-- An organization's owners, and an instance's owners, rename it and change its slug
-- (products.rename_tenant). Its name and slug get an etag of their own, as its limits have, so a
-- change over one made since they were read is refused (409 stale_etag). Every organization gets
-- one here, and the default gives one to any row written without it.
ALTER TABLE tenants ADD COLUMN name_etag text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);

-- The slugs an organization had before its current one. An address that names one still reaches
-- the organization, so a link, a bookmark or a connected agent keeps working after its slug
-- changes. No two organizations share a slug, current or former: the application checks both
-- tables under one lock. Directory table: read before a transaction is scoped to an organization,
-- as tenants is, so it sits outside row-level security. Deleting the organization frees them.
CREATE TABLE tenant_slugs (
  slug       text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants ON DELETE CASCADE,
  retired_at timestamptz NOT NULL DEFAULT now(),
  retired_by jsonb NOT NULL
);
CREATE INDEX tenant_slugs_tenant ON tenant_slugs (tenant_id);
