-- A source's words are one derived text, and its files are attachments, none of them searched.
--
-- Passages go. Each source gets one derived text: Markdown that people and agents read and edit,
-- taken from an attachment's text. Search reads a source's title, tags, summary, notes, derived
-- text and comments, through a search index of their pieces, and never its attachments. A file
-- has no role (primary, origin, supplement) and no provenance (derived_from, derivation_note,
-- derived_by) any more: the text of every attachment is read and kept.
--
-- A source whose primary had passages gets them back as its derived text: one paragraph per
-- passage, headings as they were, each speaker in bold before what they said and, in a timed
-- transcript, the time their turn starts, a speaker's consecutive cues running on as one turn. The
-- derived text records the file version it was taken from. The worker then reads every attachment
-- again, and a derived text still taken from an attachment follows it, so each one is soon laid out
-- as the parsers now write it, tables whole. The worker builds the search index too.
--
-- Public sandbox baselines hold rows as JSON, so their saved passages become saved derived texts
-- the same way, and their saved files lose their role and provenance. A reset builds the search
-- index again.
--
-- Row-level security hides every row unless app.tenant_id is set, so the rows are rewritten once
-- per tenant.

CREATE TABLE source_texts (
  record_id            text PRIMARY KEY REFERENCES records ON DELETE CASCADE,
  tenant_id            text NOT NULL,
  content              text NOT NULL,
  chars                integer NOT NULL,
  from_file_version_id text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           jsonb NOT NULL,
  etag                 text NOT NULL
);

CREATE TABLE text_chunks (
  tenant_id  text NOT NULL,
  record_id  text NOT NULL REFERENCES records ON DELETE CASCADE,
  field      text NOT NULL CHECK (field IN ('title', 'tags', 'summary', 'notes', 'text', 'comment')),
  ref        text NOT NULL DEFAULT '',
  n          integer NOT NULL,
  char_start integer NOT NULL,
  char_end   integer NOT NULL,
  text       text NOT NULL,
  tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  PRIMARY KEY (record_id, field, ref, n)
);
CREATE INDEX text_chunks_tsv ON text_chunks USING gin (tsv);
CREATE INDEX text_chunks_trgm ON text_chunks USING gin (text gin_trgm_ops);

-- Every attachment's version is read now, and its latest reading is looked up by the version.
CREATE INDEX derivations_version ON derivations (file_version_id, derivation_id DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['source_texts', 'text_chunks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;

-- A cue time as people write it: m:ss, or h:mm:ss from an hour on.
CREATE FUNCTION clock_0030(ms bigint) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN ms >= 3600000
    THEN format('%s:%s:%s', ms / 3600000, lpad(((ms / 60000) % 60)::text, 2, '0'), lpad(((ms / 1000) % 60)::text, 2, '0'))
    ELSE format('%s:%s', ms / 60000, lpad(((ms / 1000) % 60)::text, 2, '0')) END
$$;

-- A source's passages, in order, as one Markdown text: the rules the parsers lay text out by
-- (packages/parsers/src/markdown.ts), applied to what the passages kept.
CREATE FUNCTION text_from_passages_0030(passages jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  p jsonb;
  t text;
  sp text;
  ms bigint;
  paras text[] := '{}';
  turn_key text;       -- the speaker of the timed turn being run on, '' when its cues name none
  turn_label text;
  turn_parts text[];
  turn_chars integer := 0;
  last_speaker text;   -- the speaker of the last untimed turn, so its later paragraphs are not labelled again
BEGIN
  FOR p IN SELECT value FROM jsonb_array_elements(passages) LOOP
    t := btrim(coalesce(p->>'text', ''), E' \t\r\n');
    CONTINUE WHEN t = '';
    sp := p->>'speaker';
    ms := (p->>'start_ms')::bigint;
    IF p->>'heading_level' IS NOT NULL OR ms IS NULL OR turn_key IS DISTINCT FROM coalesce(sp, '') OR turn_chars >= 1200 THEN
      IF turn_key IS NOT NULL THEN
        paras := paras || (turn_label || array_to_string(turn_parts, ' '));
        turn_key := NULL;
      END IF;
    ELSE
      turn_parts := turn_parts || t;
      turn_chars := turn_chars + length(t) + 1;
      CONTINUE;
    END IF;
    IF p->>'heading_level' IS NOT NULL THEN
      last_speaker := NULL;
      paras := paras || regexp_replace(t, '\s+', ' ', 'g');
    ELSIF ms IS NOT NULL THEN
      last_speaker := NULL;
      turn_key := coalesce(sp, '');
      turn_label := CASE WHEN sp IS NOT NULL
        THEN '**' || regexp_replace(sp, '([\\`*_\[\]])', '\\\1', 'g') || '** (' || clock_0030(ms) || '): '
        ELSE '(' || clock_0030(ms) || ') ' END;
      turn_parts := ARRAY[t];
      turn_chars := length(t);
    ELSIF sp IS NOT NULL THEN
      paras := paras || CASE WHEN sp = last_speaker THEN t ELSE '**' || regexp_replace(sp, '([\\`*_\[\]])', '\\\1', 'g') || ':** ' || t END;
      last_speaker := sp;
    ELSE
      last_speaker := NULL;
      paras := paras || t;
    END IF;
  END LOOP;
  IF turn_key IS NOT NULL THEN
    paras := paras || (turn_label || array_to_string(turn_parts, ' '));
  END IF;
  RETURN CASE WHEN cardinality(paras) = 0 THEN '' ELSE array_to_string(paras, E'\n\n') || E'\n' END;
END $$;

DO $$
DECLARE
  t text;
  -- The actor the parsers write as; not named parser, which is a column of derivations.
  reader jsonb := '{"account_id": "system", "display_name": "WhatBuild", "surface": null, "client": "parser"}';
BEGIN
  FOR t IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t, true);

    INSERT INTO source_texts (record_id, tenant_id, content, chars, from_file_version_id, updated_at, updated_by, etag)
    SELECT r.record_id, r.tenant_id, p.content, length(p.content), d.file_version_id, d.created_at, reader, md5(random()::text || clock_timestamp()::text)
    FROM records r
    JOIN derivations d ON d.derivation_id = r.current_derivation_id AND d.status = 'ready'
    JOIN (
      SELECT s.derivation_id, text_from_passages_0030(jsonb_agg(
        jsonb_build_object('text', s.text, 'speaker', s.speaker, 'start_ms', s.start_ms, 'heading_level', s.heading_level) ORDER BY s.seq)) AS content
      FROM segments s WHERE s.is_current GROUP BY s.derivation_id) p ON p.derivation_id = d.derivation_id
    WHERE p.content <> '';

    INSERT INTO sandbox_baseline_rows (baseline_id, tenant_id, table_name, row)
    SELECT r.baseline_id, r.tenant_id, 'source_texts', jsonb_build_object(
      'record_id', r.row->>'record_id', 'tenant_id', r.row->>'tenant_id', 'content', p.content, 'chars', length(p.content),
      'from_file_version_id', d.row->>'file_version_id', 'updated_at', d.row->>'created_at', 'updated_by', reader,
      'etag', md5(random()::text || clock_timestamp()::text))
    FROM sandbox_baseline_rows r
    JOIN sandbox_baseline_rows d ON d.baseline_id = r.baseline_id AND d.table_name = 'derivations'
      AND d.row->>'derivation_id' = r.row->>'current_derivation_id' AND d.row->>'status' = 'ready'
    JOIN (
      SELECT s.baseline_id, s.row->>'derivation_id' AS derivation_id,
        text_from_passages_0030(jsonb_agg(s.row ORDER BY (s.row->>'seq')::int)) AS content
      FROM sandbox_baseline_rows s WHERE s.table_name = 'segments' AND (s.row->>'is_current')::boolean
      GROUP BY 1, 2) p ON p.baseline_id = r.baseline_id AND p.derivation_id = d.row->>'derivation_id'
    WHERE r.table_name = 'records' AND p.content <> '';
    DELETE FROM sandbox_baseline_rows WHERE table_name = 'segments';
    UPDATE sandbox_baseline_rows SET row = row - 'current_derivation_id' WHERE table_name = 'records' AND row ? 'current_derivation_id';
    UPDATE sandbox_baseline_rows SET row = row - 'role' - 'derived_from' - 'derivation_note' - 'derived_by' - 'role_changed_at' - 'role_changed_by'
      WHERE table_name = 'files' AND (row ? 'role' OR row ? 'derived_from' OR row ? 'derivation_note' OR row ? 'derived_by' OR row ? 'role_changed_at' OR row ? 'role_changed_by');
    UPDATE sandbox_baseline_rows SET row = row - 'segment_count' WHERE table_name = 'derivations' AND row ? 'segment_count';
    UPDATE sandbox_baselines b SET counts = (b.counts - 'segments') || jsonb_build_object('source_texts',
      (SELECT count(*) FROM sandbox_baseline_rows x WHERE x.baseline_id = b.baseline_id AND x.table_name = 'source_texts'));

    -- Read every attachment again, as the parsers now lay text out, without a line in the activity
    -- log for each; then build the search index of every product's sources.
    INSERT INTO jobs (tenant_id, kind, payload)
    SELECT f.tenant_id, 'derive', jsonb_build_object('record_id', f.record_id, 'file_version_id', f.current_version_id, 'force', true, 'quiet', true)
    FROM files f WHERE f.current_version_id IS NOT NULL
    ORDER BY f.record_id, f.added_at;
    INSERT INTO jobs (tenant_id, kind, payload)
    SELECT DISTINCT r.tenant_id, 'index_texts', jsonb_build_object('product_id', r.product_id)
    FROM records r;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;

DROP FUNCTION text_from_passages_0030(jsonb);
DROP FUNCTION clock_0030(bigint);

DROP TABLE segments;
ALTER TABLE records DROP COLUMN current_derivation_id;
ALTER TABLE files DROP COLUMN role, DROP COLUMN derived_from, DROP COLUMN derivation_note, DROP COLUMN derived_by,
  DROP COLUMN role_changed_at, DROP COLUMN role_changed_by;
ALTER TABLE upload_grants DROP COLUMN role, DROP COLUMN derived_from, DROP COLUMN derivation_note, DROP COLUMN derived_by;
ALTER TABLE derivations DROP COLUMN segment_count;
