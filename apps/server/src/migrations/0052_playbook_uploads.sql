-- An upload under the same grants as a canvas's may carry a Playbook's files for playbook.apply to
-- read, so an agent sends a kit from disk instead of through its own output. kind says which an
-- upload is, and each operation reads only its own; the worker discards both alike.
ALTER TABLE mockup_uploads ADD COLUMN kind text NOT NULL DEFAULT 'canvas' CHECK (kind IN ('canvas', 'playbook'));
