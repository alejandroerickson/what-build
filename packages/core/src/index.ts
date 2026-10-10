import { activityOps } from "./ops/activity.ts";
import { derivedOps } from "./ops/derived.ts";
import { mockupOps } from "./ops/mockups.ts";
import { exportOps } from "./ops/export.ts";
import { fileOps } from "./ops/files.ts";
import { lineageOps } from "./ops/lineage.ts";
import { metaOps } from "./ops/meta.ts";
import { outcomeOps } from "./ops/outcomes.ts";
import { productOps } from "./ops/products.ts";
import { registerOpsList } from "./ops/registers.ts";
import { revisionOpsList } from "./ops/revisions.ts";
import { sandboxOps } from "./ops/public-sandbox.ts";
import { searchOps } from "./ops/search.ts";
import { sourceOps } from "./ops/sources.ts";
import { storyOps } from "./ops/story.ts";
import { tenantAllowanceOps } from "./ops/tenant-allowances.ts";
import type { OperationDef } from "./registry.ts";

export * from "./connector-scope.ts";
export * from "./db.ts";
export * from "./errors.ts";
export * from "./execute.ts";
export * from "./source-fields.ts";
export * from "./media.ts";
export * from "./policy.ts";
export * from "./ports.ts";
export * from "./registry.ts";
export * from "./public-sandbox.ts";
export * from "./public-sandbox-baseline.ts";
export * from "./schemas.ts";
export * from "./story-html.ts";
export * from "./story-print.ts";
export * from "./util.ts";
export { runDerivation } from "./ops/derived.ts";
export { queueEvidenceMoves, runEvidenceMove } from "./evidence-move.ts";
export { markExportFailed, runExport } from "./ops/export.ts";
export { completeGrant, DOWNLOAD_GRANT_HEADER, UPLOAD_GRANT_HEADER, blobKeyFor } from "./ops/files.ts";
export { createTenantWithTeam, uniqueTenantSlug } from "./ops/products.ts";
export { isInstanceOwner, tenantAllowanceOf, type TenantAllowance } from "./tenant-allowance.ts";
export { RESET_CONFIRMATION, sandboxNotice } from "./ops/public-sandbox.ts";
export { printDocument, shownHtml } from "./ops/story.ts";
export { mockupBundle } from "./ops/mockups.ts";
export { SKILL_NAME, SKILL_VERSION, skillMarkdown } from "./ops/meta.ts";
export { GUIDANCE_VERSION } from "./story-guidance.ts";
export { HOUSE_STYLES, houseSpecimen, houseStyle, pageDocument, specimenBody, styleSpecimen, type HouseStyle } from "./story-styles.ts";
export { FRAME_SCRIPT, THEME_ATTRIBUTE, withStoryFrame, withStoryTheme } from "./story-theme.ts";

/** Every operation, defined once. REST routes, MCP tools and `describe` are generated from this list. */
export const OPERATIONS: OperationDef[] = [
  ...productOps,
  ...tenantAllowanceOps,
  ...sandboxOps,
  ...exportOps,
  ...outcomeOps,
  ...sourceOps,
  ...fileOps,
  ...derivedOps,
  ...searchOps,
  ...registerOpsList,
  ...revisionOpsList,
  ...storyOps,
  ...mockupOps,
  ...lineageOps,
  ...activityOps,
  ...metaOps,
] as unknown as OperationDef[];

export const OPERATIONS_BY_NAME = new Map(OPERATIONS.map((o) => [o.name, o]));
