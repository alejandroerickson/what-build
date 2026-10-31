// Bundle the server for production: our own TypeScript (server, core, parsers) into dist/main.js;
// the entry of the child process each file is parsed in (src/parse-child.ts, which holds nothing of
// the server) into dist/parse-child.js beside it, where src/parse-process.ts looks for it; and the
// entry of the worker thread that process parses in (src/parse-worker.ts, the parsers alone) into
// dist/parse-worker.js, where src/parse-child.ts looks for it; with the few
// npm packages that do not bundle cleanly left external. packages/server-external lists them, so
// that pnpm-lock.yaml holds what the image installs beside the bundle (deploy/Dockerfile).
// Migrations are copied beside the bundle, where the migration runner looks for them, and
// build.json records the commit (WHATBUILD_COMMIT, which the image build passes in) and when the
// bundle was built, for the release the server reports.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const root = join(here, "../..");
const manifestOf = (dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
// pdfjs loads its worker by relative path; the cloud clients (and Google's sign-in for sending
// traces) and nodemailer are large and load lazily. pg-native is an optional part of pg that nothing
// installs.
const SHIPPED = Object.keys(manifestOf("packages/server-external").dependencies);
const EXTERNAL = [...SHIPPED, "pg-native"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
await build({
  entryPoints: { main: join(here, "src/main.ts"), "parse-child": join(here, "src/parse-child.ts"), "parse-worker": join(here, "src/parse-worker.ts") },
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

const requireFrom = (dir) => createRequire(join(root, dir, "package.json"));
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
// The tests run the code against the versions the packages that import it resolve, and the image
// runs it against the versions packages/server-external resolves: they must be the same.
const shipped = Object.fromEntries(SHIPPED.map((name) => [name, versionOf(name, requireFrom("packages/server-external"))]));
for (const dir of ["apps/server", "packages/parsers"]) {
  for (const name of SHIPPED.filter((n) => manifestOf(dir).dependencies[n])) {
    const version = versionOf(name, requireFrom(dir));
    if (version !== shipped[name]) throw new Error(`${dir} resolves ${name}@${version}, but packages/server-external ships ${shipped[name]}: raise both to one version`);
  }
}
// What makes the bundle ES modules; the image installs its packages from pnpm-lock.yaml.
writeFileSync(join(dist, "package.json"), JSON.stringify({ name: "whatbuild-server", private: true, type: "module" }, null, 2) + "\n");
console.log("dist/ ready:", Object.entries(shipped).map(([k, v]) => `${k}@${v}`).join(", "));
