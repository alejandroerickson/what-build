import { z } from "zod";
import { invalid } from "../errors.ts";
import { countFeedback, FEEDBACK_PER_DAY } from "../feedback.ts";
import { defineOperation } from "../registry.ts";
import { GUIDE_TOPICS } from "../guide/guide-text.ts";
import { clientFamily } from "../usage.ts";
import { newId } from "../util.ts";

/** The MCP server's name, as `initialize` gives it. */
export const MCP_SERVER_NAME = "whatbuild";

/**
 * One knob: the MCP server's version, which every product's answer gives as `tools_version`. Bump
 * it when the tools, their actions or the guide change: a client keeps the tool list it got when it
 * connected, and a newer version in an answer tells its agent that list is older.
 */
export const TOOLS_VERSION = "0.42.0";

export type GuideTopic = (typeof GUIDE_TOPICS)[number]["topic"];
const TOPIC_NAMES = GUIDE_TOPICS.map((t) => t.topic) as [GuideTopic, ...GuideTopic[]];

/** The guide's topics, each with its title and a sentence saying what it covers. */
export function guideIndex() {
  return GUIDE_TOPICS.map(({ topic, title, summary }) => ({ topic, title, summary }));
}

/** One topic of the guide as Markdown, or undefined for a topic it does not have. */
export function guideTopic(topic: string): string | undefined {
  return GUIDE_TOPICS.find((t) => t.topic === topic)?.text;
}

export const guide = defineOperation({
  name: "guide",
  scope: "account",
  access: "any",
  mutates: false,
  summary: "Read WhatBuild's guide: how its objects, tools and rules work, one topic at a time.",
  description:
    `Without a topic it returns the index of topics and the first one, which says what WhatBuild holds and how it is organized. With a topic it returns that topic as Markdown. The guide describes this server as it runs now (version ${TOOLS_VERSION}); it changes nothing.`,
  input: z.strictObject({
    topic: z.enum(TOPIC_NAMES).optional().describe(`One of: ${TOPIC_NAMES.join(", ")}.`),
  }),
  rest: { method: "GET", path: "/guide" },
  mcp: { tool: "guide" },
  async handler(_ctx, input) {
    const topic = GUIDE_TOPICS.find((t) => t.topic === (input.topic ?? TOPIC_NAMES[0]))!;
    return {
      tools_version: TOOLS_VERSION,
      topic: topic.topic,
      title: topic.title,
      text: topic.text,
      ...(input.topic ? {} : { topics: guideIndex() }),
    };
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

export const metaOps = [guide, submitFeedback];
