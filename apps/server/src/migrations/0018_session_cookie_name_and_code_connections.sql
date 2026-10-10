-- Over HTTPS the session cookie is now `__Host-wb_session`, which only this host can set. A session
-- issued before then arrives as `wb_session`, and is still taken under that name until it expires;
-- a session issued since is not, so a cookie of the old name that another host under the same
-- parent domain planted carries no session issued from now on. Existing rows are marked, and so is
-- every row a server of an earlier version inserts; this version inserts false.
ALTER TABLE sessions ADD COLUMN legacy_cookie boolean NOT NULL DEFAULT true;

-- The connection an authorization code made, recorded when it is exchanged, so that a second use
-- of the code revokes that connection (RFC 6749 section 4.1.2).
ALTER TABLE oauth_codes ADD COLUMN family_id text;
