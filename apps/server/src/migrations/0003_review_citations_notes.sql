-- Insight review: a person marks the revision they reviewed. Editing the insight afterwards leaves
-- reviewed_revision behind the current revision, which reads as "changed since review".
ALTER TABLE insights
  ADD COLUMN reviewed_revision integer,
  ADD COLUMN reviewed_at       timestamptz,
  ADD COLUMN reviewed_by       jsonb;

-- Story citations: exact passages a page version draws on, frozen as snapshots like register
-- citations. Versions are immutable, so the citations belong to the version.
ALTER TABLE story_versions
  ADD COLUMN citations jsonb NOT NULL DEFAULT '[]';

-- Notes for agents: one Markdown note per page, kept beside the versions rather than in them, with
-- its own etag so editing the note and publishing the page never block each other.
ALTER TABLE story_pages
  ADD COLUMN agent_notes            text NOT NULL DEFAULT '',
  ADD COLUMN agent_notes_etag       text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  ADD COLUMN agent_notes_updated_at timestamptz,
  ADD COLUMN agent_notes_updated_by jsonb;
