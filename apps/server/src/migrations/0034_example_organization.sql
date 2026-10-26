-- The public sandbox becomes the example organization: every account reads it, only its members
-- write it. Visitors, their invitation links and the baselines a daily reset put back go. The
-- sandbox's limits move to organizations on the free plan.

-- Set by the server at start-up from WHATBUILD_EXAMPLE_TENANT. A guest's read counts only while
-- this is true; the guest grant itself is never stored.
ALTER TABLE tenants RENAME COLUMN sandbox TO example;

-- A visitor's grant meant something only in a sandbox.
DELETE FROM memberships WHERE role = 'visitor';
ALTER TABLE accounts DROP COLUMN sandbox_only;

DROP TABLE sandbox_baseline_rows;
DROP TABLE sandbox_baselines;
DROP TABLE sandbox_invites;
DROP TABLE sandbox_settings;

-- An organization's plan, held since the first migration and never read until now, and the limits
-- an instance owner changed from the free plan's (validated by the application). Organizations made
-- before plans meant anything are unlimited; the application names the plan of every new one.
UPDATE tenants SET plan = 'unlimited';
ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'unlimited';
ALTER TABLE tenants ADD CONSTRAINT tenants_plan CHECK (plan IN ('free', 'unlimited'));
ALTER TABLE tenants ADD COLUMN limits jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN limits_etag text;
ALTER TABLE tenants ADD COLUMN limits_updated_at timestamptz;
ALTER TABLE tenants ADD COLUMN limits_updated_by jsonb;

-- Counters behind the limits: per person, and per organization under account_id ''. A minute bucket
-- starts on the minute; a day bucket at midnight UTC. Yesterday's counts mean nothing.
ALTER TABLE sandbox_usage RENAME TO limit_counters;
ALTER TABLE limit_counters RENAME CONSTRAINT sandbox_usage_pkey TO limit_counters_pkey;
TRUNCATE limit_counters;

-- How the service is used: a call in the example organization rather than in the public sandbox.
-- Days before this one count calls in the sandbox.
ALTER TABLE usage_calls RENAME COLUMN sandbox TO example;
ALTER TABLE usage_people RENAME COLUMN sandbox TO example;
