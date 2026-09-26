// Embed packages/core/src/skill/SKILL.md as a TypeScript string, so the skill ships inside the
// server bundle and can never be missing from a deployed image. A test fails when they drift.
import { readFileSync, writeFileSync } from "node:fs";

const src = new URL("../packages/core/src/skill/SKILL.md", import.meta.url);
const out = new URL("../packages/core/src/skill/skill-text.ts", import.meta.url);
const md = readFileSync(src, "utf8");
writeFileSync(out, `// Generated from SKILL.md by scripts/gen-skill.mjs. Edit SKILL.md, then run pnpm gen:skill.\nexport const SKILL_TEMPLATE = ${JSON.stringify(md)};\n`);
console.log("wrote", out.pathname);
