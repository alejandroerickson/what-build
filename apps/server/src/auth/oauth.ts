import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { escapeHtml, json, newId, randomToken, sha256Hex, type ConnectionLevel, type Db } from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { sql } from "kysely";
import type { ServerConfig } from "../config.ts";
import { connectorBound, connectorReach, type ConnectorReach } from "./connector-reach.ts";
import { ACCESS_PREFIX, REFRESH_PREFIX, sessionAccount } from "./identity.ts";
import { authPage, authPageHeaders } from "./page.ts";

/**
 * A small OAuth 2.1 authorization server for MCP clients, per the MCP authorization spec:
 * protected-resource metadata (RFC 9728), authorization-server metadata (RFC 8414), dynamic client
 * registration (RFC 7591), authorization code with PKCE S256, refresh-token rotation, and resource
 * indicators (RFC 8707). A token represents the person who approved it — never more than they can
 * do themselves — and every call it makes is attributed to them, through the agent.
 */

const SCOPE = "whatbuild";

/** Registration is open to anyone, so what one may store is bounded. */
export const REDIRECT_URI_MAX_CHARS = 500;
/** Registrations in the last hour that have not yet led to a connection, beyond which registration waits. */
export const PENDING_REGISTRATIONS_PER_HOUR = 50;
/** A registration that never led to a connection is forgotten after this many days. */
export const UNUSED_CLIENT_DAYS = 7;

function oauthError(c: Context, status: 400 | 401 | 429, error: string, description: string) {
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
}

/** The name a client gives itself, as shown to people: printable characters, spaces collapsed, at most 100. */
function clientName(v: unknown): string {
  const name = typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 100).trim() : "";
  return name || "An MCP client";
}

/**
 * Where redirect URIs hand a connection: hosts on the web (https), or an app on the person's own
 * computer (loopback http, a private-use scheme), which nobody elsewhere can receive.
 */
export function returnsTo(uris: string[]): { hosts: string[]; local: boolean } {
  const hosts = new Set<string>();
  let local = false;
  for (const u of uris) {
    const url = new URL(u);
    if (url.protocol === "https:") hosts.add(url.host);
    else local = true;
  }
  return { hosts: [...hosts], local };
}

/**
 * Housekeeping, from the worker: authorization codes a day past their expiry, then registrations
 * that never led to a connection, after UNUSED_CLIENT_DAYS. A client that ever held a token keeps
 * its registration, since MCP clients remember theirs.
 */
export async function pruneOAuthClients(db: Db) {
  await sql`delete from oauth_codes where expires_at < now() - interval '1 day'`.execute(db);
  await sql`
    delete from oauth_clients c
    where c.created_at < now() - make_interval(days => ${UNUSED_CLIENT_DAYS})
      and not exists (select 1 from oauth_tokens t where t.client_id = c.client_id)
      and not exists (select 1 from oauth_codes o where o.client_id = c.client_id)`.execute(db);
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
  if (r.kind === "all") return "It reaches every product you can open.";
  if (r.kind === "tenant") return `It reaches the organization <strong>${escapeHtml(r.name ?? r.path)}</strong>, and nothing outside it.`;
  const where = r.name ? `${escapeHtml(r.name)}</strong>${r.tenant_name ? ` (${escapeHtml(r.tenant_name)})` : ""}` : `${escapeHtml(r.path)}</strong>`;
  return `It reaches the product <strong>${where}, and nothing outside it.`;
}

/** The levels a person chooses between, in the words the consent page and Connect an agent use. */
export const LEVEL_CHOICES: { level: ConnectionLevel; name: string; does: string }[] = [
  { level: "viewer", name: "Read only", does: "Reads what you can. Changes nothing." },
  { level: "editor", name: "Edit", does: "Reads, writes and archives. Never deletes permanently or manages products and people." },
  { level: "admin", name: "Admin", does: "Everything you can do, including deleting permanently and managing products and people." },
];

/** The level a connection gets when the person doesn't choose: it can work, and it can't delete. */
export const DEFAULT_LEVEL: ConnectionLevel = "editor";

export const isLevel = (v: unknown): v is ConnectionLevel => v === "viewer" || v === "editor" || v === "admin";

function levelChoice(): string {
  const options = LEVEL_CHOICES.map(
    (c) =>
      `<label class="choice"><input type="radio" name="level" value="${c.level}"${c.level === DEFAULT_LEVEL ? " checked" : ""}><span><b>${escapeHtml(c.name)}</b>${escapeHtml(c.does)}</span></label>`,
  ).join("");
  return `<fieldset><legend>What it may do there</legend>${options}<p class="muted">It never does more than you can yourself.</p></fieldset>`;
}

/**
 * Where Allow hands the connection, which is what a person can check: any client may call itself
 * anything, but only the holder of its redirect URI receives the code.
 */
function destinationSentence(redirect: string): string {
  const { hosts } = returnsTo([redirect]);
  return hosts.length
    ? `Allow hands this connection to <strong>${escapeHtml(hosts[0]!)}</strong>. Allow only if that’s where you’re connecting an agent right now.`
    : "Allow hands this connection to <strong>an app on this computer</strong>. Allow only if you’re connecting an agent on this computer right now.";
}

function consentPage(p: { client: string; redirect: string; account: string; email: string; reach: ConnectorReach; hidden: ConsentFields; csrf: string }) {
  const inputs = Object.entries(p.hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  const named = `“${escapeHtml(p.client)}”`;
  return authPage(
    `Connect ${p.client}`,
    `<h1>Let ${named} work in WhatBuild as you?</h1>
<p class="muted">${named} is the name the agent gave itself. WhatBuild hasn’t verified it.</p>
<p>${destinationSentence(p.redirect)}</p>
<p>Signed in as <strong>${escapeHtml(p.account)}</strong> (${escapeHtml(p.email)}).</p>
<p>${reachSentence(p.reach)} Its changes are recorded as yours, through the agent.</p>
<p class="muted">What it reads goes to whoever runs the agent, under their terms.</p>
<p class="muted">You can change or disconnect it later under Connect an agent in WhatBuild.</p>
<form method="post" action="/oauth/authorize">${inputs}<input type="hidden" name="csrf" value="${escapeHtml(p.csrf)}">
${levelChoice()}
<div class="row"><button type="submit" name="decision" value="allow" class="primary">Allow</button><button type="submit" name="decision" value="deny">Deny</button></div>
</form>`,
  );
}

/** What the consent form carries back: the authorization request the page was shown for. */
interface ConsentFields {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  resource: string;
  scope: string;
}

/**
 * A seal over what a consent page showed, for whom, and the token it gave its form, keyed with the
 * server's secret: the form's fields come back from the browser, so Allow approves them only when
 * they are still what the page showed.
 */
function consentSeal(key: string, csrf: string, accountId: string, f: Pick<ConsentFields, "client_id" | "redirect_uri" | "code_challenge" | "state" | "resource">): string {
  return createHmac("sha256", key)
    .update(JSON.stringify(["whatbuild-oauth-consent", csrf, accountId, f.client_id, f.redirect_uri, f.code_challenge, f.state, f.resource]))
    .digest("base64url");
}

function same(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
    if (uris.some((u) => u.length > REDIRECT_URI_MAX_CHARS)) return oauthError(c, 400, "invalid_redirect_uri", `A redirect URI is at most ${REDIRECT_URI_MAX_CHARS} characters.`);
    const bad = uris.find((u) => !validRedirectUri(u));
    if (bad) return oauthError(c, 400, "invalid_redirect_uri", `Not an acceptable redirect URI: ${bad}. Use https, http on a loopback host, or a private-use scheme.`);
    // Anyone may register, so registrations that have not yet led to a connection are counted, like sign-in links.
    const hourAgo = Date.now() - 3600_000;
    const pending = await db
      .selectFrom("oauth_clients as c")
      .select((eb) => [eb.fn.countAll<string>().as("n"), eb.fn.min("c.created_at").as("oldest")])
      .where("c.created_at", ">", new Date(hourAgo).toISOString())
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom("oauth_tokens as t").select("t.token_hash").whereRef("t.client_id", "=", "c.client_id"))))
      .executeTakeFirst();
    if (Number(pending?.n ?? 0) >= PENDING_REGISTRATIONS_PER_HOUR) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((Date.parse(String(pending!.oldest)) - hourAgo) / 1000))));
      return oauthError(c, 429, "rate_limited", "Too many MCP clients registered in the last hour without connecting. Try again later.");
    }
    const name = clientName(body.client_name);
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
    if (!client.redirect_uris.includes(redirect)) return c.text("That redirect URI isn’t registered for this client.", 400);
    // Anyone can register a client with any https redirect URI, so nothing goes back to it until a
    // person has chosen Allow or Deny: an error before that is said here (RFC 9700, section 4.11.2).
    const refuse = (error: string, description: string) => {
      c.header("Cache-Control", "no-store");
      return c.text(`This MCP client asked for something WhatBuild doesn’t do (${error}): ${description} Tell whoever makes the client.`, 400);
    };
    if (q["response_type"] !== "code") return refuse("unsupported_response_type", "Only the authorization code flow is supported.");
    if (!q["code_challenge"] || q["code_challenge_method"] !== "S256") return refuse("invalid_request", "PKCE with S256 is required.");
    const resource = q["resource"] ?? `${base}/mcp`;
    if (!resource.startsWith(`${base}/mcp`) || connectorBound(new URL(resource).pathname) === undefined)
      return refuse("invalid_target", "This server issues tokens only for its MCP endpoints: /mcp, /mcp/t/<organization> and /mcp/t/<organization>/<team>/<product>.");
    const account = await sessionAccount(c, db, secure);
    if (!account) return c.redirect(`/signin?next=${encodeURIComponent(c.req.url.replace(/^https?:\/\/[^/]+/, ""))}`);
    const csrf = randomToken(16);
    const shown: ConsentFields = { client_id: client.client_id, redirect_uri: redirect, code_challenge: q["code_challenge"], state: q["state"] ?? "", resource, scope: q["scope"] ?? SCOPE };
    setCookie(c, "wb_consent", `${csrf}.${consentSeal(config.grantKey, csrf, account.account_id, shown)}`, { httpOnly: true, secure, sameSite: "Strict", path: "/oauth/authorize", maxAge: 900 });
    // Browsers apply form-action to the redirect that answers the form too, so the client's own
    // registered callback must be allowed here, or Allow silently goes nowhere.
    authPageHeaders(c, formTarget(redirect));
    return c.html(
      consentPage({
        client: client.client_name,
        redirect,
        account: account.display_name,
        email: account.email,
        reach: await connectorReach(db, account.account_id, resource),
        csrf,
        hidden: shown,
      }),
    );
  });

  app.post("/oauth/authorize", async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>;
    const [csrf = "", seal = ""] = (getCookie(c, "wb_consent") ?? "").split(".");
    if (!csrf || !seal || !same(csrf, f["csrf"] ?? "")) return c.text("This consent form expired. Start the connection again from your MCP client.", 400);
    const client = await loadClient(f["client_id"] ?? "");
    if (!client || !client.redirect_uris.includes(f["redirect_uri"] ?? "")) return c.text("Unknown client or redirect URI.", 400);
    const account = await sessionAccount(c, db, secure);
    if (!account) return c.text("Sign in first.", 401);
    // Allow approves what the page showed, to the person it showed it to, and nothing else.
    const sent = { client_id: client.client_id, redirect_uri: f["redirect_uri"]!, code_challenge: f["code_challenge"] ?? "", state: f["state"] ?? "", resource: f["resource"] ?? "" };
    if (!same(seal, consentSeal(config.grantKey, csrf, account.account_id, sent)))
      return c.text("This consent form doesn’t match the request it was shown for. Start the connection again from your MCP client.", 400);
    const u = new URL(f["redirect_uri"]!);
    if (f["state"]) u.searchParams.set("state", f["state"]);
    u.searchParams.set("iss", base);
    if (f["decision"] !== "allow") {
      u.searchParams.set("error", "access_denied");
      return c.redirect(u.toString());
    }
    // The person's own choice on the page; a form without one gets the default.
    const level = f["level"] === undefined || f["level"] === "" ? DEFAULT_LEVEL : f["level"];
    if (!isLevel(level)) return c.text("Choose what the agent may do: Read only, Edit or Admin.", 400);
    const code = randomToken();
    await db
      .insertInto("oauth_codes")
      .values({
        code_hash: sha256Hex(code), client_id: client.client_id, account_id: account.account_id, redirect_uri: sent.redirect_uri,
        code_challenge: sent.code_challenge, resource: sent.resource, scope: SCOPE, level, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
      .execute();
    u.searchParams.set("code", code);
    return c.redirect(u.toString());
  });

  /** Revoke every token of one connection. */
  const revokeConnection = (family: string) =>
    db.updateTable("oauth_tokens").set({ revoked_at: new Date().toISOString() }).where("family_id", "=", family).where("revoked_at", "is", null).execute();

  const issue = async (into: Db, client_id: string, account_id: string, resource: string, family: string, level: ConnectionLevel, feedback = true) => {
    const access = `${ACCESS_PREFIX}${randomToken(30)}`;
    const refresh = `${REFRESH_PREFIX}${randomToken(30)}`;
    await into
      .insertInto("oauth_tokens")
      .values([
        { token_hash: sha256Hex(access), kind: "access", client_id, account_id, resource, scope: SCOPE, family_id: family, level, feedback, expires_at: new Date(Date.now() + config.accessTokenSeconds * 1000).toISOString() },
        { token_hash: sha256Hex(refresh), kind: "refresh", client_id, account_id, resource, scope: SCOPE, family_id: family, level, feedback, expires_at: new Date(Date.now() + config.refreshTokenDays * 86400_000).toISOString() },
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
      const hash = sha256Hex(f["code"] ?? "");
      const now = new Date().toISOString();
      // Once: of requests that arrive together, only the one that marks the code used goes on. The
      // exchange is one transaction, so a second use waits on the row, then finds it spent after
      // the first use's tokens exist.
      type Exchanged = { tokens: Awaited<ReturnType<typeof issue>> } | { error: string; description: string } | null;
      const exchanged = await db.transaction().execute(async (trx): Promise<Exchanged> => {
        const row = await trx
          .updateTable("oauth_codes")
          .set({ used_at: now, family_id: newId() })
          .where("code_hash", "=", hash)
          .where("client_id", "=", client.client_id)
          .where("used_at", "is", null)
          .where("expires_at", ">", now)
          .returning(["account_id", "redirect_uri", "code_challenge", "resource", "family_id", "level"])
          .executeTakeFirst();
        if (!row) return null;
        if (f["redirect_uri"] !== row.redirect_uri) return { error: "invalid_grant", description: "redirect_uri does not match the authorization request." };
        const challenge = createHash("sha256").update(f["code_verifier"] ?? "").digest("base64url");
        if (challenge !== row.code_challenge) return { error: "invalid_grant", description: "PKCE verification failed." };
        if (f["resource"] && f["resource"] !== row.resource) return { error: "invalid_target", description: "resource does not match the authorization request." };
        return { tokens: await issue(trx, client.client_id, row.account_id, row.resource, row.family_id!, row.level) };
      });
      if (!exchanged) {
        // A code presented again has leaked: the connection it made is revoked (RFC 6749, section 4.1.2).
        const spent = await db.selectFrom("oauth_codes").select("family_id").where("code_hash", "=", hash).where("used_at", "is not", null).executeTakeFirst();
        if (spent?.family_id) await revokeConnection(spent.family_id);
        return oauthError(c, 400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
      }
      if ("error" in exchanged) return oauthError(c, 400, exchanged.error, exchanged.description);
      return c.json(exchanged.tokens);
    }
    if (f["grant_type"] === "refresh_token") {
      const hash = sha256Hex(f["refresh_token"] ?? "");
      const now = new Date().toISOString();
      // Rotation is one transaction: a second use waits on the row, then finds it revoked, and so
      // is taken as reuse after the first use's tokens exist, which the reuse then revokes too.
      const rotated = await db.transaction().execute(async (trx) => {
        const row = await trx
          .updateTable("oauth_tokens")
          .set({ revoked_at: now })
          .where("token_hash", "=", hash)
          .where("kind", "=", "refresh")
          .where("client_id", "=", client.client_id)
          .where("revoked_at", "is", null)
          .where("expires_at", ">", now)
          .returning(["account_id", "resource", "family_id", "level", "feedback"])
          .executeTakeFirst();
        // A refreshed connection keeps its level and its feedback switch, including ones the person changed since.
        return row ? issue(trx, client.client_id, row.account_id, row.resource, row.family_id, row.level, row.feedback) : null;
      });
      if (rotated) return c.json(rotated);
      const row = await db.selectFrom("oauth_tokens").select(["client_id", "family_id", "expires_at", "revoked_at"]).where("token_hash", "=", hash).where("kind", "=", "refresh").executeTakeFirst();
      if (!row || !row.revoked_at || row.client_id !== client.client_id || Date.parse(row.expires_at) < Date.now()) return oauthError(c, 400, "invalid_grant", "The refresh token is invalid or expired.");
      // A reused refresh token means it leaked: revoke the whole family.
      await revokeConnection(row.family_id);
      return oauthError(c, 400, "invalid_grant", "This refresh token was already used; the connection has been revoked. Sign in again.");
    }
    return oauthError(c, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  });

  app.post("/oauth/revoke", async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>;
    const row = await db.selectFrom("oauth_tokens").select(["family_id"]).where("token_hash", "=", sha256Hex(f["token"] ?? "")).executeTakeFirst();
    if (row) await revokeConnection(row.family_id);
    return c.body(null, 200);
  });

  return app;
}
