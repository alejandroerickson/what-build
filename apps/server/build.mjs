// Bundle the server for production: our own TypeScript (server, core, parsers) into dist/main.js,
// and the entry of the worker thread each file is parsed in (src/parse-worker.ts, the parsers
// alone) into dist/parse-worker.js beside it, where src/parse-thread.ts looks for it; with the few
// npm packages that do not bundle cleanly left external and listed in dist/package.json
// for `npm install --omit=dev` in the image. Migrations are copied beside the bundle, where the
// migration runner looks for them, and build.json records the commit (WHATBUILD_COMMIT, which the
// image build passes in) and when the bundle was built, for the release the server reports.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
// pdfjs loads its worker by relative path; the cloud clients and nodemailer are large and load lazily.
const EXTERNAL = ["pdfjs-dist", "@google-cloud/storage", "nodemailer", "@azure/communication-email", "@azure/identity", "pg-native"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
await build({
  entryPoints: { main: join(here, "src/main.ts"), "parse-worker": join(here, "src/parse-worker.ts") },
  outdir: dist,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: EXTERNAL,
  // Some bundled CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
cpSync(join(here, "src/migrations"), join(dist, "migrations"), { recursive: true });
// The typefaces Story pages carry, with their licence, where packages/core/src/story-fonts.ts looks for them from the bundle.
cpSync(join(here, "../../packages/core/src/story-fonts"), join(dist, "story-fonts"), { recursive: true });
const commit = /^[0-9a-f]{40}$/.test(process.env.WHATBUILD_COMMIT ?? "") ? process.env.WHATBUILD_COMMIT : null;
writeFileSync(join(dist, "build.json"), JSON.stringify({ commit, built_at: new Date().toISOString() }) + "\n");

const req = createRequire(join(here, "../../packages/parsers/package.json"));
const reqServer = createRequire(join(here, "package.json"));
// Walk up from the resolved entry: not every package exports its package.json.
const versionOf = (name, r) => {
  let dir = dirname(r.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === name) return pkg.version;
    } catch {
      // keep walking up
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`cannot find the version of ${name}`);
    dir = up;
  }
};
const deps = {
  "pdfjs-dist": versionOf("pdfjs-dist", req),
  "@google-cloud/storage": versionOf("@google-cloud/storage", reqServer),
  nodemailer: versionOf("nodemailer", reqServer),
  "@azure/communication-email": versionOf("@azure/communication-email", reqServer),
  "@azure/identity": versionOf("@azure/identity", reqServer),
};
writeFileSync(join(dist, "package.json"), JSON.stringify({ name: "whatbuild-server", private: true, type: "module", dependencies: deps }, null, 2) + "\n");
console.log("dist/ ready:", Object.entries(deps).map(([k, v]) => `${k}@${v}`).join(", "));
