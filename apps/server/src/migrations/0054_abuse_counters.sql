-- The abuse limits' windows (packages/core/src/abuse-limits.ts): how many sign-in links, new
-- accounts, requests to join the waitlist, agent registrations, invitations and mails a client
-- address, an organization or the whole deployment took in one hour or one UTC day. A client address
-- is kept only as a keyed hash, never as the address, and the worker deletes a window two days after
-- it began. It belongs to no organization: an organization's row names it only by its ID.
CREATE TABLE abuse_counters (
  name      text NOT NULL,
  subject   text NOT NULL,
  starts_at timestamptz NOT NULL,
  n         integer NOT NULL,
  PRIMARY KEY (name, subject, starts_at)
);
CREATE INDEX abuse_counters_starts_at ON abuse_counters (starts_at);
