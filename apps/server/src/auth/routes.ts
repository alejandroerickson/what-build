import { createHash, randomBytes } from "node:crypto";
import { AppError, enterAsGuest, planName, escapeHtml, gone, invalid, isGuestAccount, isInstanceOwner, readGuests, tenantAllowanceOf, newId, notFound, oneLine, quotedName, randomToken, safeNext, sha256Hex, SIGN_IN_LINKS_PER_HOUR, unauthenticated, type Db, type InvitationsTable, type Mailer } from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { microsoftSignIn, type ServerConfig } from "../config.ts";
import { connectorReach } from "./connector-reach.ts";
import { acceptInvitation, accountByEmail, clearSessionCookies, createSession, declineInvitation, endEverything, findOrCreateAccount, invitationPlace, isOwnOrigin, restPrincipal, sessionTokens, setSessionCookie } from "./identity.ts";
import { returnsTo } from "./oauth.ts";
import { authPage, authPageHeaders } from "./page.ts";

/** The sample's people, whom the development sign-in page offers first (`seed.ts`). */
const DEV_SAMPLE_PEOPLE = ["riley@example.com", "sam@example.com", "jordan@example.com"];
/** How many accounts the development sign-in page offers; the rest are signed in by typing their email. */
const DEV_ACCOUNTS_SHOWN = 40;
/** A person's highest role in an organization, as the development sign-in page says it. */
const DEV_ROLE_ORDER = ["owner", "admin", "editor", "viewer", "member", "reader"] as const;
const DEV_ROLE_WORDS: Record<(typeof DEV_ROLE_ORDER)[number], string> = {
  owner: "Owns",
  admin: "Admin in",
  editor: "Editor in",
  viewer: "Viewer in",
  member: "Member of",
  reader: "Reads the Story in",
};

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
   * someone with an invitation, or an address an instance owner has let create an organization;
   * and anyone, as a guest, while an instance owner lets guests sign up themselves.
   */
  const mayJoin = async (email: string) => {
    if (!config.signupAllowlist) return true;
    if ((await readGuests(db)).self_serve) return true;
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

  /**
   * Email a single-use sign-in link to an address that may sign in here. Every address gets the
   * same answer, at the same speed, and meets the same hourly limit, so the form never says whether
   * an address has an account, an invitation or an allowance: one that may not sign in is sent
   * nothing, and its request is counted as a link would be. The email goes out after the answer,
   * so a slow mail server does not tell them apart either; a failure to send it is logged.
   */
  app.post("/auth/email", async (c) => {
    if (config.mailer === "none") throw notFound("Sign-in links by email aren’t set up on this server. Sign in another way.");
    const body = z.strictObject({ email: z.string().trim().email().max(320), next: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter a valid email.");
    const email = body.data.email;
    const recent = await db
      .selectFrom("email_tokens")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .where("created_at", ">", new Date(Date.now() - 3600_000).toISOString())
      .executeTakeFirst();
    if (Number(recent?.n ?? 0) >= SIGN_IN_LINKS_PER_HOUR) throw new AppError(429, "rate_limited", "Too many sign-in links for this email in the last hour. Use the latest one, or try again later.");
    const allowed = await mayJoin(email);
    // A link is made either way, so the limit counts every address alike; one that may not sign in
    // is never sent, and opening it would be refused all the same.
    const token = randomToken();
    await db
      .insertInto("email_tokens")
      .values({ token_hash: sha256Hex(token), email, purpose: "sign_in", redirect: safeNext(body.data.next), expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
      .execute();
    if (allowed) {
      const link = `${config.publicBaseUrl}/auth/verify?token=${token}`;
      void mailer
        .send({ to: email, subject: "Your WhatBuild sign-in link", text: `Sign in to WhatBuild:\n\n${link}\n\nThe link works once, for 15 minutes. If you didn’t ask for it, ignore this email.\n` })
        .catch((e: unknown) => console.error(JSON.stringify({ at: new Date().toISOString(), event: "sign_in_link_not_sent", error: e instanceof Error ? e.message : String(e) })));
    }
    return c.json({ received: true, ...(config.env !== "production" && config.mailer === "console" ? { dev_note: "In development, a link is printed in the server’s terminal." } : {}) });
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
    await startSession(c, account.account_id);
    return c.redirect(safeNext(row.redirect), 303);
  });

  /**
   * Development only: sign in as any email without a link. Compiled into the server, refused unless
   * enabled. With `create: false` an address with no account is refused (404 no_account) and none is
   * made, so a test tool signing someone in again can tell an account that was removed.
   */
  app.post("/auth/dev-sign-in", async (c) => {
    if (!config.devAuth) throw notFound("Not available.");
    const body = z
      .strictObject({ email: z.string().trim().email(), display_name: z.string().max(100).optional(), next: z.string().optional(), create: z.boolean().default(true) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Enter a valid email.");
    if (!body.data.create && !(await accountByEmail(db, body.data.email)))
      throw new AppError(404, "no_account", `${body.data.email} has no account here, and none was made.`);
    // Development lets any address in.
    const { account, created } = await findOrCreateAccount(db, body.data.email, body.data.display_name);
    await startSession(c, account.account_id);
    return c.json({ signed_in: true, account, created, next: safeNext(body.data.next) });
  });

  /**
   * Development only: the accounts on this server, for the sign-in page to offer one click each:
   * the sample's people first, then the newest, each with what it is here in a few words.
   */
  app.get("/auth/dev-accounts", async (c) => {
    if (!config.devAuth) throw notFound("Not available.");
    const accounts = await db.selectFrom("accounts").select(["account_id", "email", "display_name"]).where("deleted_at", "is", null).orderBy("created_at", "desc").execute();
    const ordered = [...DEV_SAMPLE_PEOPLE.flatMap((e) => accounts.filter((a) => a.email.toLowerCase() === e)), ...accounts.filter((a) => !DEV_SAMPLE_PEOPLE.includes(a.email.toLowerCase()))];
    const shown = ordered.slice(0, DEV_ACCOUNTS_SHOWN);
    const ids = shown.map((a) => a.account_id);
    const emails = shown.map((a) => a.email.toLowerCase());
    const roles = ids.length
      ? await db
          .selectFrom("memberships as m")
          .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
          .select(["m.account_id", "m.scope_type", "m.role", "t.tenant_id", "t.name", "t.plan", "t.example", "t.read_only_since"])
          .where("m.account_id", "in", ids)
          .execute()
      : [];
    const allowed = emails.length ? await db.selectFrom("tenant_allowances").select(["email", "allowed"]).where("email", "in", emails).execute() : [];
    const asked = emails.length ? await db.selectFrom("interest").select(sql<string>`lower(email)`.as("email")).where(sql<string>`lower(email)`, "in", emails).execute() : [];
    const items = shown.map((a) => {
      const email = a.email.toLowerCase();
      const mine = roles.filter((r) => r.account_id === a.account_id);
      const tenants = [...new Map(mine.map((r) => [r.tenant_id, r])).values()];
      // Each organization under the person's highest role in it: "Owns Studio, Northwind (Pro)".
      const byRole = new Map<(typeof DEV_ROLE_ORDER)[number], string[]>();
      for (const t of tenants) {
        const here = mine.filter((r) => r.tenant_id === t.tenant_id).map((r) => r.role);
        const best = DEV_ROLE_ORDER.find((r) => here.includes(r)) ?? "member";
        const kind = t.example ? " (example)" : t.read_only_since ? " (read-only)" : t.plan === config.newOrganizationPlan ? "" : ` (${planName(t.plan)})`;
        byRole.set(best, [...(byRole.get(best) ?? []), `${t.name}${kind}`]);
      }
      const about = DEV_ROLE_ORDER.filter((r) => byRole.has(r)).map((r) => `${DEV_ROLE_WORDS[r]} ${byRole.get(r)!.join(", ")}`);
      if (isInstanceOwner(config, email)) about.unshift("Runs this instance");
      else if (!tenants.length) {
        const may = (allowed.find((x) => x.email === email)?.allowed ?? config.defaultTenantAllowance ?? 0) > 0;
        about.push(may ? "May start an organization" : asked.some((x) => x.email === email) ? "Guest, on the waitlist" : "Guest");
      }
      return { email: a.email, display_name: a.display_name, about: about.join(" · ") };
    });
    return c.json({ items, more: Math.max(0, ordered.length - shown.length) }, 200, { "Cache-Control": "no-store" });
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

  /** What every method does once it has an address it trusts: admission, the account, a session. Invitations wait for their person's answer. */
  const completeSignIn = async (c: Context, email: string, name: string | undefined, next: string) => {
    if (!(await mayJoin(email))) return c.redirect("/signin?error=invite_only");
    const { account } = await findOrCreateAccount(db, email, name);
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
    const asked = await db.selectFrom("interest").select("created_at").where(sql<string>`lower(email)`, "=", p.email.toLowerCase()).executeTakeFirst();
    return {
      account_id: p.account_id, email: p.email, display_name: p.display_name, auth_kind: p.auth_kind, tenant_allowance,
      new_organization_plan: tenant_allowance.instance_owner ? "unlimited" : config.newOrganizationPlan,
      hide_example: Boolean(prefs?.hide_example),
      // In no organization, with no allowance: they come into the example organization as a guest, while there is room.
      guest: await isGuestAccount(db, config, p),
      // When they asked for an organization of their own (on the waitlist), from here or the public site.
      asked_for_organization_at: asked?.created_at ?? null,
    };
  };

  app.get("/api/v1/me", async (c) => c.json(await meOf(await requirePrincipal(c))));

  /**
   * A guest account's place: let them in if there is room, or say why not and how long to wait.
   * The web app asks only when the guest does something (opens it, moves to another screen, comes
   * back to the tab, presses Try again), never on a timer. Anyone else is no guest, and always in.
   */
  app.get("/api/v1/me/guest-pass", async (c) => {
    const p = await requirePrincipal(c);
    if (!(await isGuestAccount(db, config, p))) return c.json({ guest: false, status: "in" }, 200, { "Cache-Control": "no-store" });
    return c.json({ guest: true, ...(await enterAsGuest(db, p.account_id)) }, 200, { "Cache-Control": "no-store" });
  });

  /**
   * Ask for an organization of one's own: join the waitlist the instance's owners read
   * (`products.tenant_allowances`), as the public site's form does. Asking again keeps one's place
   * and adds what was sent. Someone who may already start one has no need to ask.
   */
  app.post("/api/v1/me/ask-for-organization", async (c) => {
    const p = await requirePrincipal(c);
    const body = z
      .strictObject({ organization: z.string().trim().max(200).optional(), note: z.string().trim().max(2000).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Send organization (up to 200 characters) and note (up to 2,000), or neither.");
    const allowance = await tenantAllowanceOf(db, config, p);
    if (allowance.remaining === null || allowance.remaining > 0)
      throw invalid("may_start_one", "You may already start an organization; there is no need to ask.");
    await db
      .insertInto("interest")
      .values({ interest_id: newId(), email: p.email.toLowerCase(), name: p.display_name, organization: body.data.organization || null, note: body.data.note || null })
      .onConflict((oc) =>
        oc.expression(sql`lower(email)`).doUpdateSet({
          name: sql`coalesce(excluded.name, interest.name)`,
          organization: sql`coalesce(excluded.organization, interest.organization)`,
          note: sql`coalesce(excluded.note, interest.note)`,
          updated_at: sql`now()`,
        }),
      )
      .execute();
    return c.json(await meOf(p));
  });

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

  // ---- Invitations: a person joins an organization only by choosing to --------------------------

  type InvitationRow = Selectable<InvitationsTable>;
  type Person = Awaited<ReturnType<typeof requirePrincipal>>;

  /**
   * An invitation as the person it was sent to reads it. The names are others' to choose, so each is
   * on one line, and the inviter's in quotation marks, as the email shows it. Never its token.
   */
  const invitationForPerson = async (inv: InvitationRow) => {
    const { tenant, scope } = await invitationPlace(db, inv);
    return {
      invitation_id: inv.invitation_id,
      tenant: tenant ? { slug: tenant.slug, name: oneLine(tenant.name, 100) } : null,
      scope_type: inv.scope_type,
      scope: scope ? oneLine(scope, 100) : null,
      role: inv.role,
      invited_by: quotedName(inv.created_by.display_name),
      expires_at: inv.expires_at,
    };
  };

  /**
   * The invitation a request names: by its link's token, which anyone holding the link may send, or
   * by its id, among the person's own only, so an id says nothing of anyone else's.
   */
  const namedInvitation = async (c: Context, p: Person): Promise<InvitationRow> => {
    const body = z.union([z.strictObject({ token: z.string().min(10) }), z.strictObject({ invitation_id: z.string().min(1) })]).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw invalid("invalid_input", "Name the invitation: its token or its invitation_id.");
    const inv =
      "token" in body.data
        ? await db.selectFrom("invitations").selectAll().where("token_hash", "=", sha256Hex(body.data.token)).executeTakeFirst()
        : await db.selectFrom("invitations").selectAll().where("invitation_id", "=", body.data.invitation_id).where(sql<boolean>`lower(email) = lower(${p.email})`).executeTakeFirst();
    if (!inv) throw notFound("This invitation link isn’t valid. Check that the whole link was copied, or ask for a new one.");
    return inv;
  };

  /**
   * Where an invitation stands for this person: still theirs to answer (`accepted` false), or already
   * accepted by them, with the role they hold now. Anything else is refused: one accepted by another
   * account or whose access was since removed (`invitation_used`), one past its time, cancelled or
   * declined (`invitation_expired`), one sent to another address (`invitation_wrong_address`).
   */
  const standingOf = async (inv: InvitationRow, p: Person): Promise<{ accepted: false } | { accepted: true; role: string }> => {
    if (inv.accepted_at) {
      if (inv.accepted_by !== p.account_id) throw gone("invitation_used", "This invitation was accepted by another account. Ask whoever invited you for a new link.");
      const held = await db.selectFrom("memberships").select("role").where("scope_type", "=", inv.scope_type).where("scope_id", "=", inv.scope_id).where("account_id", "=", p.account_id).executeTakeFirst();
      if (!held) {
        const { tenant } = await invitationPlace(db, inv);
        throw gone("invitation_used", `You accepted this invitation earlier, and that access was removed. Ask an admin of ${tenant?.name ?? "the organization"} to give it back.`);
      }
      return { accepted: true, role: held.role };
    }
    if (Date.parse(inv.expires_at) <= Date.now()) throw gone("invitation_expired", "This invitation expired, was cancelled or was declined. Ask whoever invited you for a new link.");
    // An invitation belongs to the address it was sent to: the link is a pointer, not a bearer credential.
    if (inv.email.toLowerCase() !== p.email.toLowerCase())
      throw new AppError(403, "invitation_wrong_address", `This invitation was sent to ${maskEmail(inv.email)}, and you’re signed in as ${p.email}. Sign in with that email to answer it.`, {
        invited: maskEmail(inv.email),
      });
    return { accepted: false };
  };

  /** Where it stands now that another answer got there first: accepted by this person, or refused as `standingOf` refuses. */
  const standingAfterAnother = async (inv: InvitationRow, p: Person) => {
    const now = await db.selectFrom("invitations").selectAll().where("invitation_id", "=", inv.invitation_id).executeTakeFirstOrThrow();
    const standing = await standingOf(now, p);
    if (!standing.accepted) throw gone("invitation_expired", "This invitation can’t be answered now. Ask whoever invited you for a new link.");
    return standing;
  };

  /** The invitations waiting for this person's answer, newest first: open, and sent to their address. */
  app.get("/api/v1/me/invitations", async (c) => {
    const p = await requirePrincipal(c);
    const rows = await db
      .selectFrom("invitations")
      .selectAll()
      .where(sql<boolean>`lower(email) = lower(${p.email})`)
      .where("accepted_at", "is", null)
      .where("expires_at", ">", new Date().toISOString())
      .orderBy("created_at", "desc")
      .limit(100)
      .execute();
    return c.json({ items: await Promise.all(rows.map(invitationForPerson)) }, 200, { "Cache-Control": "no-store" });
  });

  /**
   * What opening an invitation's link shows: the choice, with who is asking, or why it can't be used.
   * It changes nothing. The token travels in the body so that no request log keeps it.
   */
  app.post("/api/v1/invitations/read", async (c) => {
    const p = await requirePrincipal(c);
    const inv = await namedInvitation(c, p);
    const standing = await standingOf(inv, p);
    return c.json({ ...(await invitationForPerson(inv)), ...(standing.accepted ? { accepted: true, role: standing.role } : { accepted: false }) });
  });

  /**
   * Accept, from the link or the person's list. It answers with the role they hold there;
   * `already: true` when they had accepted it before, from either, and still hold it.
   */
  app.post("/api/v1/invitations/accept", async (c) => {
    const p = await requirePrincipal(c);
    const inv = await namedInvitation(c, p);
    const standing = await standingOf(inv, p);
    const about = await invitationForPerson(inv);
    if (standing.accepted) return c.json({ accepted: true, already: true, ...about, role: standing.role });
    const done = await acceptInvitation(db, inv.invitation_id, { account_id: p.account_id, email: p.email, display_name: p.display_name });
    if (done) return c.json({ accepted: true, already: false, ...about, role: done.role });
    return c.json({ accepted: true, already: true, ...about, role: (await standingAfterAnother(inv, p)).role });
  });

  /** Decline, from the link or the person's list. It ends the invitation and gives no role. */
  app.post("/api/v1/invitations/decline", async (c) => {
    const p = await requirePrincipal(c);
    const inv = await namedInvitation(c, p);
    const alreadyAccepted = () => gone("invitation_used", "You’ve already accepted this invitation, so there’s nothing to decline.");
    if ((await standingOf(inv, p)).accepted) throw alreadyAccepted();
    if (!(await declineInvitation(db, inv.invitation_id, { account_id: p.account_id, email: p.email, display_name: p.display_name }))) {
      await standingAfterAnother(inv, p);
      throw alreadyAccepted();
    }
    return c.json({ declined: true, ...(await invitationForPerson(inv)) });
  });

  return app;
}
