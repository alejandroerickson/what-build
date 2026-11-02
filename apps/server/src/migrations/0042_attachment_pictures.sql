-- People recognise a source by what it looks like. Each attachment version an image, a PDF or a
-- PowerPoint deck can give a picture of itself gets two small copies of that picture, made by the
-- worker: one for a row of the list of sources, and one for the preview beside it. A deck with no
-- picture of its own keeps slide one's title and a colour, for a card the app draws. A video's
-- picture is a frame someone's browser sent. A row with no copies says why, and the app shows the
-- next thing it has.
--
-- The copies are files beside the source's others, under the organization's own prefix, so they go
-- with it wherever it is copied, and they can always be made again.
--
-- PowerPoint decks can be read now too, so those already here are read again, quietly, ahead of
-- their pictures, and a source with no text of its own gets theirs.
--
-- Row-level security hides every row unless app.tenant_id is set, so the existing attachments are
-- queued once per tenant. Nothing else needs doing: every deployment fills these in by itself.

CREATE TABLE attachment_pictures (
  file_version_id text PRIMARY KEY REFERENCES file_versions ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  record_id       text NOT NULL REFERENCES records ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('ready', 'none', 'failed')),
  detail          text,
  made_from       text NOT NULL CHECK (made_from IN ('image', 'pdf', 'deck', 'frame')),
  blob_prefix     text,
  width           integer,
  height          integer,
  pages           integer,
  card_title      text,
  card_colour     text,
  made_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachment_pictures_record ON attachment_pictures (record_id);

ALTER TABLE attachment_pictures ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment_pictures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachment_pictures
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);
    INSERT INTO jobs (tenant_id, kind, payload)
    SELECT f.tenant_id, 'derive', jsonb_build_object('record_id', f.record_id, 'file_version_id', f.current_version_id, 'force', true, 'quiet', true)
    FROM files f
    JOIN file_versions v ON v.file_version_id = f.current_version_id
    WHERE v.media_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ORDER BY f.record_id, f.added_at;
    INSERT INTO jobs (tenant_id, kind, payload)
    SELECT f.tenant_id, 'make_picture', jsonb_build_object('record_id', f.record_id, 'file_version_id', f.current_version_id, 'quiet', true)
    FROM files f
    JOIN file_versions v ON v.file_version_id = f.current_version_id
    WHERE v.media_type = 'application/pdf'
      OR v.media_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      OR (v.media_type LIKE 'image/%' AND v.media_type <> 'image/svg+xml')
    ORDER BY f.record_id, f.added_at;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
