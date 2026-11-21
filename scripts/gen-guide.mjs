// Embed the guide's topics, packages/core/src/guide/NN-<topic>.md, as TypeScript, so the guide
// ships inside the server bundle and can never be missing from a deployed image. Each file starts
// with "# <Title>", then a one-sentence summary that the guide's index shows. CI fails when the
// embedded copy drifts.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../packages/core/src/guide/", import.meta.url);
const out = new URL("guide-text.ts", dir);
const topics = readdirSync(dir)
  .filter((f) => /^\d\d-[a-z0-9-]+\.md$/.test(f))
  .sort()
  .map((file) => {
    const md = readFileSync(new URL(file, dir), "utf8").replace(/\r\n/g, "\n");
    const title = /^# (.+)\n/.exec(md)?.[1];
    const summary = /^# [^\n]+\n\n(.+?)\n(\n|$)/s.exec(md)?.[1]?.replace(/\n/g, " ");
    if (!title || !summary) throw new Error(`${file} must start with "# <Title>", a blank line and a one-sentence summary`);
    return { topic: file.slice(3, -3), title, summary, text: md.trimEnd() + "\n" };
  });
if (!topics.length) throw new Error("no guide topics found");
writeFileSync(
  out,
  `// Generated from packages/core/src/guide/*.md by scripts/gen-guide.mjs. Edit the Markdown, then run pnpm gen:guide.\n` +
    `export const GUIDE_TOPICS = ${JSON.stringify(topics, null, 2)} as const;\n`,
);
console.log("wrote", out.pathname, `(${topics.length} topics)`);

// The starter every product's Playbook begins with, packages/core/src/playbook-starter/**/*.md, embedded the
// same way: a product serves it until its first write copies it in.
const starterDir = new URL("../packages/core/src/playbook-starter/", import.meta.url);
const starterOut = new URL("starter-text.ts", starterDir);
const starter = readdirSync(starterDir, { recursive: true })
  .map(String)
  .map((p) => p.split("\\").join("/"))
  .filter((p) => p.endsWith(".md"))
  .sort()
  .map((path) => {
    const content = readFileSync(new URL(path, starterDir), "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";
    if (!content.startsWith("---\n") || !/\ntype: \S/.test(content.split("\n---\n")[0])) throw new Error(`${path} must start with frontmatter that names its type`);
    return { path, content };
  });
if (!starter.length) throw new Error("no Playbook starter files found");
writeFileSync(
  starterOut,
  `// Generated from packages/core/src/playbook-starter/**/*.md by scripts/gen-guide.mjs. Edit the Markdown, then run pnpm gen:guide.\n` +
    `export const PLAYBOOK_STARTER: readonly { path: string; content: string }[] = ${JSON.stringify(starter, null, 2)};\n`,
);
console.log("wrote", starterOut.pathname, `(${starter.length} files)`);
