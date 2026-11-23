-- Which page of the public site people came from, as its path on the site ("/" or
-- "/what-to-build/"), so the landing pages can be compared by what each brings: on a request to
-- hear from us (the first page an address asked from is kept), and on an account made from a
-- landing page's link (kept once, in the account's first day). Null for everything before this.
ALTER TABLE interest ADD COLUMN page text;
ALTER TABLE accounts ADD COLUMN came_from text;
