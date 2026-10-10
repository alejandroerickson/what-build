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
const SCREEN_WORDS = new Set(["idea", "evidence", "new", "search", "exploration", "mockups", "insights", "assumptions", "decisions", "edit", "story", "connect", "activity", "settings", "members", "sandbox"]);

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
 * What a change the app made was, as an event name built only from known words, never a name, id
 * or slug: `POST /api/v1/p/acme/core/planner/insights/01J…/review` is `insights_review`, and
 * `PATCH …/insights/01J…` is `insights_update`.
 */
const NOUNS = new Set(["insights", "outcomes", "sources", "assumptions", "decisions", "annotations", "files", "exports", "settings", "members", "invitations", "products", "tenants", "sandbox", "baselines", "invites", "visitors", "agents", "me", "revisions", "story", "pages", "versions", "tenant-allowances", "auth", "email", "dev-sign-in", "sign-out"]);
const VERBS = new Set(["review", "archive", "restore", "check-citations", "remove", "revoke", "cancel", "accept", "join", "reset", "role"]);
const METHOD_VERB: Record<string, string> = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

export function actionName(method: string, path: string): string {
  // Google's own name for a sign-up on the landing page, so it can be a key event as it stands.
  if (path === "/api/v1/interest") return "generate_lead";
  const parts = path.split("?")[0]!.split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1] === "v1") parts.splice(0, 2);
  // The owner of the change: a product, a team or an organization, named only by kind.
  if (parts[0] === "p") parts.splice(0, 4, ...(parts.length === 4 ? ["product"] : []));
  else if (parts[0] === "teams") parts.splice(0, 3, ...(parts.length === 3 ? ["team"] : []));
  else if (parts[0] === "tenants" && parts.length > 2) parts.splice(0, 2);
  const words = parts.filter((p) => NOUNS.has(p) || VERBS.has(p) || p === "product" || p === "team");
  const last = words.at(-1);
  if (!last || !VERBS.has(last)) words.push(METHOD_VERB[method] ?? method.toLowerCase());
  return words.join("_").replace(/-/g, "_").slice(0, 40);
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
  // Page views are sent by hand, from the screen's path; Google's own would carry the real address.
  window.gtag("config", id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  setChangeListener((method, path) => window.gtag?.("event", actionName(method, path)));
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

/** Counts a page view. Every event Google sends after it carries the masked address and a fixed title. */
export function pageView(pathname: string) {
  if (!window.gtag) return;
  const path = screenPath(pathname);
  const referrer = document.referrer.startsWith(location.origin) ? `${location.origin}${screenPath(new URL(document.referrer).pathname)}` : document.referrer;
  window.gtag("set", { page_location: `${location.origin}${path}`, page_path: path, page_title: "WhatBuild", page_referrer: referrer });
  window.gtag("event", "page_view");
}

function stopAnalytics() {
  if (loadedId) (window as unknown as Record<string, unknown>)[`ga-disable-${loadedId}`] = true;
  // Google's cookies are _ga and _ga_<stream>, set on this host or a parent domain.
  const names = document.cookie.split("; ").map((c) => c.split("=")[0]!).filter((n) => n === "_ga" || n.startsWith("_ga_"));
  const domains = ["", ...parentDomains().map((d) => `; domain=.${d}`)];
  for (const n of names) for (const d of domains) document.cookie = `${n}=; max-age=0; path=/${d}`;
}
