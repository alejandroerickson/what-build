import { roleAtLeast } from "./policy.ts";
import type { OperationDef, ProductRole } from "./registry.ts";

/**
 * What an open tab may be told when something in a product changes: which part of the product, and
 * nothing else. No id, no title, no name, no words of anyone's. The tab reads what changed through
 * the same operations as any other read, which decide what it may see.
 *
 * `story` alone reaches someone who reads only the Story. A change nobody labelled is `other`, which
 * does not reach them, so a new kind of operation tells a Story reader nothing until someone decides it should.
 */
export const LIVE_AREAS = ["story", "idea", "evidence", "exploration", "other"] as const;
export type LiveArea = (typeof LIVE_AREAS)[number];

/** Which part of a product each kind of operation changes. */
const AREA_OF_TOOL: Readonly<Record<string, LiveArea>> = {
  story: "story",
  outcomes: "idea",
  products: "idea",
  sources: "evidence",
  attachments: "evidence",
  derived: "evidence",
  mockups: "exploration",
};

/** The part of a product an operation changes; `other` for any kind not named above. */
export function liveArea(op: Pick<OperationDef, "mcp">): LiveArea {
  return Object.hasOwn(AREA_OF_TOOL, op.mcp.tool) ? AREA_OF_TOOL[op.mcp.tool]! : "other";
}

/** Of the areas that changed, those someone with this role may hear of: all of them from viewer up, and the Story's for anyone below. */
export function areasFor(role: ProductRole, areas: Iterable<LiveArea>): LiveArea[] {
  const all = [...areas];
  return roleAtLeast(role, "viewer") ? all : all.filter((a) => a === "story");
}

/**
 * The one message a stream carries, written from the list above and nothing the caller holds, so no
 * mistake elsewhere can put anything else on the wire. A test pins its exact form.
 */
export function liveMessage(areas: readonly LiveArea[]): string {
  const named = LIVE_AREAS.filter((a) => areas.includes(a));
  if (!named.length) throw new Error("A live message names at least one area.");
  return `event: change\ndata: ${JSON.stringify({ areas: named })}\n\n`;
}
