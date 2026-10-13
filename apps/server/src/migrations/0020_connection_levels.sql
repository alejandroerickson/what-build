-- What an agent's connection may do, chosen by the person when they approve it: 'viewer' reads,
-- 'editor' also writes and archives, 'admin' also deletes permanently and manages products and
-- people. It caps the person's own role and never adds to it. A connection made before levels
-- existed, and every row a server of an earlier version inserts, is an editor: no existing agent
-- gains permanent delete without the person choosing it.
ALTER TABLE oauth_codes ADD COLUMN level text NOT NULL DEFAULT 'editor' CHECK (level IN ('viewer', 'editor', 'admin'));
ALTER TABLE oauth_tokens ADD COLUMN level text NOT NULL DEFAULT 'editor' CHECK (level IN ('viewer', 'editor', 'admin'));
