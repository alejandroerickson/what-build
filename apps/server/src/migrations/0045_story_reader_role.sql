-- The product role that reads only the Story is named story_reader, so its name says what it
-- reaches: told they are a viewer, someone reads everything in a product; told they are a Story
-- reader, they read only its Story. Grants and invitations, open or not, take the new name.
-- Both are directory tables, read before a transaction is scoped to an organization, so they sit
-- outside row-level security and one statement each reaches every organization's rows.
UPDATE memberships SET role = 'story_reader' WHERE role = 'reader';
UPDATE invitations SET role = 'story_reader' WHERE role = 'reader';
