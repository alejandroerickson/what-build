-- How the service is used, counted on the server for every call to an operation, whichever door it
-- came through. Not tenant content: nothing here names an organization, a product, a record, an
-- address or anything anyone wrote. Read only by the instance's owners (products.usage).

-- Calls: one row per day, operation, door, agent client, sandbox or not, and how the call ended.
CREATE TABLE usage_calls (
  day       date    NOT NULL,
  operation text    NOT NULL,
  surface   text    NOT NULL,
  client    text    NOT NULL,
  sandbox   boolean NOT NULL,
  owner     boolean NOT NULL,
  outcome   text    NOT NULL,
  calls     integer NOT NULL DEFAULT 1,
  PRIMARY KEY (day, operation, surface, client, sandbox, owner, outcome)
);

-- People, so a report can say how many came back without saying who: one row for each day a person
-- used a part of WhatBuild (an MCP tool's name: sources, search, story…) through a door. `person` is
-- a keyed hash of the account that only this deployment can compute. Rows go after 14 months.
CREATE TABLE usage_people (
  day     date    NOT NULL,
  person  text    NOT NULL,
  feature text    NOT NULL,
  surface text    NOT NULL,
  client  text    NOT NULL,
  sandbox boolean NOT NULL,
  owner   boolean NOT NULL,
  PRIMARY KEY (day, person, feature, surface, client, sandbox)
);
CREATE INDEX usage_people_person ON usage_people (person, day);
