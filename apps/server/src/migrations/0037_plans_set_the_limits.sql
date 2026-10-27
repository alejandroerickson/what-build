-- Limits belong to a plan, never to one organization. The deployment defines its plans and every
-- limit each sets (WHATBUILD_PLANS); the database holds only which plan an organization is on, an
-- id the deployment chose, or unlimited. The limits an instance owner changed for one organization
-- go; its plan stays, and what guarded and recorded those changes now guards and records a change
-- of plan.
ALTER TABLE tenants DROP CONSTRAINT tenants_plan;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan CHECK (plan ~ '^[a-z][a-z0-9_-]{0,39}$');
ALTER TABLE tenants DROP COLUMN limits;
ALTER TABLE tenants RENAME COLUMN limits_etag TO plan_etag;
ALTER TABLE tenants RENAME COLUMN limits_updated_at TO plan_changed_at;
ALTER TABLE tenants RENAME COLUMN limits_updated_by TO plan_changed_by;
