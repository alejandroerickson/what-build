-- A mockup page may take the height of its content ("auto"): the frame that shows it grows to what
-- the page draws, at most 4000 pixels. height keeps 800 for such a page, the height a release that
-- does not know "auto" shows it at, and what the print view resolves a vh unit against.
ALTER TABLE mockup_pages ADD COLUMN height_auto boolean NOT NULL DEFAULT false;
