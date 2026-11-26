-- The tutorial's welcome is offered once in the example organization and once more on the first
-- product of the person's own, so someone who explored the example first is shown around their own
-- product too. The account keeps `welcome-own` once the welcome has been offered on a product of
-- their own: `welcome` alone means it was offered in the example only.
ALTER TABLE accounts DROP CONSTRAINT accounts_tutorials_seen_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_tutorials_seen_check
  CHECK (tutorials_seen <@ ARRAY['welcome', 'welcome-own', 'idea', 'evidence', 'exploration', 'story']::text[]);

-- Until now the welcome was offered once, wherever it came first. Whoever was offered it and is in an
-- organization other than the example counts as offered it there, so it does not come again. Whoever
-- is in none, a guest of the example, is offered it once more on the first product of their own.
UPDATE accounts a
SET tutorials_seen = a.tutorials_seen || ARRAY['welcome-own']::text[]
WHERE 'welcome' = ANY (a.tutorials_seen)
  AND NOT 'welcome-own' = ANY (a.tutorials_seen)
  AND EXISTS (
    SELECT 1
    FROM memberships m
    JOIN tenants t ON t.tenant_id = m.tenant_id
    WHERE m.account_id = a.account_id AND NOT t.example
  );
