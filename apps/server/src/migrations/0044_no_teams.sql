-- An organization holds its products directly: there are no teams. A team's role becomes a role on
-- all products, a team admin becomes a product creator, a product's slug becomes unique in its
-- organization, and the address a product had under its team still reaches it.

-- A new id in the form the application gives them (a ULID): ten characters of time, sixteen random.
CREATE FUNCTION ulid_0044() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  id text := '';
BEGIN
  FOR i IN 1..10 LOOP
    id := substr(alphabet, (ms % 32)::int + 1, 1) || id;
    ms := ms / 32;
  END LOOP;
  FOR i IN 1..16 LOOP
    id := id || substr(alphabet, floor(random() * 32)::int + 1, 1);
  END LOOP;
  RETURN id;
END $$;

-- Where a product's slug had to change, its address under its team (organization/team/product)
-- still reaches it. Directory table: read before a transaction is scoped to an organization, as
-- tenant_slugs is, so it sits outside row-level security. Nothing writes to it after this.
CREATE TABLE team_addresses (
  tenant_id    text NOT NULL REFERENCES tenants ON DELETE CASCADE,
  team_slug    text NOT NULL,
  product_slug text NOT NULL,
  product_id   text NOT NULL REFERENCES products ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, team_slug, product_slug)
);
CREATE INDEX team_addresses_product ON team_addresses (product_id);

-- A product's slug is unique in its organization, and is none of the organization's own pages in
-- the web app (/t/<org>/members, /t/<org>/plan, …). The product made first keeps a slug two share.
DO $$
DECLARE
  reserved text[] := ARRAY['members', 'plan', 'limits', 'people', 'activity', 'settings'];
  p record;
  n int;
  candidate text;
BEGIN
  FOR p IN
    SELECT pr.product_id, pr.tenant_id, pr.slug, tm.slug AS team_slug
    FROM products pr JOIN teams tm ON tm.team_id = pr.team_id
    WHERE pr.slug = ANY (reserved)
       OR EXISTS (
         SELECT 1 FROM products o
         WHERE o.tenant_id = pr.tenant_id AND o.slug = pr.slug AND (o.created_at, o.product_id) < (pr.created_at, pr.product_id)
       )
    ORDER BY pr.created_at, pr.product_id
  LOOP
    n := 2;
    LOOP
      candidate := left(p.slug, 50 - length(n::text) - 1) || '-' || n;
      EXIT WHEN NOT (candidate = ANY (reserved))
        AND NOT EXISTS (SELECT 1 FROM products WHERE tenant_id = p.tenant_id AND slug = candidate);
      n := n + 1;
    END LOOP;
    INSERT INTO team_addresses (tenant_id, team_slug, product_slug, product_id) VALUES (p.tenant_id, p.team_slug, p.slug, p.product_id);
    UPDATE products SET slug = candidate WHERE product_id = p.product_id;
  END LOOP;
END $$;

-- A grant's place is the organization, all its products, or one product.
ALTER TABLE memberships DROP CONSTRAINT memberships_scope_type_check;

-- A team admin could create products in their team: they become product creators, unless their
-- organization role already lets them.
INSERT INTO memberships (membership_id, tenant_id, scope_type, scope_id, account_id, role, created_at, created_by)
SELECT ulid_0044(), a.tenant_id, 'tenant', a.tenant_id, a.account_id, 'creator', a.created_at, a.created_by
FROM (
  SELECT DISTINCT ON (tenant_id, account_id) tenant_id, account_id, created_at, created_by
  FROM memberships WHERE scope_type = 'team' AND role = 'admin'
  ORDER BY tenant_id, account_id, created_at
) a
ON CONFLICT (scope_type, scope_id, account_id) DO UPDATE
  SET role = 'creator' WHERE memberships.role = 'member';

-- In an organization with one team, a team's role was a role on every product, products made
-- later included: it becomes that role on all products.
UPDATE memberships m SET scope_type = 'all_products', scope_id = m.tenant_id
WHERE m.scope_type = 'team'
  AND (SELECT count(*) FROM teams t WHERE t.tenant_id = m.tenant_id) = 1;

-- In an organization with several, it becomes that role on each of the team's products, where it
-- is higher than the role held there already, so nobody reaches a product they could not reach.
INSERT INTO memberships (membership_id, tenant_id, scope_type, scope_id, account_id, role, created_at, created_by)
SELECT ulid_0044(), m.tenant_id, 'product', p.product_id, m.account_id, m.role, m.created_at, m.created_by
FROM memberships m JOIN products p ON p.team_id = m.scope_id
WHERE m.scope_type = 'team'
ON CONFLICT (scope_type, scope_id, account_id) DO UPDATE
  SET role = EXCLUDED.role
  WHERE array_position(ARRAY['reader', 'viewer', 'editor', 'admin'], EXCLUDED.role)
      > array_position(ARRAY['reader', 'viewer', 'editor', 'admin'], memberships.role);
DELETE FROM memberships WHERE scope_type = 'team';

ALTER TABLE memberships ADD CONSTRAINT memberships_scope_type_check CHECK (scope_type IN ('tenant', 'all_products', 'product'));

-- An invitation to a team becomes one to all products where the organization had one team. Where
-- it had several, an open one ends: its place was one team's products, which no grant names now.
UPDATE invitations i SET expires_at = least(i.expires_at, now())
WHERE i.scope_type = 'team' AND i.accepted_at IS NULL
  AND (SELECT count(*) FROM teams t WHERE t.tenant_id = i.tenant_id) > 1;
UPDATE invitations SET scope_type = 'all_products', scope_id = tenant_id WHERE scope_type = 'team';

ALTER TABLE products DROP CONSTRAINT products_team_id_slug_key;
ALTER TABLE products ADD CONSTRAINT products_tenant_id_slug_key UNIQUE (tenant_id, slug);
ALTER TABLE products DROP COLUMN team_id;
ALTER TABLE records DROP COLUMN team_id;
ALTER TABLE activity DROP COLUMN team_id;
DROP TABLE teams;

DROP FUNCTION ulid_0044();
