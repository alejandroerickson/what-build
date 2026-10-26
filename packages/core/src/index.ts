import { activityOps } from "./ops/activity.ts";
import { deleteOps } from "./ops/deletes.ts";
import { derivedOps } from "./ops/derived.ts";
import { mockupOps } from "./ops/mockups.ts";
import { exportOps } from "./ops/export.ts";
import { attachmentOps } from "./ops/attachments.ts";
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
import { usageOps } from "./ops/usage.ts";
import type { OperationDef } from "./registry.ts";

export * from "./connector-scope.ts";
export * from "./db.ts";
export { DELETE_CONFIRMATION } from "./deletion.ts";
export * from "./errors.ts";
export * from "./execute.ts";
export { digestMessage, FEEDBACK_KINDS, FEEDBACK_PER_DAY, pruneFeedbackCounts, sendFeedbackDigest } from "./feedback.ts";
export * from "./media.ts";
export * from "./plain-query.ts";
export * from "./policy.ts";
export * from "./ports.ts";
export * from "./registry.ts";
export { safeNext } from "./safe-next.ts";
export * from "./public-sandbox.ts";
export * from "./public-sandbox-baseline.ts";
export * from "./schemas.ts";
export * from "./story-html.ts";
export { CARD_FRAMES, CARD_GUIDANCE, CARD_KIT_CSS, ideaCardDocument, ideaCardResponseHeaders, inspectIdeaCard } from "./idea-card.ts";
export * from "./prototype.ts";
export * from "./content-address.ts";
export * from "./story-print.ts";
export * from "./util.ts";
export { clientFamily, countCall, personOf, pruneUsage, usageReport, usageSettled, USAGE_PEOPLE_MONTHS, type UsageCall, type UsageOptions } from "./usage.ts";
export { runDerivation } from "./ops/derived.ts";
export { chunkText, indexSource, indexSources, indexText } from "./text-index.ts";
export { queueEvidenceMoves, runEvidenceMove } from "./evidence-move.ts";
export { markExportFailed, runExport } from "./ops/export.ts";
export { completeGrant, DOWNLOAD_GRANT_HEADER, UPLOAD_GRANT_HEADER, blobKeyFor, requesterClaims } from "./ops/attachments.ts";
export { createTenantWithTeam, uniqueTenantSlug } from "./ops/products.ts";
export { isInstanceOwner, tenantAllowanceOf, type TenantAllowance } from "./tenant-allowance.ts";
export { RESET_CONFIRMATION, sandboxNotice } from "./ops/public-sandbox.ts";
export { PREVIEWS_KEPT, printDocument, printDocumentAt, printSelection, shownHtml, STORY_PREVIEW_PURPOSE } from "./ops/story.ts";
export { CARD_PREVIEW_PURPOSE } from "./ops/outcomes.ts";
export { MAX_MOCKUP_PAGES, MOCKUP_UPLOAD_PURPOSE, mockupBundle, readCanvasZip, stagedPrototypeKey, stagedPrototypeKeys } from "./ops/mockups.ts";
export { SKILL_NAME, SKILL_VERSION, skillMarkdown } from "./ops/meta.ts";
export { GUIDANCE_VERSION } from "./story-guidance.ts";
export { HOUSE_STYLE_IDS, HOUSE_STYLES, houseSpecimen, houseStyle, pageDocument, specimenBody, styleSpecimen, type HouseStyle } from "./story-styles.ts";
export { FRAME_SCRIPT, frameScript, THEME_ATTRIBUTE, withPrototypeFrame, withStoryFrame, withStoryTheme } from "./story-theme.ts";
export { STORY_FONTS, storyFontFaces, storyFontsNamed, withStoryFonts, type StoryFont } from "./story-fonts.ts";

/** Every operation, defined once. REST routes, MCP tools and `describe` are generated from this list. */
export const OPERATIONS: OperationDef[] = [
  ...productOps,
  ...deleteOps,
  ...tenantAllowanceOps,
  ...usageOps,
  ...sandboxOps,
  ...exportOps,
  ...outcomeOps,
  ...sourceOps,
  ...attachmentOps,
  ...derivedOps,
  ...searchOps,
  ...registerOpsList,
  ...revisionOpsList,
  ...storyOps,
  ...mockupOps,
  ...activityOps,
  ...metaOps,
] as unknown as OperationDef[];

export const OPERATIONS_BY_NAME = new Map(OPERATIONS.map((o) => [o.name, o]));
