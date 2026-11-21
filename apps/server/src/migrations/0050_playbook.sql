-- Each product keeps a Playbook (Open Knowledge Format) bundle: Markdown files, and the text files of
-- the kits agents build, that the people's agents read and write together. Until its first write a
-- product serves WhatBuild's starter, which that write copies in. Every write keeps a revision, so
-- any earlier text can be read and restored. Messages between people's agents sit beside it.

-- A product's admins turn its Playbook off and on, in its Settings. Off, nothing is read or written there and nothing is lost.
ALTER TABLE products ADD COLUMN playbook_enabled boolean NOT NULL DEFAULT true;
-- When the starter was copied in, by the product's first write to its Playbook; null while it serves the starter.
ALTER TABLE products ADD COLUMN playbook_started_at timestamptz;

CREATE TABLE playbook_files (
  file_id      text PRIMARY KEY,
  tenant_id    text NOT NULL,
  product_id   text NOT NULL REFERENCES products,
  -- Its path in the bundle, as "lessons/name.md"; a file removed keeps the path it had.
  path         text NOT NULL,
  -- Its text; null while it is removed.
  content      text,
  -- What the frontmatter of a Markdown file says, read from it on every write.
  type         text,
  title        text,
  description  text,
  applies_to   text[] NOT NULL DEFAULT '{}',
  tags         text[] NOT NULL DEFAULT '{}',
  status       text,
  stale_after  timestamptz,
  size         integer NOT NULL DEFAULT 0,
  revision     integer NOT NULL,
  etag         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   jsonb NOT NULL,
  removed_at   timestamptz
);
-- A path holds one file that is not removed; removed ones keep theirs, to be restored.
CREATE UNIQUE INDEX playbook_files_path ON playbook_files (product_id, path) WHERE removed_at IS NULL;
CREATE INDEX playbook_files_product ON playbook_files (product_id, path);

CREATE TABLE playbook_revisions (
  revision_id  text PRIMARY KEY,
  tenant_id    text NOT NULL,
  product_id   text NOT NULL REFERENCES products,
  file_id      text NOT NULL REFERENCES playbook_files ON DELETE CASCADE,
  revision     integer NOT NULL,
  -- written, removed, moved or restored.
  change       text NOT NULL,
  path         text NOT NULL,
  -- The text as this revision left it; null when it removed the file.
  content      text,
  -- Why, in the writer's words, when they gave a reason.
  message      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   jsonb NOT NULL
);
CREATE UNIQUE INDEX playbook_revisions_file ON playbook_revisions (file_id, revision);
-- The bundle's recent changes, its export and its product's delete read a product's revisions together.
CREATE INDEX playbook_revisions_product ON playbook_revisions (product_id, created_at);

-- What each file's whatbuild: links point at, so an object can say which files cite it.
CREATE TABLE playbook_links (
  tenant_id    text NOT NULL,
  product_id   text NOT NULL REFERENCES products,
  file_id      text NOT NULL REFERENCES playbook_files ON DELETE CASCADE,
  target_kind  text NOT NULL,
  target_id    text NOT NULL,
  PRIMARY KEY (file_id, target_kind, target_id)
);
CREATE INDEX playbook_links_target ON playbook_links (product_id, target_kind, target_id);

-- A message from one person's agent to another person's, about the product. It lasts until expires_at.
CREATE TABLE playbook_messages (
  message_id      text PRIMARY KEY,
  tenant_id       text NOT NULL,
  product_id      text NOT NULL REFERENCES products,
  from_account_id text REFERENCES accounts,
  from_actor      jsonb NOT NULL,
  to_account_id   text NOT NULL REFERENCES accounts,
  text            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz,
  expires_at      timestamptz NOT NULL
);
CREATE INDEX playbook_messages_to ON playbook_messages (product_id, to_account_id, created_at);
CREATE INDEX playbook_messages_from ON playbook_messages (product_id, from_account_id, created_at);
CREATE INDEX playbook_messages_expiry ON playbook_messages (expires_at);

ALTER TABLE playbook_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON playbook_files USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE playbook_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON playbook_revisions USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE playbook_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON playbook_links USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE playbook_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON playbook_messages USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
