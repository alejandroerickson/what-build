-- The product concept and each outcome become a card with two sides. The text they already hold
-- (the product's concept, the outcome's description) is the back, which agents read; card_html is
-- the front, which people see: agent-written HTML in the card kit, empty until an agent draws it.
-- A public sandbox baseline saved before this keeps the default when it is reset to.
ALTER TABLE products ADD COLUMN card_html text NOT NULL DEFAULT '';
ALTER TABLE outcomes ADD COLUMN card_html text NOT NULL DEFAULT '';
