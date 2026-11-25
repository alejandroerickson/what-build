import { AppError } from "@whatbuild/core";
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
 * Whether `token` is a good one for `action`: Cloudflare says it succeeded, it was made for this
 * form and on this deployment's own pages, and it was not used before (Cloudflare redeems each
 * token once). True whenever the bot check is off. When Cloudflare cannot be reached it is false:
 * the forms wait for Cloudflare rather than let a script through, and the log says so.
 */
export async function passesBotCheck(
  config: Pick<ServerConfig, "turnstileSecretKey" | "turnstileVerifyUrl" | "publicBaseUrl" | "siteUrl">,
  token: unknown,
  action: BotCheckAction,
  address: string | null,
): Promise<boolean> {
  if (!config.turnstileSecretKey) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
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
    console.warn(JSON.stringify({ at: new Date().toISOString(), severity: "WARNING", event: "bot_check_unavailable", error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
  if (answer.success !== true) return false;
  // Cloudflare's test keys answer for any page, with no action and example.com as the host.
  if (TURNSTILE_TEST_SECRET.test(config.turnstileSecretKey)) return true;
  return answer.action === action && typeof answer.hostname === "string" && hostsOf(config).has(answer.hostname.toLowerCase());
}
