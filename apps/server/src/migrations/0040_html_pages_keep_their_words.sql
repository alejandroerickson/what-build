-- A page's words are kept beside its HTML, so search never reads the HTML.
--
-- Plain search used to strip every current mockup page and Story page of its markup, on every
-- search. Now each row holds the words a reader sees (`search_text`) and their search vector
-- (`tsv`). Both are generated columns: Postgres computes them in the statement that writes the
-- HTML, so they commit with it, there is no step that can run late or fail on its own, and a row
-- cannot hold words from HTML it no longer has. The ALTER computes them for every row there is.
--
-- The words are what is left of the HTML once comments, script and style blocks, tags with their
-- attributes (so inline SVG paths and data: URIs) and entities are gone. An SVG's <text> stays.
-- Script and style are two passes, not one: an alternation, or the backreference this replaces,
-- takes the whole expression out of shortest-match, and the match then runs from the first block
-- to the last, taking the words between with it. The backreference is also what made it slow.
--
-- A vector holds at most 1 MB. A word costs at most about 4 bytes for each character it and its
-- space take, so 200,000 characters always fit; words past them are not searched. HTML is itself
-- limited to 1,000,000 characters, nearly all of it markup on any page people read.

CREATE FUNCTION html_search_text(html text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT left(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(html, '<!--.*?-->', ' ', 'g'),
                '<script\M[^>]*?>.*?</script\M[^>]*>', ' ', 'gi'),
              '<style\M[^>]*?>.*?</style\M[^>]*>', ' ', 'gi'),
            '</?[a-zA-Z!?][^>]*>', ' ', 'g'),
          '&[a-zA-Z0-9#]+;', ' ', 'g'),
        '\s+', ' ', 'g'),
      ' ([,.;:!?)])', '\1', 'g')),
    200000)
$$;

ALTER TABLE mockup_pages
  ADD COLUMN search_text text GENERATED ALWAYS AS (html_search_text(html)) STORED,
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', html_search_text(html))) STORED;

ALTER TABLE story_versions
  ADD COLUMN search_text text GENERATED ALWAYS AS (html_search_text(html)) STORED,
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', html_search_text(html))) STORED;
