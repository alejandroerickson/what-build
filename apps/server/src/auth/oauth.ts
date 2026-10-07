import { createHash, timingSafeEqual } from "node:crypto";
import { escapeHtml, json, newId, randomToken, sha256Hex, type Db } from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ServerConfig } from "../config.ts";
import { connectorBound, connectorReach, type ConnectorReach } from "./connector-reach.ts";
import { accountBySession, ACCESS_PREFIX, REFRESH_PREFIX, SESSION_COOKIE } from "./identity.ts";

/**
 * A small OAuth 2.1 authorization server for MCP clients, per the MCP authorization spec:
 * protected-resource metadata (RFC 9728), authorization-server metadata (RFC 8414), dynamic client
 * registration (RFC 7591), authorization code with PKCE S256, refresh-token rotation, and resource
 * indicators (RFC 8707). A token represents the person who approved it — never more than they can
 * do themselves — and every call it makes is attributed to them, through the agent.
 */

const SCOPE = "whatbuild";

function oauthError(c: Context, status: 400 | 401, error: string, description: string) {
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
}

function validRedirectUri(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password || /[\s\\]/.test(u)) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Private-use schemes (RFC 8252) for native clients, e.g. cursor://, vscode://
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(url.protocol);
}

/** A CSP source for a validated redirect URI: its origin (https, loopback http), or its private-use scheme. */
function formTarget(u: string): string {
  const url = new URL(u);
  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : url.protocol;
}

/** What the consent page says the agent may reach. */
function reachSentence(r: ConnectorReach): string {
  if (r.kind === "all") return "It can read and change everything you can, in every product you can open.";
  if (r.kind === "tenant")
    return `It can read and change everything you can in the organization <strong>${escapeHtml(r.name ?? r.path)}</strong>, and nothing outside it.`;
  const where = r.name ? `${escapeHtml(r.name)}</strong>${r.tenant_name ? ` (${escapeHtml(r.tenant_name)})` : ""}` : `${escapeHtml(r.path)}</strong>`;
  return `It can read and change everything you can in the product <strong>${where}, and nothing outside it.`;
}

function consentPage(p: { client: string; account: string; email: string; reach: ConnectorReach; hidden: Record<string, string>; csrf: string }) {
  const inputs = Object.entries(p.hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect ${escapeHtml(p.client)} · WhatBuild</title>
<style>
:root{color-scheme:light dark;--canvas:#f0f0f0;--panel:#ffffff;--text:#1e1e1e;--muted:#555555;--line:#e6e6e6;--line-2:#d5d5d5;--hover:#f2f2f2;--accent:#5a53e8;--accent-hover:#4a43d6;--accent-text:#ffffff;--shadow:0 2px 5px rgb(0 0 0 / .08),0 0 0 .5px rgb(0 0 0 / .12)}
@media (prefers-color-scheme:dark){:root{--canvas:#1b1b1b;--panel:#2a2a2a;--text:#ededed;--muted:#bdbdbd;--line:#383838;--line-2:#474747;--hover:#353535;--accent:#8b85ff;--accent-hover:#a09bff;--accent-text:#15142b;--shadow:0 2px 5px rgb(0 0 0 / .4),0 0 0 .5px rgb(255 255 255 / .08)}}
body{margin:0;background:var(--canvas);color:var(--text);font:13px/1.55 "Inter Variable","Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;margin:12vh auto;padding:24px;background:var(--panel);border-radius:12px;box-shadow:var(--shadow)}
@media (max-width:32rem){main{margin:16px 10px}}
h1{font-size:20px;font-weight:600;line-height:1.25;letter-spacing:-.01em;margin:0 0 16px}
p{margin:0 0 12px}.muted{color:var(--muted);font-size:12px}
.row{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}
button{font:inherit;font-weight:500;height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--line-2);background:var(--panel);color:var(--text);cursor:pointer}
button:hover{background:var(--hover)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button[value=allow]{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
button[value=allow]:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
</style></head><body><main>
<h1>Let ${escapeHtml(p.client)} work in WhatBuild as you?</h1>
<p>Signed in as <strong>${escapeHtml(p.account)}</strong> (${escapeHtml(p.email)}).</p>
<p>${reachSentence(p.reach)} Its changes are recorded as yours, made through the agent.</p>
<p class="muted">What it reads goes to whoever runs the agent, under their terms, not ours.</p>
<form method="post" action="/oauth/authorize">${inputs}<input type="hidden" name="csrf" value="${escapeHtml(p.csrf)}">
<div class="row"><button type="submit" name="decision" value="allow">Allow</button><button type="submit" name="decision" value="deny">Deny</button></div>
</form></main></body></html>`;
}

export function oauthRoutes(deps: { db: Db; config: ServerConfig }) {
  const { db, config } = deps;
  const base = config.publicBaseUrl;
  const app = new Hono();
  const secure = base.startsWith("https://");

  const resourceMetadata = (path: string) => ({
    resource: `${base}${path}`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "WhatBuild",
    resource_documentation: `${base}/connect`,
  });

  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resourceMetadata("/mcp")));
  app.get("/.well-known/oauth-protected-resource/*", (c) => {
    const path = c.req.path.slice("/.well-known/oauth-protected-resource".length) || "/mcp";
    return c.json(resourceMetadata(path.startsWith("/mcp") ? path : "/mcp"));
  });

  const asMetadata = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  };
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(asMetadata));
  app.get("/.well-known/oauth-authorization-server/*", (c) => c.json(asMetadata));

  app.post("/oauth/register", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
    c.header("Cache-Control", "no-store");
    if (!body || !Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 10)
      return oauthError(c, 400, "invalid_redirect_uri", "redirect_uris must list 1 to 10 URIs.");
    const uris = body.redirect_uris.map(String);
    const bad = uris.find((u) => !validRedirectUri(u));
    if (bad) return oauthError(c, 400, "invalid_redirect_uri", `Not an acceptable redirect URI: ${bad}. Use https, http on a loopback host, or a private-use scheme.`);
    const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "An MCP client";
    const client_id = `wbc_${newId().toLowerCase()}`;
    await db.insertInto("oauth_clients").values({ client_id, client_name: name, redirect_uris: json(uris) }).execute();
    return c.json(
      {
        client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPE,
      },
      201,
    );
  });

  const loadClient = (id: string) => db.selectFrom("oauth_clients").selectAll().where("client_id", "=", id).executeTakeFirst();

  app.get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    const client = q["client_id"] ? await loadClient(q["client_id"]) : undefined;
    if (!client) return c.text("Unknown client. The MCP client must register first.", 400);
    const redirect = q["redirect_uri"] ?? "";
    if (!client.redirect_uris.includes(redirect)) return c.text("That redirect URI is not registered for this client.", 400);
    const back = (params: Record<string, string>) => {
      const u = new URL(redirect);
      for (const [k, v] of Object.entries({ ...params, ...(q["state"] ? { state: q["state"] } : {}), iss: base })) u.searchParams.set(k, v);
      return c.redirect(u.toString());
    };
    if (q["response_type"] !== "code") return back({ error: "unsupported_response_type" });
    if (!q["code_challenge"] || q["code_challenge_method"] !== "S256") return back({ error: "invalid_request", error_description: "PKCE with S256 is required." });
    const resource = q["resource"] ?? `${base}/mcp`;
    if (!resource.startsWith(`${base}/mcp`) || connectorBound(new URL(resource).pathname) === undefined)
      return back({ error: "invalid_target", error_description: "This server issues tokens only for its MCP endpoints: /mcp, /mcp/t/<organization> and /mcp/t/<organization>/<team>/<product>." });
    const session = getCookie(c, SESSION_COOKIE);
    const account = session ? await accountBySession(db, session) : null;
    if (!account) return c.redirect(`/signin?next=${encodeURIComponent(c.req.url.replace(/^https?:\/\/[^/]+/, ""))}`);
    const csrf = randomToken(16);
    setCookie(c, "wb_consent", csrf, { httpOnly: true, secure, sameSite: "Strict", path: "/oauth/authorize", maxAge: 900 });
    c.header("X-Frame-Options", "DENY");
    // Browsers apply form-action to the redirect that answers the form too, so the client's own
    // registered callback must be allowed here, or Allow silently goes nowhere.
    c.header("Content-Security-Policy", `frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formTarget(redirect)}`);
    return c.html(
      consentPage({
        client: client.client_name,
        account: account.display_name,
        email: account.email,
        reach: await connectorReach(db, account.account_id, resource),
        csrf,
        hidden: { client_id: client.client_id, redirect_uri: redirect, code_challenge: q["code_challenge"], state: q["state"] ?? "", resource, scope: q["scope"] ?? SCOPE },
      }),
    );
  });

  app.post("/oauth/authorize", async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>;
    const expected = getCookie(c, "wb_consent");
    if (!expected || !f["csrf"] || expected.length !== f["csrf"].length || !timingSafeEqual(Buffer.from(expected), Buffer.from(f["csrf"])))
      return c.text("This consent form expired. Start the connection again from your MCP client.", 400);
    const client = await loadClient(f["client_id"] ?? "");
    if (!client || !client.redirect_uris.includes(f["redirect_uri"] ?? "")) return c.text("Unknown client or redirect URI.", 400);
    const session = getCookie(c, SESSION_COOKIE);
    const account = session ? await accountBySession(db, session) : null;
    if (!account) return c.text("Sign in first.", 401);
    const u = new URL(f["redirect_uri"]!);
    if (f["state"]) u.searchParams.set("state", f["state"]);
    u.searchParams.set("iss", base);
    if (f["decision"] !== "allow") {
      u.searchParams.set("error", "access_denied");
      return c.redirect(u.toString());
    }
    const code = randomToken();
    await db
      .insertInto("oauth_codes")
      .values({
        code_hash: sha256Hex(code), client_id: client.client_id, account_id: account.account_id, redirect_uri: f["redirect_uri"]!,
        code_challenge: f["code_challenge"] ?? "", resource: f["resource"] ?? `${base}/mcp`, scope: SCOPE, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
      .execute();
    u.searchParams.set("code", code);
    return c.redirect(u.toString());
  });

  const issue = async (client_id: string, account_id: string, resource: string, family: string) => {
    const access = `${ACCESS_PREFIX}${randomToken(30)}`;
    const refresh = `${REFRESH_PREFIX}${randomToken(30)}`;
    await db
      .insertInto("oauth_tokens")
      .values([
        { token_hash: sha256Hex(access), kind: "access", client_id, account_id, resource, scope: SCOPE, family_id: family, expires_at: new Date(Date.now() + config.accessTokenSeconds * 1000).toISOString() },
        { token_hash: sha256Hex(refresh), kind: "refresh", client_id, account_id, resource, scope: SCOPE, family_id: family, expires_at: new Date(Date.now() + config.refreshTokenDays * 86400_000).toISOString() },
      ])
      .execute();
    return { access_token: access, token_type: "Bearer", expires_in: config.accessTokenSeconds, refresh_token: refresh, scope: SCOPE };
  };

  app.post("/oauth/token", async (c) => {
    c.header("Cache-Control", "no-store");
    const ct = c.req.header("content-type") ?? "";
    const f = (ct.includes("application/json") ? await c.req.json().catch(() => ({})) : await c.req.parseBody()) as Record<string, string>;
    const client = f["client_id"] ? await loadClient(f["client_id"]) : undefined;
    if (!client) return oauthError(c, 401, "invalid_client", "Unknown client_id.");
    if (f["grant_type"] === "authorization_code") {
      const row = await db.selectFrom("oauth_codes").selectAll().where("code_hash", "=", sha256Hex(f["code"] ?? "")).executeTakeFirst();
      if (!row || row.used_at || Date.parse(row.expires_at) < Date.now() || row.client_id !== client.client_id)
        return oauthError(c, 400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
      await db.updateTable("oauth_codes").set({ used_at: new Date().toISOString() }).where("code_hash", "=", row.code_hash).execute();
      if (f["redirect_uri"] !== row.redirect_uri) return oauthError(c, 400, "invalid_grant", "redirect_uri does not match the authorization request.");
      const challenge = createHash("sha256").update(f["code_verifier"] ?? "").digest("base64url");
      if (challenge !== row.code_challenge) return oauthError(c, 400, "invalid_grant", "PKCE verification failed.");
      if (f["resource"] && f["resource"] !== row.resource) return oauthError(c, 400, "invalid_target", "resource does not match the authorization request.");
      return c.json(await issue(client.client_id, row.account_id, row.resource, newId()));
    }
    if (f["grant_type"] === "refresh_token") {
      const row = await db.selectFrom("oauth_tokens").selectAll().where("token_hash", "=", sha256Hex(f["refresh_token"] ?? "")).where("kind", "=", "refresh").executeTakeFirst();
      if (!row || row.client_id !== client.client_id || Date.parse(row.expires_at) < Date.now()) return oauthError(c, 400, "invalid_grant", "The refresh token is invalid or expired.");
      if (row.revoked_at) {
        // A reused refresh token means it leaked: revoke the whole family.
        await db.updateTable("oauth_tokens").set({ revoked_at: new Date().toISOString() }).where("family_id", "=", row.family_id).where("revoked_at", "is", null).execute();
        return oauthError(c, 400, "invalid_grant", "This refresh token was already used; the connection has been revoked. Sign in again.");
      }
      await db.updateTable("oauth_tokens").set({ revoked_at: new Date().toISOString() }).where("token_hash", "=", row.token_hash).execute();
      return c.json(await issue(client.client_id, row.account_id, row.resource, row.family_id));
    }
    return oauthError(c, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  });

  app.post("/oauth/revoke", async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>;
    const row = await db.selectFrom("oauth_tokens").select(["family_id"]).where("token_hash", "=", sha256Hex(f["token"] ?? "")).executeTakeFirst();
    if (row) await db.updateTable("oauth_tokens").set({ revoked_at: new Date().toISOString() }).where("family_id", "=", row.family_id).where("revoked_at", "is", null).execute();
    return c.body(null, 200);
  });

  return app;
}
