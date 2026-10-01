import { createHash } from "node:crypto";
import { AppError, gone, invalid, tenantAllowanceOf, newId, notFound, randomToken, sha256Hex, SIGN_IN_LINKS_PER_HOUR, unauthenticated, type Db, type Mailer } from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sql } from "kysely";
import { z } from "zod";
import type { ServerConfig } from "../config.ts";
import { inviteCodeIn, inviteInfo } from "../public-sandbox.ts";
import { acceptInvitation, acceptInvitationsForEmail, createSession, findOrCreateAccount, restPrincipal, SESSION_COOKIE } from "./identity.ts";

function safeNext(next: string | undefined | null): string {
  // Only same-origin paths: never an open redirect.
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

/** Enough of an address for its owner to recognize it, not enough to harvest it from a forwarded link: "l••••@example.com". */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}••••@${domain}`;
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

  /**
   * How an address may come to have an account: "open" where sign-up allows it, or "sandbox" when
   * all that lets it in is an invitation to the public sandbox that still has a place, which is
   * where the sign-in is returning to.
   */
  const admission = async (email: string, next: string | null | undefined): Promise<"open" | "sandbox" | null> => {
    if (await mayJoin(email)) return "open";
    const code = inviteCodeIn(next);
    const invite = code ? await inviteInfo(db, code) : null;
    return invite?.status === "open" ? "sandbox" : null;
  };

  const startSession = async (c: Context, accountId: string) => {
    const token = await createSession(db, accountId, config.sessionDays, c.req.header("user-agent"));
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: config.sessionDays * 86400 });
  };

  app.onError((err, c) => {
    if (err instanceof AppError) return errorJson(c, err);
    console.error(err);
    return c.json({ error: { code: "internal", status: 500, message: "Unexpected error." } }, 500);
  });

  /** Email a single-use sign-in link. The same response whether or not an account exists. */
  app.post("/auth/email", async (c) => {
    if (config.mailer === "none") throw notFound("Email sign-in links are not configured on this server. Use another sign-in method.");
    const body = z.strictObject({ email: z.string().trim().email().max(320), next: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter an email address.");
    const email = body.data.email;
    if (!(await admission(email, body.data.next))) throw new AppError(403, "invite_only", "WhatBuild is invite-only for now. Ask someone who uses it to invite this address.");
    const recent = await db
      .selectFrom("email_tokens")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .where("created_at", ">", new Date(Date.now() - 3600_000).toISOString())
      .executeTakeFirst();
    if (Number(recent?.n ?? 0) >= SIGN_IN_LINKS_PER_HOUR) throw new AppError(429, "rate_limited", "Too many sign-in links for this address in the last hour. Use the latest one, or try again later.");
    const token = randomToken();
    await db
      .insertInto("email_tokens")
      .values({ token_hash: sha256Hex(token), email, purpose: "sign_in", redirect: safeNext(body.data.next), expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
      .execute();
    const link = `${config.publicBaseUrl}/auth/verify?token=${token}`;
    await mailer.send({ to: email, subject: "Your WhatBuild sign-in link", text: `Sign in to WhatBuild:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this message.\n` });
    return c.json({ sent: true, ...(config.env !== "production" && config.mailer === "console" ? { dev_note: "In development the link is printed in the server's terminal." } : {}) });
  });

  app.get("/auth/verify", async (c) => {
    const token = c.req.query("token") ?? "";
    const row = await db.selectFrom("email_tokens").selectAll().where("token_hash", "=", sha256Hex(token)).executeTakeFirst();
    if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) return c.redirect("/signin?error=link_expired");
    await db.updateTable("email_tokens").set({ used_at: new Date().toISOString() }).where("token_hash", "=", row.token_hash).execute();
    // The place the link was sent for may have gone since: an invitation can fill while the email is in transit.
    const how = await admission(row.email, row.redirect);
    if (!how) return c.redirect("/signin?error=invite_only");
    const { account } = await findOrCreateAccount(db, row.email, undefined, how === "sandbox");
    await acceptInvitationsForEmail(db, account);
    await startSession(c, account.account_id);
    return c.redirect(safeNext(row.redirect));
  });

  /** Development only: sign in as any email without a link. Compiled into the server, refused unless enabled. */
  app.post("/auth/dev-sign-in", async (c) => {
    if (!config.devAuth) throw notFound("Not available.");
    const body = z.strictObject({ email: z.string().trim().email(), display_name: z.string().max(100).optional(), next: z.string().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter an email address.");
    // Development lets any address in; it still marks the account a sandbox invitation alone would have admitted.
    const how = await admission(body.data.email, body.data.next);
    const { account } = await findOrCreateAccount(db, body.data.email, body.data.display_name, how === "sandbox");
    await acceptInvitationsForEmail(db, account);
    await startSession(c, account.account_id);
    return c.json({ signed_in: true, account, next: safeNext(body.data.next) });
  });

  app.get("/auth/methods", (c) =>
    c.json({ email_link: config.mailer !== "none", google: Boolean(config.googleClientId && config.googleClientSecret), dev: config.devAuth, session_days: config.sessionDays, analytics_id: config.analyticsId }),
  );

  // ---- Google sign-in (optional; on when a client id and secret are configured) ---------------

  app.get("/auth/google", async (c) => {
    if (!config.googleClientId) throw notFound("Google sign-in is not configured.");
    const state = randomToken(16);
    const verifier = randomToken(32);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    setCookie(c, "wb_oidc", JSON.stringify({ state, verifier, next: safeNext(c.req.query("next")) }), { httpOnly: true, secure, sameSite: "Lax", path: "/auth/google", maxAge: 600 });
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: config.googleClientId, response_type: "code", scope: "openid email profile", redirect_uri: `${config.publicBaseUrl}/auth/google/callback`,
      state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
    }).toString();
    return c.redirect(u.toString());
  });

  app.get("/auth/google/callback", async (c) => {
    const saved = (() => {
      try {
        return JSON.parse(getCookie(c, "wb_oidc") ?? "") as { state: string; verifier: string; next: string };
      } catch {
        return null;
      }
    })();
    deleteCookie(c, "wb_oidc", { path: "/auth/google" });
    if (!saved || c.req.query("state") !== saved.state || !c.req.query("code")) return c.redirect("/signin?error=google_failed");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: c.req.query("code")!, client_id: config.googleClientId!, client_secret: config.googleClientSecret!,
        redirect_uri: `${config.publicBaseUrl}/auth/google/callback`, grant_type: "authorization_code", code_verifier: saved.verifier,
      }),
    });
    if (!res.ok) return c.redirect("/signin?error=google_failed");
    const tokens = (await res.json()) as { id_token?: string };
    // Received directly from Google's token endpoint over TLS, so its claims can be read as issued.
    const claims = JSON.parse(Buffer.from((tokens.id_token ?? "..").split(".")[1] ?? "", "base64url").toString("utf8") || "{}") as { email?: string; email_verified?: boolean; name?: string; aud?: string };
    if (!claims.email || !claims.email_verified || claims.aud !== config.googleClientId) return c.redirect("/signin?error=google_unverified");
    const how = await admission(claims.email, saved.next);
    if (!how) return c.redirect("/signin?error=invite_only");
    const { account } = await findOrCreateAccount(db, claims.email, claims.name, how === "sandbox");
    await acceptInvitationsForEmail(db, account);
    await startSession(c, account.account_id);
    return c.redirect(saved.next);
  });

  app.post("/auth/sign-out", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await db.deleteFrom("sessions").where("session_hash", "=", sha256Hex(token)).execute();
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ signed_out: true });
  });

  // ---- Account ------------------------------------------------------------------------------

  const requirePrincipal = async (c: Context) => {
    const p = await restPrincipal(c, db);
    if (!p) throw unauthenticated();
    return p;
  };

  app.get("/api/v1/me", async (c) => {
    const p = await requirePrincipal(c);
    const tenant_allowance = await tenantAllowanceOf(db, config, p);
    return c.json({ account_id: p.account_id, email: p.email, display_name: p.display_name, auth_kind: p.auth_kind, ...(p.sandbox_only ? { sandbox_only: true } : {}), tenant_allowance });
  });

  app.patch("/api/v1/me", async (c) => {
    const p = await requirePrincipal(c);
    const body = z.strictObject({ display_name: z.string().trim().min(1).max(100) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "A display name is 1 to 100 characters.");
    await db.updateTable("accounts").set({ display_name: body.data.display_name }).where("account_id", "=", p.account_id).execute();
    return c.json({ account_id: p.account_id, email: p.email, display_name: body.data.display_name });
  });

  /** The agents signed in as this person over OAuth: one entry per connection. */
  app.get("/api/v1/me/agents", async (c) => {
    const p = await requirePrincipal(c);
    const agents = await db
      .selectFrom("oauth_tokens as t")
      .innerJoin("oauth_clients as c", "c.client_id", "t.client_id")
      .select(["c.client_name", "t.family_id", (eb) => eb.fn.max("t.last_used_at").as("last_used_at"), (eb) => eb.fn.min("t.created_at").as("created_at")])
      .where("t.account_id", "=", p.account_id)
      .where("t.revoked_at", "is", null)
      .where("t.expires_at", ">", new Date().toISOString())
      .groupBy(["c.client_name", "t.family_id"])
      .execute();
    return c.json({ items: agents });
  });

  app.delete("/api/v1/me/agents/:family", async (c) => {
    const p = await requirePrincipal(c);
    await db.updateTable("oauth_tokens").set({ revoked_at: new Date().toISOString() }).where("family_id", "=", c.req.param("family")).where("account_id", "=", p.account_id).execute();
    return c.json({ revoked: true });
  });

  app.post("/api/v1/invitations/accept", async (c) => {
    const p = await requirePrincipal(c);
    const body = z.strictObject({ token: z.string().min(10) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Missing invitation token.");
    const inv = await db.selectFrom("invitations").selectAll().where("token_hash", "=", sha256Hex(body.data.token)).executeTakeFirst();
    if (!inv) throw notFound("This invitation link is not valid. Check that the whole link was copied, or ask for a new one.");
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
      if (inv.accepted_by !== p.account_id) throw gone("invitation_used", "This invitation was already accepted by a different account. Ask whoever invited you for a new link.");
      const held = await db.selectFrom("memberships").select("membership_id").where("scope_type", "=", inv.scope_type).where("scope_id", "=", inv.scope_id).where("account_id", "=", p.account_id).executeTakeFirst();
      if (!held) throw gone("invitation_used", `You accepted this invitation earlier, and that access has since been removed. Ask an admin of ${tenant?.name ?? "the organization"} to give it back.`);
      return c.json({ accepted: true, already: true, ...accepted });
    }
    if (Date.parse(inv.expires_at) < Date.now()) throw gone("invitation_expired", "This invitation expired or was cancelled. Ask whoever invited you for a new link.");
    // An invitation belongs to the address it was sent to: the link is a pointer, not a bearer credential.
    if (inv.email.toLowerCase() !== p.email.toLowerCase())
      throw new AppError(403, "invitation_wrong_address", `This invitation was sent to ${maskEmail(inv.email)}, and you are signed in as ${p.email}. Sign in with the address it was sent to; that accepts it.`, {
        invited: maskEmail(inv.email),
      });
    await acceptInvitation(db, inv.invitation_id, { account_id: p.account_id, email: p.email, display_name: p.display_name });
    return c.json({ accepted: true, already: false, ...accepted });
  });

  return app;
}
