import { z } from "zod";
import { FILE_ROLES, LIFECYCLE_STAGES, PROVENANCE_DEPTHS } from "./source-fields.ts";
import { ULID_PATTERN } from "./util.ts";

export const id = (what: string) =>
  z.string().regex(ULID_PATTERN, `must be a ${what} id: 26 characters of Crockford base32`).describe(`The ${what} id.`);

export const slug = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lower-case letters, digits and hyphens");

export const limit = (def: number, max: number) =>
  z.number().int().min(1).max(max).default(def).describe(`Page size, default ${def}, at most ${max}. More is refused, not clamped.`);

export const cursor = z.string().max(500).optional().describe("Pass next_cursor from the previous page.");

export const expectedEtag = z
  .string()
  .min(1)
  .max(200)
  .describe("The etag from your latest read of this item. A stale one is refused with 409 stale_etag.");

export const provenanceDepth = z.enum(PROVENANCE_DEPTHS).describe("How far the item sits from original evidence.");
export const fileRole = z.enum(FILE_ROLES);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as yyyy-mm-dd");

export const dimensions = z
  .strictObject({
    customer: z.string().min(1).max(120).nullable().optional(),
    product_area: z.string().min(1).max(120).nullable().optional(),
    lifecycle_stage: z.enum(LIFECYCLE_STAGES).nullable().optional(),
  })
  .describe("Domain-neutral dimensions. Values are normalized (case and spacing) on write.");

export const tags = z.array(z.string().min(1).max(50)).max(50).describe("Up to 50 tags, stored lower-case.");

export const authorType = z
  .enum(["human", "agent"])
  .describe("Who exercised judgment. An agent writing with a person's credentials is still an agent unless relaying the person's own words.");

/** Format zod issues as one message an agent can act on. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(input)";
      if (i.code === "unrecognized_keys") return `${path}: unknown field(s) ${(i as { keys: string[] }).keys.join(", ")}`;
      return `${path}: ${i.message}`;
    })
    .join("; ");
}
