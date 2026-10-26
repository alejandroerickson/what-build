import { z } from "zod";
import { invalid } from "../errors.ts";
import { countFeedback, FEEDBACK_PER_DAY } from "../feedback.ts";
import { defineOperation } from "../registry.ts";
import { SKILL_TEMPLATE } from "../skill/skill-text.ts";
import { clientFamily } from "../usage.ts";
import { newId } from "../util.ts";

/**
 * One knob: the MCP server version, the skill's metadata.version and the get_skill advertisement.
 * Bump it only when the tool contract or the skill's guidance changes, so installed skills are
 * never asked to reinstall the same content.
 */
export const SKILL_NAME = "whatbuild";
export const SKILL_VERSION = "0.41.0";

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
    `Call this if your installed ${SKILL_NAME} skill is absent, unversioned, or not version ${SKILL_VERSION}. Fetching the skill does not install it and changes nothing; propose installing it through your harness. The version it returns is the server's as it runs now: if it is newer than the version the server's instructions named when your client connected, the server was upgraded since and your client's tool list is older; ask the person to start a new session.`,
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
  connection: "viewer",
  summary: "Report a tool that failed, wording that confused you, or something that could be better or that you wish existed. Write-only.",
  description:
    `Goes to the developer of WhatBuild without the person's name or address; there is no way to read it back, no reply channel, and it touches no source. Say what happened, what you expected, and any suggestion. Categories: issue (a tool failed or behaved unexpectedly), confusion (a description misled you), improvement (something works but could work better), feature_request (something you wish existed), other. Name the tool in \`tool\`. Never include secrets, people's names or source content. A person and their agents may send ${FEEDBACK_PER_DAY} a day, counted by the UTC day; past that it answers 429 rate_limited, and the message says when it starts again (midnight UTC). The person may turn this tool off for your connection; then it is not listed, and you send no feedback another way.`,
  input: z.strictObject({
    category: z.enum(["issue", "confusion", "improvement", "feature_request", "other"]),
    message: z.string().trim().min(1).max(4000),
    tool: z.string().max(64).optional(),
    details: z.string().max(4000).optional(),
    screen: z.string().trim().max(64).optional().describe("The part of the web app a person sent it from. Agents leave it out."),
    reply: z.boolean().optional().describe("Web app only: send the person's address with it, so they can be answered. Agents leave it out."),
  }),
  rest: { method: "POST", path: "/feedback" },
  mcp: { tool: "submit_feedback" },
  // Turned off for the connection, it is refused in execute before its input is read (feedbackOff).
  async handler(ctx, input) {
    if (input.reply && ctx.principal.surface !== "web") throw invalid("invalid_input", "Only a person shares their address for a reply, in the web app. Leave reply out.");
    await countFeedback(ctx.db, ctx.principal.account_id);
    const feedback_id = newId();
    await ctx.db
      .insertInto("feedback")
      .values({
        feedback_id, tenant_id: null, category: input.category, message: input.message, tool: input.tool ?? null, details: input.details ?? null,
        server_version: ctx.ports.config.serverVersion, surface: ctx.principal.surface, client: clientFamily(ctx.principal) || null, screen: input.screen || null,
        reply_to: input.reply && ctx.principal.email ? ctx.principal.email : null,
      })
      .execute();
    const note = input.reply
      ? "Thank you. It goes to the developer of WhatBuild with your address, so they can answer."
      : "Thank you. It goes to the developer of WhatBuild without your name or address; there is no reply channel.";
    return { feedback_id, received: true, note };
  },
});

export const metaOps = [getSkill, submitFeedback];
