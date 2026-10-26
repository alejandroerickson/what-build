-- An organization's owners, and an instance's owners, rename it (products.rename_tenant); its slug,
-- in every address, stays. The name gets an etag of its own, as its limits have, so a rename over
-- one made since the name was read is refused (409 stale_etag). Every organization gets one here,
-- and the default gives one to any row written without it.
ALTER TABLE tenants ADD COLUMN name_etag text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);
