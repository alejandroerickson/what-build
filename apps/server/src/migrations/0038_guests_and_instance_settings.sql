-- What an instance owner sets for the whole deployment, read over the defaults in the application
-- (packages/core/src/settings.ts): the guests' settings, key 'guests', and each plan's limits and
-- price, key 'plan:<plan>'. It belongs to no organization, so it has no row-level security; only
-- instance owners' operations change it.
CREATE TABLE instance_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}',
  etag       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by jsonb
);

-- A guest's place, one row per account in no organization that has come in as a guest
-- (packages/core/src/guests.ts). In: waiting_since is null and last_active_at is recent. Waiting:
-- waiting_since is set, and waiting_seen_at is when they last asked. first_in_at is their first
-- day in, which the guests let in each day count; day and seconds_today are their time in today.
CREATE TABLE guest_passes (
  account_id      text PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  first_in_at     timestamptz,
  day             text NOT NULL,
  seconds_today   integer NOT NULL DEFAULT 0,
  last_active_at  timestamptz,
  waiting_since   timestamptz,
  waiting_seen_at timestamptz
);
CREATE INDEX guest_passes_active ON guest_passes (last_active_at) WHERE waiting_since IS NULL;
CREATE INDEX guest_passes_waiting ON guest_passes (waiting_since) WHERE waiting_since IS NOT NULL;
