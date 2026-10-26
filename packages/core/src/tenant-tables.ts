/**
 * The tables that hold an organization's content, each after the tables it refers to. Deleting an
 * organization deletes them in the reverse order. A table of content saved before insights and
 * decisions moved into Evidence still exists, and is listed.
 */
export const CONTENT_TABLES = [
  "teams", "products",
  "records", "files", "file_versions", "derivations", "source_texts", "annotations", "agent_notes",
  "outcomes", "insights", "revisions", "register_entries", "reviews",
  "story_pages", "story_versions", "story_hierarchies", "story_styles",
  "mockups", "mockup_versions", "mockup_pages", "mockup_files", "mockup_prototype_files",
  "activity", "tombstones",
] as const;

/** Every other table that carries `tenant_id`, and what it holds. A test holds the two lists complete. */
export const OTHER_TENANT_TABLES: Record<string, string> = {
  memberships: "Access, not content.",
  invitations: "Access, as memberships.",
  limit_counters: "The counters behind a free organization's limits.",
  jobs: "Work in progress.",
  upload_grants: "An upload in progress.",
  mockup_uploads: "An upload in progress.",
  story_previews: "A preview, which lasts as long as its grant.",
  card_previews: "A preview, which lasts as long as its grant.",
  exports: "An export bundle, kept for a while after it is built.",
  feedback: "Goes to the maintainers, and names no tenant.",
  text_chunks: "The search index, built from the texts it covers.",
};
