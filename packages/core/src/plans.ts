/**
 * The plans, and what guests may do, with nothing else imported, so the web app and the public
 * site can share the types (`@whatbuild/core/plans`). The plans are the deployment's: their ids,
 * names, what each is for, every limit each starts with and its price come from the deployment's
 * configuration (`WHATBUILD_PLANS`), never from the code, which knows only `unlimited`, the plan
 * that sets no limit and is never offered. An instance owner changes a plan's limits and price, and
 * the guests' limits, on the instance's page; what they set is stored with the deployment
 * (`settings.ts`) and read over the configured values. `limits.ts` enforces them.
 */

/** A plan's id, as the deployment names it, or `unlimited`. */
export type Plan = string;
/** The plan that sets no limit: the deployment's own organizations, and every one on a deployment that defines no plans. */
export const UNLIMITED = "unlimited";
/** What a plan's id may be: lowercase letters, digits, `-` and `_`, starting with a letter. */
export const PLAN_ID = /^[a-z][a-z0-9_-]{0,39}$/;

export type Limits = {
  requests_per_minute: number;
  writes_per_minute: number;
  writes_per_day: number;
  sources_per_day: number;
  exports_per_day: number;
  org_writes_per_day: number;
  file_max_bytes: number;
  bytes_per_day: number;
  org_bytes_per_day: number;
  text_max_chars: number;
  batch_max: number;
  /** What the organization holds at once; null is no limit. */
  members_max: number | null;
  products_max: number | null;
  sources_max: number | null;
  storage_max_bytes: number | null;
  /** Bytes WhatBuild sends each person a day: files, exports and pages they open; null is no limit. */
  sent_bytes_per_day: number | null;
  fetch_url: boolean;
  documents_only: boolean;
};
export type LimitKey = keyof Limits;

/** A plan as the deployment defines it: its id, name, what it is for, every limit it starts with, and its price as people read it, if any. */
export interface PlanDefinition {
  id: string;
  name: string;
  about: string;
  price: string | null;
  limits: Limits;
}

let defined: PlanDefinition[] = [];

/**
 * The plans this process serves, in the order they are compared, as the deployment's configuration
 * defines them. Set once at start-up (`createApp`); none on a deployment that offers no plans.
 */
export function configurePlans(plans: PlanDefinition[]): void {
  defined = plans.map((p) => ({ ...p, limits: { ...p.limits } }));
}

/** The plans the deployment defines, in order: what is offered. Empty when it offers none. */
export function definedPlans(): PlanDefinition[] {
  return defined;
}

/** A plan's name as people read it: the deployment's, "Unlimited", or its id when the deployment no longer defines it. */
export function planName(plan: Plan): string {
  if (plan === UNLIMITED) return "Unlimited";
  return defined.find((p) => p.id === plan)?.name ?? plan;
}

/** Whether the deployment defines a plan of this id. */
export function isDefinedPlan(plan: Plan): boolean {
  return defined.some((p) => p.id === plan);
}

/** A plan as this deployment has it: its limits, and what it costs as people read it, if anything. */
export interface PlanSetting {
  limits: Limits;
  price: string | null;
}
export type PlanSettings = Record<string, PlanSetting>;

/** The plans before an instance owner changes anything: as the deployment defines them. */
export function defaultPlans(): PlanSettings {
  return Object.fromEntries(defined.map((p) => [p.id, { limits: { ...p.limits }, price: p.price }]));
}

/**
 * The plans this WhatBuild offers, each with every limit and its price, if any: what the plans
 * page, an organization's plan and the instance's owners compare.
 */
export function planCatalogue(plans: PlanSettings = defaultPlans()) {
  return defined.map((p) => ({ id: p.id, name: p.name, about: p.about, price: plans[p.id]?.price ?? null, limits: plans[p.id]?.limits ?? p.limits }));
}
export type PlanEntry = ReturnType<typeof planCatalogue>[number];

/**
 * What a guest of the example organization meets: its calls a minute and bytes downloaded a day, as
 * the guests' settings say. A guest writes nothing (refused before any limit), so the rest is closed.
 */
export function guestLimits(g: Pick<GuestSettings, "requests_per_minute" | "sent_bytes_per_day">): Limits {
  return {
    requests_per_minute: g.requests_per_minute, writes_per_minute: 0, writes_per_day: 0, sources_per_day: 0, exports_per_day: 0, org_writes_per_day: 0,
    file_max_bytes: 0, bytes_per_day: 0, org_bytes_per_day: 0, text_max_chars: 0, batch_max: 0,
    members_max: null, products_max: null, sources_max: null, storage_max_bytes: null, sent_bytes_per_day: g.sent_bytes_per_day,
    fetch_url: false, documents_only: true,
  };
}

const MiB = 1024 * 1024;

// ---- Guests --------------------------------------------------------------------------------------

/**
 * Who may come in as a guest, and how many: a guest is an account in no organization, with no
 * allowance to start one, which reads the example organization and nothing else. An instance owner
 * sets these on the instance's page, and raises them as the deployment grows.
 */
export interface GuestSettings {
  /** Anyone may make an account and come in as a guest; off, accounts are made only for people invited or let in. */
  self_serve: boolean;
  /** Guests in at once; 0 lets no guest in. */
  at_once: number;
  /** Guests coming in for the first time, each UTC day. */
  new_per_day: number;
  /** Minutes without a call after which a guest's place goes to someone else. */
  idle_minutes: number;
  /** Minutes each guest may be in, each UTC day. */
  minutes_per_day: number;
  /** Calls a minute, each guest. */
  requests_per_minute: number;
  /** Bytes of attachments and downloads each guest is sent a day. */
  sent_bytes_per_day: number;
}
export type GuestKey = keyof GuestSettings;

export const GUEST_DEFAULTS: GuestSettings = {
  self_serve: false,
  at_once: 25,
  new_per_day: 50,
  idle_minutes: 30,
  minutes_per_day: 120,
  requests_per_minute: 120,
  sent_bytes_per_day: 10 * MiB,
};

/** Every guest setting, in the order the instance's page shows them. */
export const GUEST_FIELDS: { key: GuestKey; label: string; unit: "switch" | "guests" | "minutes" | "calls" | "bytes"; help: string }[] = [
  { key: "self_serve", label: "Anyone can sign up as a guest", unit: "switch", help: "Off, an account is made only for someone invited, listed or given an allowance." },
  { key: "at_once", label: "Guests in at once", unit: "guests", help: "Past it, a guest waits in line and comes in when a place frees. 0 lets no guest in." },
  { key: "new_per_day", label: "New guests a day", unit: "guests", help: "Guests coming in for the first time, each UTC day. Past it, they come back the next day." },
  { key: "idle_minutes", label: "A place frees after", unit: "minutes", help: "Minutes without a call from the guest or their agent." },
  { key: "minutes_per_day", label: "Time in, each guest a day", unit: "minutes", help: "Counted while they are in. It starts again at midnight UTC." },
  { key: "requests_per_minute", label: "Calls a minute, each guest", unit: "calls", help: "Every call a guest or their agent makes, reads included." },
  { key: "sent_bytes_per_day", label: "Downloads, each guest a day", unit: "bytes", help: "Attachments and mockup downloads from the example organization." },
];

export interface LimitInfo {
  key: LimitKey;
  group: "frequency" | "size" | "total" | "switch";
  label: string;
  /** What one unit is, for a person: "calls", "bytes". */
  unit: string;
  /** What the limit is counted over. */
  per: "Each person, each minute" | "Each person, each day" | "Everyone together, each day" | "The whole organization" | "Each file" | "Each text field" | "Each call" | "Each person";
  /** The error a caller over the limit receives. */
  refusal: string;
  help: string;
}

/** Every limit, in the order the control panel shows them. */
export const LIMITS: LimitInfo[] = [
  { key: "members_max", group: "total", label: "People", unit: "people", per: "The whole organization", refusal: "409 quota_exceeded", help: "Everyone with a role in it, owners included. People who only read the Story don't count." },
  { key: "products_max", group: "total", label: "Products", unit: "products", per: "The whole organization", refusal: "409 quota_exceeded", help: "Every product, archived or not. Deleting one makes room." },
  { key: "sources_max", group: "total", label: "Sources", unit: "sources", per: "The whole organization", refusal: "409 quota_exceeded", help: "Every source, archived or not. Deleting one makes room." },
  { key: "storage_max_bytes", group: "total", label: "Storage", unit: "bytes", per: "The whole organization", refusal: "409 quota_exceeded", help: "Attachments with every version and the text read from each, and everything written, earlier versions included. Archiving keeps it all; deleting frees it." },
  { key: "requests_per_minute", group: "frequency", label: "Calls", unit: "calls", per: "Each person, each minute", refusal: "429 rate_limited", help: "Every call a person or their agent makes, reads included." },
  { key: "writes_per_minute", group: "frequency", label: "Writes", unit: "writes", per: "Each person, each minute", refusal: "429 rate_limited", help: "Calls that change something." },
  { key: "writes_per_day", group: "frequency", label: "Writes", unit: "writes", per: "Each person, each day", refusal: "409 quota_exceeded", help: "A day runs from midnight to midnight UTC." },
  { key: "sources_per_day", group: "frequency", label: "Sources added", unit: "sources", per: "Each person, each day", refusal: "409 quota_exceeded", help: "Sources created or copied in, a batch counted source by source." },
  { key: "exports_per_day", group: "frequency", label: "Exports", unit: "exports", per: "Each person, each day", refusal: "409 quota_exceeded", help: "Taking a whole product out as a ZIP." },
  { key: "sent_bytes_per_day", group: "frequency", label: "Data sent", unit: "bytes", per: "Each person, each day", refusal: "409 quota_exceeded", help: "Attachments, exports and pages opened or downloaded." },
  { key: "org_writes_per_day", group: "frequency", label: "Writes", unit: "writes", per: "Everyone together, each day", refusal: "409 quota_exceeded", help: "Everyone's writes added up." },
  { key: "file_max_bytes", group: "size", label: "File size", unit: "bytes", per: "Each file", refusal: "413 too_large", help: "Checked as the file uploads." },
  { key: "bytes_per_day", group: "size", label: "Uploads", unit: "bytes", per: "Each person, each day", refusal: "409 quota_exceeded", help: "Counted when a file is attached." },
  { key: "org_bytes_per_day", group: "size", label: "Uploads", unit: "bytes", per: "Everyone together, each day", refusal: "409 quota_exceeded", help: "Everyone's uploads added up." },
  { key: "text_max_chars", group: "size", label: "Text in one field", unit: "characters", per: "Each text field", refusal: "413 too_large", help: "The longest body, note or Story page one call may send." },
  { key: "batch_max", group: "size", label: "Sources in one call", unit: "sources", per: "Each call", refusal: "413 too_large", help: "How many sources one archive or restore call may name." },
  { key: "fetch_url", group: "switch", label: "Fetching a file from a URL", unit: "", per: "Each person", refusal: "403 plan_restricted", help: "Off stops the server fetching links." },
  { key: "documents_only", group: "switch", label: "Uploads limited to formats the parsers read", unit: "", per: "Each person", refusal: "403 plan_restricted", help: "On allows only text, Markdown, transcripts, HTML, Word, PDF, spreadsheets and XML; off keeps recordings, images and any other file too, unread." },
];
