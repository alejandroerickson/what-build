import { LIMITS, type PlanDefinition } from "@whatbuild/core";
import { plansFrom, startingPlanFrom } from "./plans-config.ts";

/**
 * `pnpm plans <file or JSON> [starting plan]`: read a deployment's plans as the server would at
 * start-up, and print them, or what is wrong, before the file goes anywhere near a deployment.
 */
const [given, starting] = process.argv.slice(2);
if (!given) {
  console.error("Usage: pnpm plans <plans file, or its JSON> [the plan new organizations start on]\nThe form is deploy/plans.example.json.");
  process.exit(2);
}
let plans: PlanDefinition[];
let start: string;
try {
  plans = plansFrom(given);
  start = startingPlanFrom(starting, plans);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const MB = 1024 * 1024;
const GB = 1024 * MB;
const size = (v: number) => (v >= GB ? `${Math.round((v / GB) * 10) / 10} GB` : `${Math.round((v / MB) * 10) / 10} MB`);
const show = (v: number | boolean | null, unit: string) =>
  v === null ? "no limit" : typeof v === "boolean" ? (v ? "on" : "off") : unit === "bytes" ? size(v) : v.toLocaleString("en-US");
if (!plans.length) console.log("No plans: every organization is unlimited, and the app says nothing of plans.");
for (const p of plans) {
  console.log(`${p.id}: ${p.name}${p.price ? ` (${p.price})` : ""}${p.id === start ? ", where new organizations start" : ""}`);
  if (p.about) console.log(`  ${p.about}`);
  for (const l of LIMITS) console.log(`  ${l.label} (${l.key}): ${show(p.limits[l.key], l.unit)}`);
}
if (start === "unlimited" && plans.length) console.log("New organizations start unlimited: name one of these plans as the starting plan to have them meet its limits.");
