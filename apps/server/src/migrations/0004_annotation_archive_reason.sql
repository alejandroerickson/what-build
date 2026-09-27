-- Why a note was archived, said beside it rather than by rewriting the note. Set when a note is
-- archived, cleared when it is restored. The table's row-level security policy covers the column.
ALTER TABLE annotations
  ADD COLUMN archive_reason text;
