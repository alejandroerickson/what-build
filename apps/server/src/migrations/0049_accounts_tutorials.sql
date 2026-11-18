-- The web app's tutorial becomes five short ones: a welcome, then one for each of a product's four
-- pages, which starts by itself the first time the person opens that page. The account keeps which
-- of them have been shown, and whether the person turned tutorials off, so nothing starts by itself
-- again. The person's own state, set only from a session in the web app (PATCH /api/v1/me), never by
-- an operation an agent can call.
ALTER TABLE accounts
  ADD COLUMN tutorials_seen text[] NOT NULL DEFAULT '{}'
    CHECK (tutorials_seen <@ ARRAY['welcome', 'idea', 'evidence', 'exploration', 'story']::text[]),
  ADD COLUMN tutorials_off boolean NOT NULL DEFAULT false;

-- What the one tutorial of twenty stops had shown becomes the short ones seen. It walked Idea at stops
-- 0 to 5, Evidence at 6 to 8, Exploration at 9 to 14 and Story at 15 to 19: offered is the welcome
-- seen, a page passed is that page's seen, and finished is all of them seen.
UPDATE accounts
SET tutorials_seen = array_remove(ARRAY[
  'welcome',
  CASE WHEN tutorial_finished_at IS NOT NULL OR tutorial_stop >= 6 THEN 'idea' END,
  CASE WHEN tutorial_finished_at IS NOT NULL OR tutorial_stop >= 9 THEN 'evidence' END,
  CASE WHEN tutorial_finished_at IS NOT NULL OR tutorial_stop >= 15 THEN 'exploration' END,
  CASE WHEN tutorial_finished_at IS NOT NULL THEN 'story' END
]::text[], NULL)
WHERE tutorial_offered_at IS NOT NULL OR tutorial_stop IS NOT NULL OR tutorial_finished_at IS NOT NULL;

ALTER TABLE accounts
  DROP COLUMN tutorial_offered_at,
  DROP COLUMN tutorial_stop,
  DROP COLUMN tutorial_finished_at;
