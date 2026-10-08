import { z } from "zod";
import { json } from "../db.ts";
import { defineOperation } from "../registry.ts";
import { SKILL_TEMPLATE } from "../skill/skill-text.ts";
import { newId } from "../util.ts";

/**
 * One knob: the MCP server version, the skill's metadata.version and the get_skill advertisement.
 * Bump it only when the tool contract or the skill's guidance changes, so installed skills are
 * never asked to reinstall the same content.
 */
export const SKILL_NAME = "whatbuild";
export const SKILL_VERSION = "0.12.0";

export function skillMarkdown(): string {
  return SKILL_TEMPLATE.replace("__SKILL_VERSION__", SKILL_VERSION);
}

export const getSkill = defineOperation({
  name: "get_skill",
  scope: "account",
  access: "any",
  mutates: false,
  summary: `Get the complete ${SKILL_NAME} skill, version ${SKILL_VERSION}.`,
  description:
    `Call this if your installed ${SKILL_NAME} skill is absent, unversioned, or not version ${SKILL_VERSION}. Fetching the skill does not install it and changes nothing; propose installing it through your harness.`,
  input: z.strictObject({}),
  rest: { method: "GET", path: "/skill" },
  mcp: { tool: "get_skill" },
  async handler() {
    return { name: SKILL_NAME, version: SKILL_VERSION, filename: "SKILL.md", content: skillMarkdown() };
  },
});

export const submitFeedback = defineOperation({
  name: "submit_feedback",
  scope: "account",
  access: "any",
  mutates: true,
  summary: "Report a tool that failed, wording that confused you, or a capability you wish existed. Write-only.",
  description:
    "Goes to the maintainers; there is no way to read it back, and it touches no source. Say what happened, what you expected, and any suggestion. Categories: issue (a tool failed or behaved unexpectedly), confusion (a description misled you), feature_request (something you wish existed), other. Never include secrets or source content.",
  input: z.strictObject({
    category: z.enum(["issue", "confusion", "feature_request", "other"]),
    message: z.string().trim().min(1).max(4000),
    tool: z.string().max(64).optional(),
    details: z.string().max(4000).optional(),
  }),
  rest: { method: "POST", path: "/feedback" },
  mcp: { tool: "submit_feedback" },
  async handler(ctx, input) {
    const feedback_id = newId();
    await ctx.db
      .insertInto("feedback")
      .values({
        feedback_id, tenant_id: null, category: input.category, message: input.message, tool: input.tool ?? null, details: input.details ?? null,
        server_version: ctx.ports.config.serverVersion, submitted_by: json(ctx.actor),
      })
      .execute();
    return { feedback_id, received: true, note: "Thank you. Maintainers read these; there is no reply channel." };
  },
});

export const metaOps = [getSkill, submitFeedback];
