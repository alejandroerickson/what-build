-- The Story's Published mockups: the pages whose current version shows a page of a mockup, in a
-- section of their own after the navigation tree. Agents set their order here as a list of page
-- ids; a page not listed follows the listed ones, in the order its current version was published.
ALTER TABLE story_hierarchies ADD COLUMN mockups jsonb NOT NULL DEFAULT '[]';
