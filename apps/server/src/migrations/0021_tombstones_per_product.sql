-- Tombstones now cover outcomes, assumptions, comments, Story pages, mockups and products as well
-- as sources. A Story page's id is unique only within its product, so a tombstone is keyed by its
-- product, its object type and its id. A page deleted, made again under the same id and deleted
-- again keeps one tombstone, the latest.
ALTER TABLE tombstones DROP CONSTRAINT tombstones_pkey;
ALTER TABLE tombstones ADD PRIMARY KEY (product_id, object_type, object_id);
CREATE INDEX tombstones_object ON tombstones (object_id);
