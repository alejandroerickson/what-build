-- A Story page version may show one page of a mockup version instead of HTML of its own:
-- {mockup_id, mockup_version_id, version, page_id}. Such a version keeps html empty, and its page
-- is read from mockup_pages, which are immutable, so the Story never holds a copy.
ALTER TABLE story_versions ADD COLUMN mockup jsonb;
CREATE INDEX story_versions_mockup ON story_versions ((mockup->>'mockup_id')) WHERE mockup IS NOT NULL;
