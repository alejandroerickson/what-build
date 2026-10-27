-- An organization moved back to the plan new organizations start on, while whoever started it
-- already has an organization there, is read-only rather than writable there: people read and
-- export it, nobody adds to it, and it is kept until kept_until, a year on. Moving it to another
-- plan clears both.
ALTER TABLE tenants ADD COLUMN read_only_since timestamptz;
ALTER TABLE tenants ADD COLUMN kept_until timestamptz;
