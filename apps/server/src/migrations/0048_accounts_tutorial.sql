-- The web app's tutorial, remembered on the account so it follows the person from one browser to the
-- next and survives signing out: when it was first offered, the stop it was left at (0 for the first,
-- null when it is not part-way), and when it was last finished. The person's own state, set only from
-- a session in the web app (PATCH /api/v1/me), never by an operation an agent can call.
ALTER TABLE accounts
  ADD COLUMN tutorial_offered_at timestamptz,
  ADD COLUMN tutorial_stop smallint CHECK (tutorial_stop >= 0 AND tutorial_stop < 64),
  ADD COLUMN tutorial_finished_at timestamptz;
