-- The landing pages' funnel (okf/operations/analytics.md#the-landing-page-funnel): which of a landing
-- page's buttons a new account came by ('explore', Explore the demo; 'start', Start using
-- WhatBuild), kept once with the page it came from; when an account first came back, its first call
-- to an operation on a later UTC day than the one it was made, kept once; and how often each landing
-- page's buttons are pressed, counted per UTC day, naming nobody. Null and empty before this.
ALTER TABLE accounts ADD COLUMN came_via text;
ALTER TABLE accounts ADD COLUMN returned_at timestamptz;

CREATE TABLE landing_presses (
  day     date    NOT NULL,
  page    text    NOT NULL,
  button  text    NOT NULL,
  presses integer NOT NULL DEFAULT 1,
  PRIMARY KEY (day, page, button)
);
