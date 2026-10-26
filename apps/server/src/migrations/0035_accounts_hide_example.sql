-- A person who no longer needs the example organization hides it from the app's panel. It stays on
-- the overview, where they can show it again. The account's own choice, kept with the account so it
-- follows them from one browser to the next.
ALTER TABLE accounts ADD COLUMN hide_example boolean NOT NULL DEFAULT false;
