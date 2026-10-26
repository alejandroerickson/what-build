import { createHash, randomBytes } from "node:crypto";
import { AppError, escapeHtml, gone, invalid, isInstanceOwner, tenantAllowanceOf, newId, notFound, randomToken, safeNext, sha256Hex, SIGN_IN_LINKS_PER_HOUR, unauthenticated, type Db, type Mailer } from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sql } from "kysely";
import { z } from "zod";
import { microsoftSignIn, type ServerConfig } from "../config.ts";
import { connectorReach } from "./connector-reach.ts";
import { acceptInvitation, acceptInvitationsForEmail, clearSessionCookies, createSession, endEverything, findOrCreateAccount, isOwnOrigin, restPrincipal, sessionTokens, setSessionCookie } from "./identity.ts";
import { returnsTo } from "./oauth.ts";
import { authPage, authPageHeaders } from "./page.ts";

/**
 * What opening a sign-in link shows: who it signs in, and one button. Mail scanners fetch every
 * link in a message, so opening it changes nothing; the button's POST is what signs in.
 */
function signInLinkPage(email: string, token: string): string {
  return authPage(
    "Sign in",
    `<h1>Sign in to WhatBuild</h1>
<p>You’re signing in as <strong>${escapeHtml(email)}</strong>.</p>
<p class="muted">If you didn’t ask for this link, close this page.</p>
<form method="post" action="/auth/verify"><input type="hidden" name="token" value="${escapeHtml(token)}">
<div class="row"><button type="submit" class="primary">Sign in</button></div>
</form>`,
  );
}

/** The domain of an address, lower case. */
const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/** Enough of an address for its owner to recognize it, not enough to harvest it from a forwarded link: "l••••@example.com". */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}••••@${domain}`;
}

/** The payload of an ID token received straight from a token endpoint over TLS; {} when it cannot be read. */
function idTokenClaims<T>(idToken: string | undefined): Partial<T> {
  try {
    return JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as Partial<T>;
  } catch {
    return {};
  }
}

/** Where whoever runs a deployment reads how to fix a refused Microsoft sign-in. */
export const MICROSOFT_REFUSAL_GUIDE = "okf/operations/azure.md#when-microsoft-sign-in-is-refused";

const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A short reference for one refused sign-in, which the sign-in page shows and the server's log
 * line carries, so whoever runs the deployment finds the line someone reads out: "K7Q2-M9XD".
 */
export function signInReference(): string {
  const chars = [...randomBytes(8)].map((b) => REFERENCE_ALPHABET[b & 31]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function errorJson(c: Context, e: AppError) {
  return c.json({ error: e.toJSON() }, e.status as 400);
}

export function authRoutes(deps: { db: Db; config: ServerConfig; mailer: Mailer }) {
  const { db, config, mailer } = deps;
  const app = new Hono();
  const secure = config.publicBaseUrl.startsWith("https://");

  /**
   * Invite-only mode: new accounts only for listed emails or domains, the instance's owners,
   * someone with an invitation, or an address an instance owner has let create an organization.
   */
  const mayJoin = async (email: string) => {
    if (!config.signupAllowlist) return true;
    const e = email.toLowerCase();
    if (config.signupAllowlist.some((a) => (a.startsWith("@") ? e.endsWith(a) : e === a))) return true;
    if (config.instanceOwners.includes(e)) return true;
    const allowance = await db.selectFrom("tenant_allowances").select("allowed").where("email", "=", e).where("allowed", ">", 0).executeTakeFirst();
    if (allowance) return true;
    const existing = await db.selectFrom("accounts").select("account_id").where(sql<boolean>`lower(email) = ${e}`).where("deleted_at", "is", null).executeTakeFirst();
    if (existing) return true;
    const invited = await db.selectFrom("invitations").select("invitation_id").where(sql<boolean>`lower(email) = ${e}`).where("accepted_at", "is", null).where("expires_at", ">", new Date().toISOString()).executeTakeFirst();
    return Boolean(invited);
  };

  const startSession = async (c: Context, accountId: string) => {
    const token = await createSession(db, accountId, config.sessionDays, c.req.header("user-agent"));
    setSessionCookie(c, token, secure, config.sessionDays * 86400);
  };

  app.onError((err, c) => {
    if (err instanceof AppError) return errorJson(c, err);
    console.error(err);
    return c.json({ error: { code: "internal", status: 500, message: "WhatBuild hit an unexpected error. Try again." } }, 500);
  });

  /** Email a single-use sign-in link. The same response whether or not an account exists. */
  app.post("/auth/email", async (c) => {
    if (config.mailer === "none") throw notFound("Sign-in links by email aren’t set up on this server. Sign in another way.");
    const body = z.strictObject({ email: z.string().trim().email().max(320), next: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter a valid email.");
    const email = body.data.email;
    if (!(await mayJoin(email))) throw new AppError(403, "invite_only", "WhatBuild is invite-only for now. Ask someone who uses it to invite this email.");
    const recent = await db
      .selectFrom("email_tokens")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .where("created_at", ">", new Date(Date.now() - 3600_000).toISOString())
      .executeTakeFirst();
    if (Number(recent?.n ?? 0) >= SIGN_IN_LINKS_PER_HOUR) throw new AppError(429, "rate_limited", "Too many sign-in links for this email in the last hour. Use the latest one, or try again later.");
    const token = randomToken();
    await db
      .insertInto("email_tokens")
      .values({ token_hash: sha256Hex(token), email, purpose: "sign_in", redirect: safeNext(body.data.next), expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
      .execute();
    const link = `${config.publicBaseUrl}/auth/verify?token=${token}`;
    await mailer.send({ to: email, subject: "Your WhatBuild sign-in link", text: `Sign in to WhatBuild:\n\n${link}\n\nThe link works once, for 15 minutes. If you didn’t ask for it, ignore this email.\n` });
    return c.json({ sent: true, ...(config.env !== "production" && config.mailer === "console" ? { dev_note: "In development, the link is printed in the server’s terminal." } : {}) });
  });

  /** Opening the link: a page with one button, which posts it back. Nothing is read but the link's own row. */
  app.get("/auth/verify", async (c) => {
    const token = c.req.query("token") ?? "";
    const row = await db
      .selectFrom("email_tokens")
      .select("email")
      .where("token_hash", "=", sha256Hex(token))
      .where("used_at", "is", null)
      .where("expires_at", ">", new Date().toISOString())
      .executeTakeFirst();
    if (!row) return c.redirect("/signin?error=link_expired");
    authPageHeaders(c);
    return c.html(signInLinkPage(row.email, token));
  });

  /** Pressing Sign in on the link's page: from this origin only, so no other site can sign someone in to an account of its choosing. */
  app.post("/auth/verify", async (c) => {
    if (!isOwnOrigin(config, c.req.header("origin"))) throw new AppError(403, "forbidden_origin", "Cross-origin writes are refused.");
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    const token = typeof form["token"] === "string" ? form["token"] : "";
    const now = new Date().toISOString();
    // Once: of requests that arrive together, only the one that marks the link used signs in.
    const row = await db
      .updateTable("email_tokens")
      .set({ used_at: now })
      .where("token_hash", "=", sha256Hex(token))
      .where("used_at", "is", null)
      .where("expires_at", ">", now)
      .returning(["email", "redirect"])
      .executeTakeFirst();
    if (!row) return c.redirect("/signin?error=link_expired", 303);
    // What let the address in may have gone since: an invitation can be cancelled while the email is in transit.
    if (!(await mayJoin(row.email))) return c.redirect("/signin?error=invite_only", 303);
    const { account } = await findOrCreateAccount(db, row.email);
    await acceptInvitationsForEmail(db, account);
    await startSession(c, account.account_id);
    return c.redirect(safeNext(row.redirect), 303);
  });

  /** Development only: sign in as any email without a link. Compiled into the server, refused unless enabled. */
  app.post("/auth/dev-sign-in", async (c) => {
    if (!config.devAuth) throw notFound("Not available.");
    const body = z.strictObject({ email: z.string().trim().email(), display_name: z.string().max(100).optional(), next: z.string().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter a valid email.");
    // Development lets any address in.
    const { account } = await findOrCreateAccount(db, body.data.email, body.data.display_name);
    await acceptInvitationsForEmail(db, account);
    await startSession(c, account.account_id);
    return c.json({ signed_in: true, account, next: safeNext(body.data.next) });
  });

  app.get("/auth/methods", async (c) =>
    c.json({ email_link: config.mailer !== "none", google: Boolean(config.googleClientId && config.googleClientSecret), microsoft: microsoftSignIn(config), dev: config.devAuth, session_days: config.sessionDays, analytics_id: await analyticsFor(c) }),
  );

  /**
   * The measurement ID, where the app should measure: on the deployment's own address, not another
   * name for the service (Cloud Run's run.app address), and not for the instance's owners, whose
   * own use would drown everyone else's.
   */
  const analyticsFor = async (c: Context): Promise<string | null> => {
    if (!config.analyticsId) return null;
    // A proxy may name several hosts; the first is the one the browser asked for.
    const host = (c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "").split(",")[0]!.trim().toLowerCase();
    if (host !== new URL(config.publicBaseUrl).host) return null;
    const me = await restPrincipal(c, db, config).catch(() => null);
    return me && isInstanceOwner(config, me.email) ? null : config.analyticsId;
  };

  // ---- OpenID Connect sign-in: the code flow with PKCE, its state kept in a short-lived cookie --

  type OidcState = { state: string; verifier: string; next: string };

  /** Redirect to a provider's authorization endpoint, keeping state, verifier and the safe `next` in `wb_oidc` for ten minutes. */
  const beginOidc = (c: Context, path: string, authorize: string, params: Record<string, string>) => {
    const state = randomToken(16);
    const verifier = randomToken(32);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    setCookie(c, "wb_oidc", JSON.stringify({ state, verifier, next: safeNext(c.req.query("next")) } satisfies OidcState), { httpOnly: true, secure, sameSite: "Lax", path, maxAge: 600 });
    const u = new URL(authorize);
    u.search = new URLSearchParams({
      ...params, response_type: "code", scope: "openid email profile", redirect_uri: `${config.publicBaseUrl}${path}/callback`,
      state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
    }).toString();
    return c.redirect(u.toString());
  };

  /** On the callback: the saved state, once, and the ID token from the token endpoint; null when any of it is missing or wrong. */
  const finishOidc = async (c: Context, path: string, tokenUrl: string, client: Record<string, string>): Promise<{ saved: OidcState; idToken: string | undefined } | null> => {
    const saved = (() => {
      try {
        return JSON.parse(getCookie(c, "wb_oidc") ?? "") as OidcState;
      } catch {
        return null;
      }
    })();
    deleteCookie(c, "wb_oidc", { path });
    if (!saved || c.req.query("state") !== saved.state || !c.req.query("code")) return null;
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...client, code: c.req.query("code")!, redirect_uri: `${config.publicBaseUrl}${path}/callback`, grant_type: "authorization_code", code_verifier: saved.verifier }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string };
    return { saved, idToken: tokens.id_token };
  };

  /** What every method does once it has an address it trusts: admission, the account, its invitations, a session. */
  const completeSignIn = async (c: Context, email: string, name: string | undefined, next: string) => {
    if (!(await mayJoin(email))) return c.redirect("/signin?error=invite_only");
    const { account } = await findOrCreateAccount(db, email, name);
    await acceptInvitationsForEmail(db, account);
    await startSession(c, account.account_id);
    return c.redirect(next);
  };

  // ---- Google sign-in (optional; on when a client id and secret are configured) ---------------

  app.get("/auth/google", async (c) => {
    if (!config.googleClientId) throw notFound("Google sign-in isn’t set up on this server.");
    return beginOidc(c, "/auth/google", "https://accounts.google.com/o/oauth2/v2/auth", { client_id: config.googleClientId });
  });

  app.get("/auth/google/callback", async (c) => {
    const done = await finishOidc(c, "/auth/google", "https://oauth2.googleapis.com/token", { client_id: config.googleClientId!, client_secret: config.googleClientSecret! });
    if (!done) return c.redirect("/signin?error=google_failed");
    // Received directly from Google's token endpoint over TLS, so its claims can be read as issued.
    const claims = idTokenClaims<{ email: string; email_verified: boolean; name: string; aud: string }>(done.idToken);
    if (!claims.email || !claims.email_verified || claims.aud !== config.googleClientId) return c.redirect("/signin?error=google_unverified");
    return completeSignIn(c, claims.email, claims.name, done.saved.next);
  });

  // ---- Microsoft sign-in (optional; one Entra directory, on when it, a client id and a secret are configured)

  const MICROSOFT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /**
   * A Microsoft sign-in the checks refused: one log line for whoever runs the deployment, saying
   * which check failed and how to fix it, and the sign-in page with a reference to that line. The
   * line holds claim names and booleans only, never a token, an address, a name or a claim's value.
   */
  const refuseMicrosoft = (c: Context, error: "microsoft_wrong_directory" | "microsoft_no_verified_email", detail: { check: "directory" | "email"; fix: string } & Record<string, unknown>) => {
    const reference = signInReference();
    const { check, fix, ...found } = detail;
    console.warn(JSON.stringify({ at: new Date().toISOString(), severity: "WARNING", event: "microsoft_sign_in_refused", reference, check, ...found, fix, guide: MICROSOFT_REFUSAL_GUIDE }));
    return c.redirect(`/signin?error=${error}&ref=${reference}`);
  };

  app.get("/auth/microsoft", async (c) => {
    if (!microsoftSignIn(config)) throw notFound("Microsoft sign-in isn’t set up on this server.");
    return beginOidc(c, "/auth/microsoft", `https://login.microsoftonline.com/${config.microsoftTenant}/oauth2/v2.0/authorize`, { client_id: config.microsoftClientId! });
  });

  app.get("/auth/microsoft/callback", async (c) => {
    if (!microsoftSignIn(config)) throw notFound("Microsoft sign-in isn’t set up on this server.");
    const tenant = config.microsoftTenant!;
    const done = await finishOidc(c, "/auth/microsoft", `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { client_id: config.microsoftClientId!, client_secret: config.microsoftClientSecret! });
    if (!done) return c.redirect("/signin?error=microsoft_failed");
    // Received directly from the directory's token endpoint over TLS, so its claims can be read as issued.
    const claims = idTokenClaims<{ aud: string; iss: string; tid: string; email: string; xms_edov: unknown; preferred_username: string; name: string }>(done.idToken);
    const fromDirectory = claims.aud === config.microsoftClientId && claims.tid?.toLowerCase() === tenant && claims.iss?.toLowerCase() === `https://login.microsoftonline.com/${tenant}/v2.0`;
    // A directory's administrators can give its people any email attribute, someone else's address
    // included. An address is taken only when Entra says the directory verified its domain
    // (xms_edov), or when its domain is one this deployment trusts the directory for; a user
    // principal name only in such a domain.
    const listed = (address: unknown): address is string => typeof address === "string" && MICROSOFT_EMAIL.test(address) && config.microsoftDomains.includes(domainOf(address));
    const verified = typeof claims.email === "string" && MICROSOFT_EMAIL.test(claims.email) && [true, "true", 1, "1"].includes(claims.xms_edov as never);
    const email = verified || listed(claims.email) ? claims.email : listed(claims.preferred_username) ? claims.preferred_username : undefined;
    if (!fromDirectory) {
      const mismatched = [
        claims.aud === config.microsoftClientId ? null : "aud",
        claims.tid?.toLowerCase() === tenant ? null : "tid",
        claims.iss?.toLowerCase() === `https://login.microsoftonline.com/${tenant}/v2.0` ? null : "iss",
      ].filter((k) => k !== null);
      return refuseMicrosoft(c, "microsoft_wrong_directory", {
        check: "directory",
        mismatched,
        fix:
          `The ID token was not issued to this deployment's app registration in its directory (${mismatched.join(", ")} did not match). ` +
          "Check that WHATBUILD_MICROSOFT_TENANT is the directory (tenant) ID and WHATBUILD_MICROSOFT_CLIENT_ID the app registration's application (client) ID.",
      });
    }
    if (!email) {
      // Which evidence the token carried, as booleans: never an address, a name or a claim's value.
      const evidence = {
        email_claim: typeof claims.email === "string" && MICROSOFT_EMAIL.test(claims.email),
        xms_edov_claim: claims.xms_edov !== undefined && claims.xms_edov !== null,
        xms_edov_true: [true, "true", 1, "1"].includes(claims.xms_edov as never),
        email_domain_listed: listed(claims.email),
        upn_claim: typeof claims.preferred_username === "string" && MICROSOFT_EMAIL.test(claims.preferred_username),
        upn_domain_listed: listed(claims.preferred_username),
        domains_listed: config.microsoftDomains.length,
      };
      const fix = !evidence.email_claim
        ? "The ID token carries no email address. Add the optional ID-token claims email and xms_edov to the app registration; for people with no email attribute, list the directory's own verified domain of their user principal names in WHATBUILD_MICROSOFT_DOMAINS."
        : !evidence.xms_edov_claim
          ? "The ID token has no xms_edov claim, so nothing says the address's domain is verified. Add the optional ID-token claim xms_edov to the app registration (az ad app update --optional-claims), or list a domain the directory has verified in WHATBUILD_MICROSOFT_DOMAINS."
          : "Entra says the address's domain is not verified by its owner, and WHATBUILD_MICROSOFT_DOMAINS does not list it. The refusal is right unless the directory is the authority for that domain: then verify the domain in the directory, or list it in WHATBUILD_MICROSOFT_DOMAINS.";
      return refuseMicrosoft(c, "microsoft_no_verified_email", { check: "email", ...evidence, fix });
    }
    return completeSignIn(c, email, claims.name, done.saved.next);
  });

  app.post("/auth/sign-out", async (c) => {
    const tokens = sessionTokens(c, secure);
    if (tokens.length) await db.deleteFrom("sessions").where("session_hash", "in", tokens.map(sha256Hex)).execute();
    clearSessionCookies(c, secure);
    return c.json({ signed_out: true });
  });

  // ---- Account ------------------------------------------------------------------------------

  const requirePrincipal = async (c: Context) => {
    const p = await restPrincipal(c, db, config);
    if (!p) throw unauthenticated();
    return p;
  };

  const meOf = async (p: NonNullable<Awaited<ReturnType<typeof restPrincipal>>>) => {
    const tenant_allowance = await tenantAllowanceOf(db, config, p);
    const prefs = await db.selectFrom("accounts").select("hide_example").where("account_id", "=", p.account_id).executeTakeFirst();
    return {
      account_id: p.account_id, email: p.email, display_name: p.display_name, auth_kind: p.auth_kind, tenant_allowance,
      new_organization_plan: tenant_allowance.instance_owner ? "unlimited" : config.newOrganizationPlan,
      hide_example: Boolean(prefs?.hide_example),
    };
  };

  app.get("/api/v1/me", async (c) => c.json(await meOf(await requirePrincipal(c))));

  /**
   * Who is signed in, for the web app's own check. Being signed out is an answer here, not an
   * error, so a visitor's browser logs nothing; every other endpoint still refuses without a session.
   */
  app.get("/auth/session", async (c) => {
    const p = await restPrincipal(c, db, config);
    return c.json(p ? { signed_in: true, ...(await meOf(p)) } : { signed_in: false });
  });

  app.patch("/api/v1/me", async (c) => {
    const p = await requirePrincipal(c);
    const body = z
      .strictObject({ display_name: z.string().trim().min(1).max(100).optional(), hide_example: z.boolean().optional() })
      .refine((b) => b.display_name !== undefined || b.hide_example !== undefined)
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Send display_name (1 to 100 characters), hide_example (true or false), or both.");
    await db
      .updateTable("accounts")
      .set({ ...(body.data.display_name !== undefined ? { display_name: body.data.display_name } : {}), ...(body.data.hide_example !== undefined ? { hide_example: body.data.hide_example } : {}) })
      .where("account_id", "=", p.account_id)
      .execute();
    return c.json(await meOf({ ...p, display_name: body.data.display_name ?? p.display_name }));
  });

  /** The agents signed in as this person over OAuth: one entry per connection. */
  app.get("/api/v1/me/agents", async (c) => {
    const p = await requirePrincipal(c);
    const agents = await db
      .selectFrom("oauth_tokens as t")
      .innerJoin("oauth_clients as c", "c.client_id", "t.client_id")
      .select(["c.client_name", "c.redirect_uris", "t.family_id", "t.resource", "t.level", "t.feedback", (eb) => eb.fn.max("t.last_used_at").as("last_used_at"), (eb) => eb.fn.min("t.created_at").as("created_at")])
      .where("t.account_id", "=", p.account_id)
      .where("t.revoked_at", "is", null)
      .where("t.expires_at", ">", new Date().toISOString())
      .groupBy(["c.client_id", "c.client_name", "c.redirect_uris", "t.family_id", "t.resource", "t.level", "t.feedback"])
      .execute();
    // A connection keeps the resource it was approved for, so each one reaches one scope; and its
    // client was given its tokens at a registered redirect URI, so that is where the connection is held.
    const items = await Promise.all(
      agents.map(async ({ resource, redirect_uris, ...a }) => ({ ...a, reach: await connectorReach(db, p.account_id, resource), returns_to: returnsTo(redirect_uris) })),
    );
    return c.json({ items });
  });

  /**
   * Change what one connection may do: its level, and whether it may send feedback. Only a person
   * signed in to the web app can: an agent has no session, and no operation an agent can call
   * reaches this, so no agent raises its own level or turns feedback back on.
   */
  app.patch("/api/v1/me/agents/:family", async (c) => {
    const p = await requirePrincipal(c);
    const body = z
      .strictObject({ level: z.enum(["viewer", "editor", "admin"]).optional(), feedback: z.boolean().optional() })
      .refine((b) => b.level !== undefined || b.feedback !== undefined)
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Send level, viewer (Read only), editor (Edit) or admin (Admin), or feedback, true or false.");
    const changed = await db
      .updateTable("oauth_tokens")
      .set(body.data)
      .where("family_id", "=", c.req.param("family"))
      .where("account_id", "=", p.account_id)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    if (!Number(changed.numUpdatedRows)) throw notFound("No such connection. It may have been disconnected.");
    return c.json({ family_id: c.req.param("family"), ...body.data });
  });

  app.delete("/api/v1/me/agents/:family", async (c) => {
    const p = await requirePrincipal(c);
    await db.updateTable("oauth_tokens").set({ revoked_at: new Date().toISOString() }).where("family_id", "=", c.req.param("family")).where("account_id", "=", p.account_id).execute();
    return c.json({ revoked: true });
  });

  /**
   * Sign out everywhere: end every browser session, this one too unless kept, and disconnect every
   * agent. Only a person in the web app can: REST takes no bearer token and no operation reaches
   * this, so an agent cannot lock its person out of their own work.
   */
  app.post("/api/v1/me/sign-out-everywhere", async (c) => {
    const p = await requirePrincipal(c);
    const body = z.strictObject({ keep_this_session: z.boolean().default(false) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Send keep_this_session, true or false, or nothing to end this session too.");
    const keep = body.data.keep_this_session;
    const ended = await endEverything(db, p.account_id, keep ? sessionTokens(c, secure).map(sha256Hex) : []);
    if (!keep) clearSessionCookies(c, secure);
    return c.json({ ...ended, kept_this_session: keep });
  });

  app.post("/api/v1/invitations/accept", async (c) => {
    const p = await requirePrincipal(c);
    const body = z.strictObject({ token: z.string().min(10) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Missing invitation token.");
    const inv = await db.selectFrom("invitations").selectAll().where("token_hash", "=", sha256Hex(body.data.token)).executeTakeFirst();
    if (!inv) throw notFound("This invitation link isn’t valid. Check that the whole link was copied, or ask for a new one.");
    const tenant = await db.selectFrom("tenants").select(["slug", "name"]).where("tenant_id", "=", inv.tenant_id).executeTakeFirst();
    const scope =
      inv.scope_type === "team"
        ? await db.selectFrom("teams").select("name").where("team_id", "=", inv.scope_id).executeTakeFirst()
        : inv.scope_type === "product"
          ? await db.selectFrom("products").select("name").where("product_id", "=", inv.scope_id).executeTakeFirst()
          : tenant;
    const accepted = { tenant, scope_type: inv.scope_type, scope: scope?.name ?? null, role: inv.role };
    if (inv.accepted_at) {
      // Signing in accepts every invitation to that address, so the link often arrives already used by this same person.
      if (inv.accepted_by !== p.account_id) throw gone("invitation_used", "This invitation was accepted by another account. Ask whoever invited you for a new link.");
      const held = await db.selectFrom("memberships").select("membership_id").where("scope_type", "=", inv.scope_type).where("scope_id", "=", inv.scope_id).where("account_id", "=", p.account_id).executeTakeFirst();
      if (!held) throw gone("invitation_used", `You accepted this invitation earlier, and that access was removed. Ask an admin of ${tenant?.name ?? "the organization"} to give it back.`);
      return c.json({ accepted: true, already: true, ...accepted });
    }
    if (Date.parse(inv.expires_at) < Date.now()) throw gone("invitation_expired", "This invitation expired or was cancelled. Ask whoever invited you for a new link.");
    // An invitation belongs to the address it was sent to: the link is a pointer, not a bearer credential.
    if (inv.email.toLowerCase() !== p.email.toLowerCase())
      throw new AppError(403, "invitation_wrong_address", `This invitation was sent to ${maskEmail(inv.email)}, and you’re signed in as ${p.email}. Sign in with that email to join.`, {
        invited: maskEmail(inv.email),
      });
    await acceptInvitation(db, inv.invitation_id, { account_id: p.account_id, email: p.email, display_name: p.display_name });
    return c.json({ accepted: true, already: false, ...accepted });
  });

  return app;
}
