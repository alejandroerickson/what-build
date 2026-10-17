import { useSyncExternalStore } from "react";
import { setChangeListener } from "./api.ts";

/**
 * The person's cookie choice, and Google Analytics behind it, for the app and the public site.
 * Nothing from Google loads until the person accepts; declining later stops it and removes its
 * cookies. The choice is a cookie on the parent domain where the browser allows one, so the site
 * and the app (example.com, app.example.com) ask once between them.
 */

export const COOKIE_CHOICE_COOKIE = "wb_cookies";

export type CookieChoice = "accepted" | "declined";

const YEAR = 365 * 86400;
const listeners = new Set<() => void>();

function readChoice(): CookieChoice | null {
  const v = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_CHOICE_COOKIE}=`))?.split("=")[1];
  return v === "accepted" || v === "declined" ? v : null;
}

/** Each domain above this host, widest first. A browser refuses a public suffix on its own. */
function parentDomains(): string[] {
  const host = location.hostname.split(".");
  if (host.length < 2 || /^[\d.]+$/.test(location.hostname)) return [];
  return host.slice(0, -1).map((_, i) => host.slice(i).join(".")).reverse();
}

export function setCookieChoice(choice: CookieChoice) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  // The widest domain the browser accepts, so the site and the app share it; else this host only.
  const shared = parentDomains().some((d) => {
    document.cookie = `${COOKIE_CHOICE_COOKIE}=${choice}; max-age=${YEAR}; path=/; domain=.${d}; samesite=lax${secure}`;
    return readChoice() === choice;
  });
  if (!shared) document.cookie = `${COOKIE_CHOICE_COOKIE}=${choice}; max-age=${YEAR}; path=/; samesite=lax${secure}`;
  if (choice === "declined") stopAnalytics();
  for (const l of listeners) l();
}

export function useCookieChoice(): CookieChoice | null {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, readChoice);
}

/**
 * A path with names and ids taken out, so what reaches Google says which screen, not whose:
 * `/t/acme/core/planner/story/launch-plan` becomes `/t/:org/:team/:product/story/:id`.
 */
const SCREEN_WORDS = new Set(["idea", "evidence", "new", "search", "exploration", "mockups", "assumptions", "edit", "story", "connect", "activity", "settings", "members", "sandbox"]);

export function screenPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "t") {
    if (parts.length === 3 && SCREEN_WORDS.has(parts[2]!)) return `/t/:org/${parts[2]}`;
    const rest = parts.slice(4).map((p) => (SCREEN_WORDS.has(p) ? p : ":id"));
    return `/${[...["t", ":org", ":team", ":product"].slice(0, parts.length), ...rest].join("/")}`;
  }
  if (parts[0] === "join" || parts[0] === "invite") return `/${parts[0]}/:code`;
  return pathname;
}

/**
 * What a change the app made was, as an event name: the operation the server says it ran
 * (`X-WhatBuild-Operation`), so `POST …/assumptions/01J…/review` is `assumptions_review` and
 * `attachments.fetch_url` is `attachments_fetch_url`, never a name, id or slug from the address.
 * A change that is not an operation is sent only if it is one of a few named here, under that
 * name.
 */
const OTHER_CHANGES: [RegExp, string][] = [
  // Google's own name for a sign-up on the landing page, so it can be a key event as it stands.
  [/^\/api\/v1\/interest$/, "generate_lead"],
  [/^\/auth\/email$/, "sign_in_link"],
  [/^\/auth\/sign-out$/, "sign_out"],
  [/^\/api\/v1\/invitations\/accept$/, "invitation_accept"],
  [/^\/api\/v1\/me$/, "profile_update"],
  [/^\/api\/v1\/me\/agents\/[^/]+$/, "agent_disconnect"],
];
const OPERATION_NAME = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

export function actionName(path: string, operation: string | null): string | null {
  if (operation && OPERATION_NAME.test(operation)) return operation.replace(".", "_").slice(0, 40);
  const bare = path.split("?")[0]!;
  return OTHER_CHANGES.find(([pattern]) => pattern.test(bare))?.[1] ?? null;
}

/**
 * What a person does with search, never the words: opening it, following a result (of what kind,
 * and how far down), going on to every result, picking a recent search, and closing it without
 * following anything (and whether it had found something).
 */
export type SearchEvent =
  | { name: "search_open"; via: "field" | "shortcut" }
  | { name: "search_result_open"; kind: string; rank?: number; from: "palette" | "screen" }
  | { name: "search_all_results" }
  | { name: "search_recent_use" }
  | { name: "search_close"; found: "yes" | "no" | "waiting" | "not_typed" };

/** Counts what a person did, when they accepted analytics; otherwise nothing. */
export function track(event: SearchEvent) {
  const { name, ...params } = event;
  window.gtag?.("event", name, params);
}

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let loadedId: string | null = null;

/** Loads Google's script, once. Only after the person has accepted. */
export function startAnalytics(id: string) {
  (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = false;
  if (loadedId) return;
  loadedId = id;
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads the arguments object itself, so this must stay a function, not an arrow.
  window.gtag = function gtag() {
    window.dataLayer!.push(arguments);
  };
  window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  window.gtag("js", new Date());
  // Masked from the first event on: anything Google sends before the first page view says which screen, never whose.
  window.gtag("set", maskedPage(location.pathname));
  // Page views are sent by hand, from the screen's path; Google's own would carry the real address.
  window.gtag("config", id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  setChangeListener((path, operation) => {
    const name = actionName(path, operation);
    if (name) window.gtag?.("event", name);
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

/** What every event says of the page: the masked address, a fixed title, and where the person came from, masked too. */
export function maskedPage(pathname: string) {
  const path = screenPath(pathname);
  const referrer = document.referrer.startsWith(location.origin) ? `${location.origin}${screenPath(new URL(document.referrer).pathname)}` : document.referrer;
  return { page_location: `${location.origin}${path}`, page_path: path, page_title: "WhatBuild", page_referrer: referrer };
}

/** Puts the masked address on every event from now on, at once, when the person moves to another screen. */
export function placePage(pathname: string) {
  window.gtag?.("set", maskedPage(pathname));
}

/** Counts a page view. Every event Google sends after it carries the masked address and a fixed title. */
export function pageView(pathname: string) {
  if (!window.gtag) return;
  placePage(pathname);
  window.gtag("event", "page_view");
}

function stopAnalytics() {
  if (loadedId) (window as unknown as Record<string, unknown>)[`ga-disable-${loadedId}`] = true;
  // Google's cookies are _ga and _ga_<stream>, set on this host or a parent domain.
  const names = document.cookie.split("; ").map((c) => c.split("=")[0]!).filter((n) => n === "_ga" || n.startsWith("_ga_"));
  const domains = ["", ...parentDomains().map((d) => `; domain=.${d}`)];
  for (const n of names) for (const d of domains) document.cookie = `${n}=; max-age=0; path=/${d}`;
}
