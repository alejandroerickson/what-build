-- Feedback names nobody. A report keeps its kind, its words, the release, the door it came through
-- (the web app or an agent), the agent's family (Claude Code, Cursor, …) or the screen a person was
-- on, and the person's address only when they chose to share it for a reply. Reports made before
-- this keep who sent them. A report that went out in the daily digest records when.
ALTER TABLE feedback ALTER COLUMN submitted_by DROP NOT NULL;
ALTER TABLE feedback ADD COLUMN surface  text;
ALTER TABLE feedback ADD COLUMN client   text;
ALTER TABLE feedback ADD COLUMN screen   text;
ALTER TABLE feedback ADD COLUMN reply_to text;
ALTER TABLE feedback ADD COLUMN sent_at  timestamptz;
UPDATE feedback SET surface = submitted_by->>'surface';
CREATE INDEX feedback_unsent ON feedback (received_at) WHERE sent_at IS NULL;

-- How many reports a person sent on a day, for the daily limit. It never says which reports, and
-- the worker deletes a day's counts once the day is over.
CREATE TABLE feedback_counts (
  account_id text NOT NULL,
  day        date NOT NULL,
  sent       integer NOT NULL,
  PRIMARY KEY (account_id, day)
);

-- Whether an agent's connection is offered submit_feedback. On unless the person turns it off; a
-- refreshed connection keeps the person's choice, as it keeps its level.
ALTER TABLE oauth_tokens ADD COLUMN feedback boolean NOT NULL DEFAULT true;
