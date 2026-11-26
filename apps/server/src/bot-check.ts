import { createHash } from "node:crypto";
import { AppError, type Db } from "@whatbuild/core";
import { sql } from "kysely";
import { TURNSTILE_TEST_SECRET, type ServerConfig } from "./config.ts";

/**
 * The bot check: Cloudflare Turnstile, on the forms anyone can send without being signed in and
 * that make WhatBuild mail someone or make an account (asking for a sign-in link, starting to sign
 * in with Google or Microsoft, joining the waitlist). The page shows Cloudflare's widget, which
 * mostly decides without asking anything, and sends its token with the form; the server asks
 * Cloudflare whether the token is good before doing anything else. A deployment without the keys
 * (WHATBUILD_TURNSTILE_SITE_KEY, WHATBUILD_TURNSTILE_SECRET_KEY) asks nobody for one.
 */

/** What each form is, as its widget names it and its token must say. */
export type BotCheckAction = "sign_in" | "waitlist";

/** The field a form sends its token in. */
export const BOT_CHECK_FIELD = "bot_check";

/** How long the server waits for Cloudflare's answer, in milliseconds. */
const VERIFY_TIMEOUT_MS = 8000;

/** How many tokens checked with Cloudflare in an hour, none of them passing, mean the check refuses everyone. */
const ALL_REFUSED_AFTER = 20;

/** How long a token is good for at Cloudflare, and so how long the server remembers one it took: five minutes. */
const TOKEN_SECONDS = 300;

/** What a page needs to show the widget: the site key, or null where the bot check is off. */
export function botCheckFor(config: Pick<ServerConfig, "turnstileSiteKey">): { site_key: string } | null {
  return config.turnstileSiteKey ? { site_key: config.turnstileSiteKey } : null;
}

/** The refusal when the token is missing, spent, expired or not this deployment's. */
export const botCheckFailed = () =>
  new AppError(403, "bot_check_failed", "WhatBuild couldn’t confirm that a person sent this. Reload the page and try again.");

/** The host names a token may come from: the app's and the public site's. */
function hostsOf(config: Pick<ServerConfig, "publicBaseUrl" | "siteUrl">): Set<string> {
  return new Set([config.publicBaseUrl, config.siteUrl].filter((u): u is string => Boolean(u)).map((u) => new URL(u).hostname.toLowerCase()));
}

/**
 * Why a check was refused. `no_token`, `rejected` (Cloudflare said the token is not good: made up,
 * expired, or already redeemed) and `used_before` are what a script meets. `unavailable` (Cloudflare
 * could not be asked), `wrong_secret` (Cloudflare refused the secret key), `wrong_action` and
 * `wrong_host` (a good token, made for another form or on a host the server does not name: its
 * settings do not match the widget's) refuse everyone.
 */
type Refusal = "no_token" | "rejected" | "used_before" | "unavailable" | "wrong_secret" | "wrong_action" | "wrong_host";

/** What each server has seen in the current hour, and the hour each error was last said in. */
interface Tally {
  hour: string;
  checked: number;
  passed: number;
  said: Map<string, string>;
}
const tallies = new WeakMap<object, Tally>();

function tallyOf(config: object): Tally {
  const hour = new Date().toISOString().slice(0, 13);
  let t = tallies.get(config);
  if (!t) tallies.set(config, (t = { hour, checked: 0, passed: 0, said: new Map() }));
  if (t.hour !== hour) Object.assign(t, { hour, checked: 0, passed: 0 });
  return t;
}

/**
 * A line in the log for a refused check: its reason, what Cloudflare said, never the token. When the
 * reason means the check refuses everyone, the line is an error, which the log's alert mails, once
 * an hour on each instance for each such reason; otherwise a warning.
 */
function logRefusal(config: object, reason: Refusal, fields: Record<string, unknown>): void {
  const t = tallyOf(config);
  const everyone = reason === "unavailable" || reason === "wrong_secret" || reason === "wrong_action" || reason === "wrong_host";
  const alert = everyone && t.said.get(reason) !== t.hour;
  if (alert) t.said.set(reason, t.hour);
  const line = JSON.stringify({
    at: new Date().toISOString(),
    severity: alert ? "ERROR" : "WARNING",
    event: reason === "unavailable" ? "bot_check_unavailable" : "bot_check_refused",
    reason,
    ...fields,
    ...(alert ? { message: `The bot check refuses everyone (${reason}): nobody new can ask for a sign-in link, start Google or Microsoft sign-in, or join the waitlist. Said once an hour. okf/operations/cloud-run.md, The bot check.` } : {}),
  });
  if (alert) console.error(line);
  else console.warn(line);
}

/** Count a check Cloudflare answered; say once an hour when a whole run of them failed and none passed. */
function countChecked(config: object, passed: boolean): void {
  const t = tallyOf(config);
  t.checked++;
  if (passed) t.passed++;
  if (!passed && !t.passed && t.checked === ALL_REFUSED_AFTER && t.said.get("all_refused") !== t.hour) {
    t.said.set("all_refused", t.hour);
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        severity: "ERROR",
        event: "bot_check_refused_all",
        checked: t.checked,
        message: `The last ${t.checked} tokens Cloudflare was asked about this hour were all refused and none passed: a flood of scripts, or a widget whose site key does not go with the secret key. okf/operations/cloud-run.md, The bot check.`,
      }),
    );
  }
}

/**
 * Take a token once. Cloudflare redeems each token once, but only as its network catches up: checks
 * sent together can all succeed. So the server keeps a hash of each token it took, for as long as a
 * token is good, and refuses it a second time. True when this is its first use.
 */
async function firstUse(db: Db, token: string, now = Date.now()): Promise<boolean> {
  const subject = createHash("sha256").update(token).digest("base64url");
  const bucket = Math.floor(now / (TOKEN_SECONDS * 1000)) * TOKEN_SECONDS * 1000;
  const [current, previous] = [new Date(bucket).toISOString(), new Date(bucket - TOKEN_SECONDS * 1000).toISOString()];
  // In the current five minutes or the five before, which together hold any use of a token still good.
  const taken = await sql<{ n: number }>`
    insert into abuse_counters (name, subject, starts_at, n)
    select 'bot_check_token', ${subject}, ${current}, 1
    where not exists (select 1 from abuse_counters where name = 'bot_check_token' and subject = ${subject} and starts_at = ${previous})
    on conflict do nothing
    returning n`.execute(db);
  return taken.rows.length === 1;
}

/**
 * Whether `token` is a good one for `action`: Cloudflare says it succeeded, it was made for this
 * form and on this deployment's own pages, and it was not used before. True whenever the bot check
 * is off. When Cloudflare cannot be reached it is false: the forms wait for Cloudflare rather than
 * let a script through. Every refusal is logged with its reason (`logRefusal`).
 */
export async function passesBotCheck(
  config: Pick<ServerConfig, "turnstileSecretKey" | "turnstileVerifyUrl" | "publicBaseUrl" | "siteUrl">,
  db: Db,
  token: unknown,
  action: BotCheckAction,
  address: string | null,
): Promise<boolean> {
  if (!config.turnstileSecretKey) return true;
  if (typeof token !== "string" || !token || token.length > 2048) {
    logRefusal(config, "no_token", { action, ...(typeof token === "string" && token.length > 2048 ? { note: "longer than any token" } : {}) });
    return false;
  }
  let answer: { success?: unknown; action?: unknown; hostname?: unknown; "error-codes"?: unknown };
  try {
    const res = await fetch(config.turnstileVerifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.turnstileSecretKey, response: token, ...(address ? { remoteip: address } : {}) }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`siteverify answered ${res.status}`);
    answer = (await res.json()) as typeof answer;
  } catch (e) {
    logRefusal(config, "unavailable", { action, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
  const codes = Array.isArray(answer["error-codes"]) ? answer["error-codes"].filter((c): c is string => typeof c === "string").slice(0, 5) : [];
  if (answer.success !== true) {
    const wrongSecret = codes.some((c) => c === "invalid-input-secret" || c === "missing-input-secret");
    logRefusal(config, wrongSecret ? "wrong_secret" : "rejected", { action, error_codes: codes });
    if (!wrongSecret) countChecked(config, false);
    return false;
  }
  // Cloudflare's test keys answer for any page, with no action and example.com as the host, and
  // take the same dummy token every time.
  if (TURNSTILE_TEST_SECRET.test(config.turnstileSecretKey)) return true;
  if (answer.action !== action) {
    logRefusal(config, "wrong_action", { action, token_action: typeof answer.action === "string" ? answer.action.slice(0, 40) : null });
    return false;
  }
  if (typeof answer.hostname !== "string" || !hostsOf(config).has(answer.hostname.toLowerCase())) {
    logRefusal(config, "wrong_host", { action, token_hostname: typeof answer.hostname === "string" ? answer.hostname.slice(0, 253) : null, hosts: [...hostsOf(config)] });
    return false;
  }
  if (!(await firstUse(db, token))) {
    logRefusal(config, "used_before", { action });
    return false;
  }
  countChecked(config, true);
  return true;
}
