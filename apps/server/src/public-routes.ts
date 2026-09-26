import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { SKILL_NAME, SKILL_VERSION, skillMarkdown, unauthenticated, type Db } from "@whatbuild/core";
import { strToU8, zipSync } from "fflate";
import { Hono } from "hono";
import { restPrincipal } from "./auth/identity.ts";
import type { ServerConfig } from "./config.ts";

function installSh(base: string) {
  const md = skillMarkdown();
  return `#!/bin/sh
# Installs the ${SKILL_NAME} skill (version ${SKILL_VERSION}) for Claude Code, and prints how to connect.
# It writes one file and changes nothing else. Read it before you run it.
set -eu
dir="$HOME/.claude/skills/${SKILL_NAME}"
mkdir -p "$dir"
cat > "$dir/SKILL.md" <<'WHATBUILD_SKILL_EOF'
${md}
WHATBUILD_SKILL_EOF
echo "Wrote $dir/SKILL.md (version ${SKILL_VERSION})."
echo
echo "Connect Claude Code to WhatBuild (you will sign in in your browser):"
echo "  claude mcp add --transport http whatbuild ${base}/mcp"
`;
}

function installPs1(base: string) {
  const md = skillMarkdown().replace(/'/g, "''");
  return `# Installs the ${SKILL_NAME} skill (version ${SKILL_VERSION}) for Claude Code, and prints how to connect.
# It writes one file and changes nothing else. Read it before you run it.
$dir = Join-Path $HOME ".claude/skills/${SKILL_NAME}"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$skill = @'
${md}
'@
Set-Content -Path (Join-Path $dir "SKILL.md") -Value $skill -Encoding UTF8
Write-Output "Wrote $dir/SKILL.md (version ${SKILL_VERSION})."
Write-Output ""
Write-Output "Connect Claude Code to WhatBuild (you will sign in in your browser):"
Write-Output "  claude mcp add --transport http whatbuild ${base}/mcp"
`;
}

export function publicRoutes(deps: { db: Db; config: ServerConfig; serverVersion: string }) {
  const { config } = deps;
  const base = config.publicBaseUrl;
  const app = new Hono();
  const noStore = { "Cache-Control": "no-store" };

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/api/v1/meta", (c) =>
    c.json({
      product: "WhatBuild",
      server_version: deps.serverVersion,
      skill: { name: SKILL_NAME, version: SKILL_VERSION },
      auth: { email_link: config.mailer !== "none", google: Boolean(config.googleClientId && config.googleClientSecret), dev: config.devAuth },
      inference: "none: WhatBuild runs no language model; intelligence comes from the agent you connect",
    }),
  );
  app.get(`/${SKILL_NAME}-skill.md`, (c) => c.text(skillMarkdown(), 200, { ...noStore, "Content-Type": "text/markdown; charset=utf-8" }));
  app.get(`/${SKILL_NAME}-skill.zip`, (c) => {
    const zip = zipSync({ [`${SKILL_NAME}/SKILL.md`]: strToU8(skillMarkdown()) });
    return c.body(zip, 200, { ...noStore, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${SKILL_NAME}-skill.zip"` });
  });
  app.get("/install.sh", (c) => c.text(installSh(base), 200, { ...noStore, "Content-Type": "text/x-shellscript; charset=utf-8" }));
  app.get("/install.ps1", (c) => c.text(installPs1(base), 200, { ...noStore, "Content-Type": "text/plain; charset=utf-8" }));

  app.get("/api/v1/connect", async (c) => {
    const p = await restPrincipal(c, deps.db);
    if (!p) throw unauthenticated();
    return c.json({
      mcp_url: `${base}/mcp`,
      bound_url_template: `${base}/mcp/t/{tenant}/{team}/{product}`,
      oauth: { authorization_server: base, protected_resource_metadata: `${base}/.well-known/oauth-protected-resource/mcp`, dynamic_client_registration: true },
      skill: { name: SKILL_NAME, version: SKILL_VERSION, markdown_url: `${base}/${SKILL_NAME}-skill.md`, zip_url: `${base}/${SKILL_NAME}-skill.zip`, install_sh: `${base}/install.sh`, install_ps1: `${base}/install.ps1` },
      agent_data_statement: "Connecting an agent sends your passages to whoever runs that agent, under their terms, not ours.",
    });
  });
  return app;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * The web app, served from the same origin as the API: no CORS, one sign-in boundary. Hashed assets
 * are cached forever; index.html never. An unknown path without an extension is the app shell; an
 * unknown path with one is a 404, so a stale chunk after a deploy is never answered with HTML.
 */
export function staticRoutes(dist: string) {
  const root = resolve(dist);
  const app = new Hono();
  const indexPath = join(root, "index.html");
  const hasIndex = existsSync(indexPath);
  if (!hasIndex) console.warn(`No web app at ${root}: serving the API and MCP only.`);
  const security = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  };
  app.get("*", (c) => {
    if (!hasIndex) return c.notFound();
    const rel = normalize(decodeURIComponent(c.req.path)).replace(/^([/\\])+/, "");
    const file = join(root, rel);
    if (file.startsWith(root) && rel && existsSync(file) && statSync(file).isFile()) {
      const immutable = rel.startsWith("assets/");
      return c.body(readFileSync(file), 200, {
        ...security,
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      });
    }
    if (extname(rel)) return c.notFound();
    return c.body(readFileSync(indexPath), 200, { ...security, "Content-Type": TYPES[".html"]!, "Cache-Control": "no-cache" });
  });
  return app;
}
