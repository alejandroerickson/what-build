import { z } from "zod";
import { forbidden } from "../errors.ts";
import { OPERATIONS } from "../index.ts";
import { defineOperation } from "../registry.ts";
import { isInstanceOwner } from "../tenant-allowance.ts";
import { usageReport } from "../usage.ts";

/** How the service is used, for the instance's owners: counted on the server, so agents and people who declined cookies are in it. */
export const readUsage = defineOperation({
  name: "products.usage",
  scope: "account",
  access: "any",
  mutates: false,
  summary: "How this instance is used: operations, features, agent clients, failures, and people coming back (instance owners).",
  description:
    "Counts every call to an operation, through the web app and through agents, over the last `days` days, today (UTC) included. Returns calls (total, web, agents, failed); people (active, web, agents, new, returning, days_active, weeks with new and returning, and cohorts: each week's newcomers, then how many of them came back in each week after); features (an MCP tool's name: people and calls); operations (calls by door, failed); clients (agent families such as Claude or Cursor: people and calls); failures by operation and error code; and not_called, every operation nobody called. It never names an organization, a product, a record or a person: people are counted under a pseudonym only this deployment can compute. The instance's owners are left out unless include_owners is true. example chooses whether calls in the example organization are included, excluded or the only ones counted; before the example organization replaced the public sandbox, those were the sandbox's calls. counting_since says when counting began: everyone counted before then shows as new. Calls through the web app include its own reads, so compare people rather than calls across doors.",
  input: z.strictObject({
    days: z.number().int().min(1).max(400).default(28).describe("How many days back, today included. 1 to 400; 28 by default."),
    include_owners: z.boolean().default(false).describe("Count the instance's owners too. Off by default, so their testing does not hide everyone else."),
    example: z.enum(["include", "exclude", "only"]).default("include").describe("Calls in the example organization: include (default), exclude, or only."),
  }),
  rest: { method: "GET", path: "/usage" },
  mcp: { tool: "products", action: "usage" },
  async handler(ctx, input) {
    if (!isInstanceOwner(ctx.ports.config, ctx.principal.email))
      throw forbidden("Only an owner of this WhatBuild instance can see how it’s used.");
    return usageReport(ctx.db, OPERATIONS, input);
  },
});

export const usageOps = [readUsage];
