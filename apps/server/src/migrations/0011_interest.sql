-- People who asked, on the public site, to hear when WhatBuild opens. Not tenant content: nobody
-- here belongs to an organization yet. Write-only from the site; operators read it directly. One
-- row per address; asking again updates the row.
CREATE TABLE interest (
  interest_id  text PRIMARY KEY,
  email        text NOT NULL,
  name         text,
  organization text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX interest_email ON interest (lower(email));
