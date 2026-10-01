-- Who may create organizations (tenants), and how many. An instance owner, named by the
-- deployment's WHATBUILD_INSTANCE_OWNERS, may create any number and gives everyone else an
-- allowance here. Being in an organization never lets anyone create one.

-- An allowance belongs to an address, as an invitation does, so it can be given before the
-- account exists and lets that address sign up while sign-up is limited. Directory table: read
-- before the caller belongs to anything, so it sits outside row-level security, like invitations.
CREATE TABLE tenant_allowances (
  email      text PRIMARY KEY CHECK (email = lower(email)),
  allowed    integer NOT NULL CHECK (allowed >= 0),
  note       text NOT NULL DEFAULT '',
  etag       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb NOT NULL
);

-- What an allowance is counted against: the organizations an account created.
CREATE INDEX tenants_created_by_account ON tenants ((created_by->>'account_id'));
