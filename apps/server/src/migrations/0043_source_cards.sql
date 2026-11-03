-- A source's card: a picture of the source, HTML drawn in the Idea card kit on a board of one size,
-- kept beside its summary and notes with an etag of its own. It is not searched: its words are the
-- summary's. A card preview may now be a source's.
ALTER TABLE agent_notes DROP CONSTRAINT agent_notes_kind_check;
ALTER TABLE agent_notes ADD CONSTRAINT agent_notes_kind_check CHECK (kind IN ('summary', 'notes', 'card'));

ALTER TABLE card_previews DROP CONSTRAINT card_previews_kind_check;
ALTER TABLE card_previews ADD CONSTRAINT card_previews_kind_check CHECK (kind IN ('concept', 'outcome', 'source'));
