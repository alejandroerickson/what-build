import { activityOps } from "./ops/activity.ts";
import { derivedOps } from "./ops/derived.ts";
import { exportOps } from "./ops/export.ts";
import { fileOps } from "./ops/files.ts";
import { insightOps } from "./ops/insights.ts";
import { lineageOps } from "./ops/lineage.ts";
import { metaOps } from "./ops/meta.ts";
import { objectiveOps } from "./ops/objectives.ts";
import { productOps } from "./ops/products.ts";
import { registerOpsList } from "./ops/registers.ts";
import { revisionOpsList } from "./ops/revisions.ts";
import { searchOps } from "./ops/search.ts";
import { sourceOps } from "./ops/sources.ts";
import { storyOps } from "./ops/story.ts";
import type { OperationDef } from "./registry.ts";

export * from "./db.ts";
export * from "./errors.ts";
export * from "./execute.ts";
export * from "./kinds.ts";
export * from "./media.ts";
export * from "./policy.ts";
export * from "./ports.ts";
export * from "./registry.ts";
export * from "./schemas.ts";
export * from "./story-html.ts";
export * from "./util.ts";
export { runDerivation } from "./ops/derived.ts";
export { markExportFailed, runExport } from "./ops/export.ts";
export { completeGrant, DOWNLOAD_GRANT_HEADER, UPLOAD_GRANT_HEADER, blobKeyFor } from "./ops/files.ts";
export { createTenantWithTeam, uniqueTenantSlug } from "./ops/products.ts";
export { SKILL_NAME, SKILL_VERSION, skillMarkdown } from "./ops/meta.ts";
export { GUIDANCE_VERSION, STYLESHEET as STORY_STYLESHEET, TOKENS as STORY_TOKENS } from "./story-guidance.ts";

/** Every operation, defined once. REST routes, MCP tools and `describe` are generated from this list. */
export const OPERATIONS: OperationDef[] = [
  ...productOps,
  ...exportOps,
  ...objectiveOps,
  ...sourceOps,
  ...fileOps,
  ...derivedOps,
  ...searchOps,
  ...insightOps,
  ...registerOpsList,
  ...revisionOpsList,
  ...storyOps,
  ...lineageOps,
  ...activityOps,
  ...metaOps,
] as unknown as OperationDef[];

export const OPERATIONS_BY_NAME = new Map(OPERATIONS.map((o) => [o.name, o]));
