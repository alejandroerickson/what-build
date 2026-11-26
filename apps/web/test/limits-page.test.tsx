import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_TOTAL_DEFAULTS, unlimitedProductTotal } from "@whatbuild/core/plans";

// An organization's Plan, in Settings, says to its people what plan it is on, what it holds against
// the plan's totals and what they used today, in words, with the plans side by side, the same for an
// owner of this WhatBuild. The refusals, the deployment's internals and what sets them are in Instance
// admin, under Plans.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;
const FRESH = {
  instanceOwner: false,
  /** gold: a plan the deployment no longer defines. */
  plan: "free" as "free" | "pro" | "unlimited" | "gold",
  meets: true as boolean | "calls_per_minute_only",
  contact: null as string | null,
  holds: { members: 2, invited: 0, products: 1, sources: 41, storage: { files: 30 * MB, text: 4 * MB, total: 34 * MB } },
  /** What the person's list of products says of the organization. */
  storyOnly: false,
  /** The server refuses the person, whatever their list says. */
  refused: false,
  /** The deployment defines plans; a self-hosted one defines none. */
  offered: true,
  /** What the deployment's configuration sets for Pro, where a test changes it. */
  proDefaults: null as Record<string, unknown> | null,
  /** Limits Instance admin lists beside the usual ones. */
  extraInfo: [] as { key: string; group: string; label: string; unit: string; per: string; refusal: string; help: string; min?: number }[],
};
const state = { ...FRESH };
const asked: string[] = [];

const FREE = {
  requests_per_minute: 50, writes_per_day: 150, sources_per_day: 10, exports_per_day: 3, sent_bytes_per_day: 300 * MB, org_writes_per_day: 300,
  file_max_bytes: 10 * MB, bytes_per_day: 25 * MB, org_bytes_per_day: 50 * MB, members_max: 2, products_max: 1, sources_max: 50, storage_max_bytes: 200 * MB,
  fetch_url: true, documents_only: true,
};
const PRO = { ...FREE, writes_per_day: 3000, members_max: 10, products_max: null, sources_max: 2000, storage_max_bytes: 10 * 1024 * MB, documents_only: false };

const used: Record<string, number> = { writes_per_day: 12, sources_per_day: 10, exports_per_day: 0, bytes_per_day: 2.5 * MB, sent_bytes_per_day: 0, org_writes_per_day: 40 };

const LIMIT_INFO = [
  ["members_max", "total", "People", "people"],
  ["products_max", "total", "Products", "products"],
  ["sources_max", "total", "Sources", "sources"],
  ["storage_max_bytes", "total", "Storage", "bytes"],
  ["requests_per_minute", "frequency", "Calls", "calls"],
  ["writes_per_day", "frequency", "Writes", "writes"],
  ["sources_per_day", "frequency", "Sources added", "sources"],
  ["exports_per_day", "frequency", "Exports", "exports"],
  ["sent_bytes_per_day", "frequency", "Data sent", "bytes"],
  ["org_writes_per_day", "frequency", "Writes", "writes"],
  ["file_max_bytes", "size", "File size", "bytes"],
  ["bytes_per_day", "size", "Uploads", "bytes"],
  ["documents_only", "switch", "Uploads limited to formats the parsers read", ""],
] as const;
const info = LIMIT_INFO.map(([key, group, label, unit]) => ({ key, group, label, unit, per: "Each person, each day", refusal: key === "requests_per_minute" ? "429 rate_limited" : "409 quota_exceeded", help: "" }));
/** What each product holds, as `products.limits` lists it. */
const PRODUCT_LIMIT_INFO = (
  [
    ["mockups_max", "Mockups", "mockups"],
    ["story_pages_max", "Story pages", "pages"],
    ["playbook_files_max", "Playbook files", "files"],
    ["playbook_bytes_max", "Playbook size", "bytes"],
    ["mockup_versions_max", "Versions of a mockup", "versions"],
    ["story_page_versions_max", "Versions of a Story page", "versions"],
  ] as const
).map(([key, label, unit]) => ({ key, group: "total", label, unit, per: "Each product", refusal: "409 quota_exceeded", help: "" }));
const held = (key: string) =>
  ({ members_max: state.holds.members + state.holds.invited, products_max: state.holds.products, sources_max: state.holds.sources, storage_max_bytes: state.holds.storage.total })[key];

const plans = () => [
  { id: "free", name: "Free", about: "For trying WhatBuild on one discovery.", price: null, limits: FREE },
  { id: "pro", name: "Pro", about: "For a few products and their discoveries.", price: "$10 a month", limits: PRO },
];

/** What Instance admin reads of every organization: Acme, on Free, and the plans with their limits. */
const organizations = () => ({
  plans: plans(),
  plan_defaults: { free: FREE, pro: state.proDefaults ?? PRO },
  plan_records: {},
  plan_names: { free: "Free", pro: "Pro", unlimited: "Unlimited" },
  new_organization_plan: "free",
  limits: [...info, ...state.extraInfo],
  items: [
    {
      slug: "acme", name: "Acme", name_etag: "n1", plan: "free", created_at: "2026-10-01T00:00:00.000Z", created_by: { display_name: "Ada Example" },
      holds: state.holds, etag: null, plan_changed_at: null, plan_changed_by: null, today: { people_writing: 0, writes: 0, sources: 0, exports: 0, bytes: 0 },
    },
  ],
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    asked.push(path);
    if (path === "/api/v1/me/products") return { items: [], tenants: [{ slug: "acme", name: "Acme", plan: state.plan, ...(state.storyOnly ? { story_only: true } : {}) }] };
    if (state.refused && path.endsWith("/limits")) throw new (await original<typeof import("../src/lib/api.ts")>()).ApiError(403, "forbidden", "You read only the Story in Acme.");
    if (path === "/api/v1/organizations") return organizations();
    if (path === "/api/v1/plans") return { plans: state.offered ? plans() : [], starting_plan: "free", limits: info, file_max_bytes: 100 * MB, contact: state.contact };
    const guest = state.meets === "calls_per_minute_only";
    const values = state.plan === "free" ? FREE : state.plan === "pro" ? PRO : null;
    return {
      organization: { slug: "acme", name: "Acme" },
      plan: state.plan,
      plan_name: { free: "Free", pro: "Pro", unlimited: "Unlimited", gold: "gold" }[state.plan],
      ...(state.plan === "gold" ? { undefined_plan: true } : {}),
      plan_about: "For trying WhatBuild on one discovery.",
      you_meet_them: state.meets,
      ...(guest ? {} : { holds: state.holds }),
      allowances_restart_at: "2026-10-26T00:00:00.000Z",
      limits: [
        ...info.map((l) => ({
          ...l,
          value: values ? (values as Record<string, unknown>)[l.key] ?? null : null,
          ...(guest ? {} : held(l.key) !== undefined ? { used: held(l.key) } : used[l.key] !== undefined ? { used: used[l.key] } : {}),
        })),
        // What each product holds: on a plan, its defaults; on Unlimited, or a plan the deployment no
        // longer defines, what the server gives there, a number for the Playbook and versions, none for
        // mockups and Story pages.
        ...PRODUCT_LIMIT_INFO.filter((l) => !guest).map((l) => ({ ...l, value: values ? PRODUCT_TOTAL_DEFAULTS[l.key] : unlimitedProductTotal(l.key) })),
      ],
      plans: plans(),
      deployment_limits: [
        { key: "file_max_bytes", label: "File size", value: 100 * MB, unit: "bytes", set_by: "WHATBUILD_FILE_MAX_BYTES" },
        { key: "relay_max_bytes", label: "File size through the upload relay", value: 25 * MB, unit: "bytes", set_by: "WHATBUILD_RELAY_MAX_BYTES" },
        { key: "upload_max_bytes", label: "Largest file that can be uploaded", value: 25 * MB, unit: "bytes", set_by: null },
        { key: "parse_cap_bytes", label: "Read per attachment", value: 20 * MB, unit: "bytes", set_by: "WHATBUILD_PARSE_CAP_BYTES" },
        { key: "parse_memory_bytes", label: "Memory for reading one attachment", value: 384 * MB, unit: "bytes", set_by: "WHATBUILD_PARSE_MEMORY_MB" },
        { key: "attachments_per_source", label: "Attachments on a source", value: 50, unit: "attachments", set_by: null },
      ],
    };
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useMe: () => ({ isPending: false, data: { tenant_allowance: { instance_owner: state.instanceOwner } } }),
}));

// Asked as the shell's modules load; jsdom has no media queries.
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;

const { PlansPage } = await import("../src/routes/plans.tsx");
const { InstanceLimitsSheets, InstanceOrganizationsSheet, InstancePlansSheet, OrganizationPlan } = await import("../src/routes/limits.tsx");

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

function PlanPage() {
  return <OrganizationPlan tenant="acme" />;
}
const { ReadOnlyBanner } = await import("../src/shell/Shell.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");

const slots = {
  panelContextEl: null, inspectorEl: null, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
  inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
};

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  Object.assign(state, FRESH);
  asked.length = 0;
});

async function page() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots as never}>
          <MemoryRouter initialEntries={["/t/acme/plan"]}>
            <Routes>
              <Route path="/t/:tenant/plan" element={<PlanPage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && host.textContent?.includes("Loading"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  // The plans, with whom to write to, arrive beside the organization's limits.
  await act(() => new Promise((r) => setTimeout(r, 10)));
  return host;
}

const rows = (host: HTMLElement, sheet: string) =>
  [...(host.querySelector(`[aria-labelledby="${sheet}"]`)?.querySelectorAll(".limits-allowance") ?? [])].map((li) => li.textContent);

const INTERNALS = ["WHATBUILD_", "rate_limited", "quota_exceeded", "Memory for reading", "Limits of this deployment"];

describe("Plan, for someone who reads only the Story in the organization", () => {
  const TOTALS = ["41 of 50", "2 of 2", "Everyone in Acme", "What it holds", "Today"];

  it("says it isn't shown, without asking the server or drawing anything of the organization", async () => {
    state.storyOnly = true;
    const host = await page();
    expect(host.querySelector("h2")?.textContent).toContain("Plan");
    expect(host.textContent).toContain("The plan isn’t shown to Story readers");
    expect(host.textContent).toContain("An admin of one of its products can give you more access.");
    for (const words of TOTALS) expect(host.textContent, words).not.toContain(words);
    expect(asked.filter((p) => p.endsWith("/limits"))).toEqual([]);
  });

  it("says the same when the server refuses them", async () => {
    state.refused = true;
    const host = await page();
    expect(host.textContent).toContain("The plan isn’t shown to Story readers");
    for (const words of TOTALS) expect(host.textContent, words).not.toContain(words);
  });

  it("still shows the plan to anyone who reads more", async () => {
    const host = await page();
    expect(host.textContent).not.toContain("isn’t shown");
    expect(rows(host, "holds-title").join(" ")).toContain("41 of 50");
  });

  async function banner() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = () => act(() => root.unmount());
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <ReadOnlyBanner tenant={{ name: "Acme", slug: "acme" }} readOnly={{ since: "2026-10-01T00:00:00.000Z", kept_until: "2027-10-01T00:00:00.000Z" }} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(() => new Promise((r) => setTimeout(r, 10)));
    return host;
  }

  it("says a read-only organization is read-only, with no way to a plan they can't see", async () => {
    state.storyOnly = true;
    const host = await banner();
    expect(host.textContent).toContain("Acme is read-only");
    expect(host.querySelector('a[href="/?settings=organization/plan"]')).toBeNull();
  });

  it("offers the plan from that banner to anyone who reads more", async () => {
    const host = await banner();
    expect(host.querySelector('a[href="/?settings=organization/plan"]')?.textContent).toBe("See plan");
  });
});

describe("Plan", () => {
  it("tells a person on the free plan what the organization holds, what they used today, and how to move to another plan, in words", async () => {
    const host = await page();
    const text = host.textContent ?? "";
    expect(host.querySelector(".plan-word")?.textContent).toBe("Free");
    expect(text).toContain("Everyone in Acme meets its limits, owners and their agents included.");
    expect(text).toContain("To move Acme to another plan, ask whoever runs this WhatBuild.");
    expect(text).toContain("Acme’s name and plan, and the name and email of everyone in it, are visible to whoever runs this WhatBuild");
    // A total that is reached says so, one that is nearly reached says so, and storage says what frees it.
    expect(rows(host, "holds-title")).toEqual([
      "PeopleStory readers don’t count.2 of 2Full",
      "ProductsArchived ones count. Deleting one makes room.1 of 1Full",
      "SourcesArchived ones count. Deleting one makes room.41 of 50Nearly full",
      "Storage30 MB of files (attachments, the text read from each, kept as a file of its own, and prototypes), 4 MB of text. Archiving keeps it; deleting frees it.34 MB of 200 MB",
    ]);
    const groups = [...host.querySelectorAll(".limits-group")].map((g) => ({ title: g.querySelector("h3")?.textContent, rows: [...g.querySelectorAll("li")].map((li) => li.querySelector(".limits-allowance-name")?.textContent + "|" + li.querySelector(".limits-allowance-count")?.textContent) }));
    expect(groups).toEqual([
      { title: "You", rows: ["Changes|12 of 150", "Sources added|10 of 10Full", "Files uploaded|2.5 MB of 25 MB", "Data sent to you|0 MB of 300 MB", "Exports|0 of 3"] },
      { title: "Everyone in Acme", rows: ["Changes|40 of 300"] },
    ]);
    // The plan's file size is lower than the deployment's and the relay's, so it is the one that applies.
    expect(text).toContain("Files up to 10 MB each.");
    expect(text).toContain("Up to 50 attachments on a source.");
    // The plans side by side, this one marked.
    expect(host.querySelector('.plans-head[aria-current="true"]')?.textContent).toContain("Free");
    expect(text).toContain("$10 a month");
    for (const internal of INTERNALS) expect(text).not.toContain(internal);
  });

  it("names whom to write to about another plan when the deployment names someone", async () => {
    state.contact = "plans@example.com";
    const host = await page();
    expect(host.textContent).toContain("To move Acme to another plan, write to plans@example.com.");
    expect(host.querySelector('a[href="mailto:plans@example.com"]')).not.toBeNull();
  });

  it("gives a member of an unlimited organization what it holds, with no limit, and no day's allowances", async () => {
    Object.assign(state, { plan: "unlimited", meets: false });
    const host = await page();
    const text = host.textContent ?? "";
    // It says what Unlimited lifts and what each product still keeps, never that it has no limits.
    expect(text).toContain(
      "Acme is Unlimited. No limit on what people and their agents do, nor on how many mockups and Story pages a product holds; each product’s Playbook keeps to 2,000 files and 32 MB, and each mockup and Story page keeps its newest 10 versions.",
    );
    expect(text).not.toContain("has no limits");
    expect(rows(host, "holds-title")[0]).toBe("PeopleStory readers don’t count.2 · no limit");
    expect(host.querySelector('[aria-labelledby="today-title"]')).toBeNull();
    expect(text).toContain("Files up to 25 MB each.");
    // The deployment reads less of a file than it takes.
    expect(text).toContain("Text is read from files up to 20 MB; a larger file is kept but not read.");
    for (const internal of INTERNALS) expect(text).not.toContain(internal);
  });

  it("says what an organization on a plan nobody defines any longer still keeps, never that no limit applies", async () => {
    Object.assign(state, { plan: "gold", meets: false });
    const host = await page();
    const text = host.textContent ?? "";
    expect(text).toContain(
      "Acme is on a plan this WhatBuild no longer defines, so it meets the Unlimited plan’s limits until whoever runs it moves Acme to another. No limit on what people and their agents do, nor on how many mockups and Story pages a product holds; each product’s Playbook keeps to 2,000 files and 32 MB, and each mockup and Story page keeps its newest 10 versions.",
    );
    expect(text).not.toContain("no limit applies");
  });

  it("gives a guest of the example organization no holdings and no allowances", async () => {
    state.meets = "calls_per_minute_only";
    const host = await page();
    const text = host.textContent ?? "";
    expect(text).toContain("You can read it but not change it");
    expect(host.querySelector('[aria-labelledby="holds-title"]')).toBeNull();
    for (const internal of [...INTERNALS, "Files up to"]) expect(text).not.toContain(internal);
  });

  it("shows whoever runs WhatBuild the same Plan as everyone, with no way to change it and none of the internals", async () => {
    state.instanceOwner = true;
    const host = await page();
    const text = host.textContent ?? "";
    expect(host.querySelector(".plan-word")?.textContent).toBe("Free");
    expect(text).not.toContain("Change plan");
    expect(host.querySelector('a[href*="/admin"]')).toBeNull();
    for (const internal of INTERNALS) expect(text).not.toContain(internal);
  });

  it("gives whoever runs WhatBuild every limit with its refusal, and what sets the deployment's, in Instance admin", async () => {
    state.instanceOwner = true;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = () => act(() => root.unmount());
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={["/admin/plans"]}>
            <InstanceLimitsSheets />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    for (let i = 0; i < 20 && !host.textContent?.includes("Limits of"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
    const text = host.textContent ?? "";
    expect(text).toContain("Limits of the Free plan");
    expect(host.querySelector(".limits-lead")?.textContent).toBe("Read through Acme, one of your organizations, which is on the Free plan. Used is counted in Acme.");
    // The line says whose figures the table holds, and a screen reader hears it with the table.
    expect(host.querySelector("table")?.getAttribute("aria-describedby")).toBe("every-limit-lead");
    expect(host.querySelector("#every-limit-lead")?.classList.contains("limits-lead")).toBe(true);
    expect(text).toContain("429 rate_limited");
    expect(text).toContain("Limits of this deployment");
    expect(text).toContain("WHATBUILD_PARSE_MEMORY_MB");
    expect([...host.querySelectorAll("th[role=columnheader]")].map((th) => th.textContent)).toContain("Used");
  });
  it("names, on Unlimited, the organization and plan the limits are read through, and says only what a product holds is limited", async () => {
    state.plan = "unlimited";
    const host = await admin(<InstanceLimitsSheets />, "/admin/plans");
    const title = host.querySelector("#every-limit-title")?.textContent ?? "";
    expect(title).toContain("Limits of the Unlimited plan");
    expect(title).not.toContain("this plan");
    expect(host.querySelector(".limits-lead")?.textContent).toBe(
      "Read through Acme, one of your organizations, which is on the Unlimited plan. Used is counted in Acme. No limit on what people and their agents do, nor on how many mockups and Story pages a product holds; each product’s Playbook keeps to 2,000 files and 32 MB, and each mockup and Story page keeps its newest 10 versions.",
    );
    expectLineAgreesWithRows(host);
  });

  it("names, on a plan the deployment no longer defines, the plan the organization is on and the Unlimited limits it meets", async () => {
    state.plan = "gold";
    const host = await admin(<InstanceLimitsSheets />, "/admin/plans");
    expect(host.querySelector("#every-limit-title")?.textContent).toContain("Limits of the Unlimited plan");
    const lead = host.querySelector(".limits-lead")?.textContent ?? "";
    expect(lead).toContain(
      "Read through Acme, one of your organizations, which is on the gold plan. This WhatBuild no longer defines that plan, so Acme meets the Unlimited plan’s limits until it is moved.",
    );
    expectLineAgreesWithRows(host);
    expect(host.querySelector(".limits-scroll")?.textContent).not.toContain("No limit");
  });
});

/**
 * Where no plan's limits apply, the line under Instance admin's every-limit table says what is lifted
 * and what is kept with the numbers its own rows allow: the Playbook's and versions' limits as numbers,
 * mockups and Story pages as None.
 */
function expectLineAgreesWithRows(host: HTMLElement) {
  const lead = host.querySelector(".limits-lead")?.textContent ?? "";
  expect(allowedText(host, "Mockups")).toBe("None");
  expect(allowedText(host, "Story pages")).toBe("None");
  expect(lead).toContain("nor on how many mockups and Story pages a product holds");
  expect(allowedText(host, "Playbook files")).toBe("2,000");
  expect(lead).toContain("Playbook keeps to 2,000 files and 32 MB");
  expect(allowedText(host, "Versions of a mockup")).toBe("10");
  expect(lead).toContain("keeps its newest 10 versions");
}

/** What the every-limit table's row of a limit allows, as it reads. */
function allowedText(host: HTMLElement, label: string) {
  const row = [...host.querySelectorAll(".limits-scroll tr[role=row]")].find((r) => r.querySelector("[role=rowheader]")?.textContent === label);
  return row?.querySelector("td[data-label=Allowed]")?.textContent;
}

/** One of Instance admin's sheets, signed in as an owner of this WhatBuild, at an address. */
async function admin(sheet: ReactNode, at: string) {
  state.instanceOwner = true;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>{sheet}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && host.textContent?.includes("Loading"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  await act(() => new Promise((r) => setTimeout(r, 10)));
  return host;
}

describe("Instance admin's plans", () => {
  it("says, in an organization's choice of plan, what Unlimited lifts and what it keeps", async () => {
    const host = await admin(<InstanceOrganizationsSheet />, "/admin/organizations?org=acme");
    const choice = [...host.querySelectorAll("dialog label")].find((l) => l.textContent?.startsWith("Unlimited"));
    expect(choice?.textContent).toContain(
      "No limit on what people and their agents do, nor on how many mockups and Story pages a product holds; each product’s Playbook keeps to 2,000 files and 32 MB, and each mockup and Story page keeps its newest 10 versions. For this WhatBuild’s own organizations; never offered.",
    );
    expect(host.querySelector("dialog")?.textContent).not.toContain("No limits.");
  });

  it("names each No limit checkbox in a plan's limits by the limit it lifts", async () => {
    const host = await admin(<InstancePlansSheet />, "/admin/plans");
    const edit = host.querySelector<HTMLButtonElement>('button[aria-label="Edit the Pro plan"]');
    expect(edit).not.toBeNull();
    await act(async () => edit!.click());
    const names = [...host.querySelectorAll<HTMLInputElement>("dialog .limits-nolimit input[type=checkbox]")].map((c) => c.getAttribute("aria-label"));
    expect(names).toContain("Products: no limit");
    expect(names).toContain("Sources: no limit");
    // Every row's is its own, so a screen reader tells them apart.
    expect(new Set(names).size).toBe(names.length);
    // Pro sets no limit on products, so its checkbox is ticked; sources have one.
    const box = (name: string) => host.querySelector<HTMLInputElement>(`dialog input[aria-label="${name}"]`);
    expect(box("Products: no limit")?.checked).toBe(true);
    expect(box("Sources: no limit")?.checked).toBe(false);
  });

  it("names each limit's field by what it is counted over, keeping Story's capital", async () => {
    state.extraInfo = [{ key: "story_page_versions_max", group: "total", label: "Versions of a Story page", unit: "versions", per: "Each Story page", refusal: "none: the oldest is deleted", help: "", min: 1 }];
    const host = await admin(<InstancePlansSheet />, "/admin/plans");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Edit the Pro plan"]')!.click());
    expect(host.querySelector('dialog input[aria-label="Versions of a Story page, each Story page"]')).not.toBeNull();
    expect(host.querySelector('dialog input[aria-label="Sources, each person, each day"]')).not.toBeNull();
  });

  it("brings back the number a field had when No limit is ticked and unticked, never the least allowed", async () => {
    state.extraInfo = [{ key: "story_page_versions_max", group: "total", label: "Versions of a Story page", unit: "versions", per: "Each Story page", refusal: "none: the oldest is deleted", help: "", min: 1 }];
    state.proDefaults = { ...PRO, products_max: 3 };
    const host = await admin(<InstancePlansSheet />, "/admin/plans");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Edit the Pro plan"]')!.click());
    const box = (name: string) => host.querySelector<HTMLInputElement>(`dialog input[aria-label="${name}"]`)!;
    const field = (name: string) => host.querySelector<HTMLInputElement>(`dialog input[aria-label="${name}"]`)!;
    // Pro keeps 2,000 sources: ticked and unticked, it keeps 2,000, not 0.
    await act(async () => box("Sources: no limit").click());
    expect(field("Sources, each person, each day").disabled).toBe(true);
    await act(async () => box("Sources: no limit").click());
    expect(field("Sources, each person, each day").value).toBe("2000");
    // Nothing changed, so there is nothing to save.
    expect([...host.querySelectorAll<HTMLButtonElement>("dialog button")].find((b) => b.textContent === "Save")?.disabled).toBe(true);
    // A field that opened at no limit gets what the configuration sets for the plan.
    await act(async () => box("Products: no limit").click());
    expect(field("Products, each person, each day").value).toBe("3");
    // And where it sets none on what a product holds, what every product keeps by default: 10
    // versions, never the least allowed (1), which would delete versions for good at the next publish.
    await act(async () => box("Versions of a Story page: no limit").click());
    expect(field("Versions of a Story page, each Story page").value).toBe("10");
  });
});

describe("the plans, where the deployment offers none", () => {
  it("says what each product still keeps, never that there are no limits at all", async () => {
    state.offered = false;
    const host = await admin(<PlansPage />, "/plans");
    expect(host.textContent).toContain(
      "This WhatBuild offers no plans: every organization here meets only the limits the deployment sets for all, and each product’s Playbook keeps to 2,000 files and 32 MB, and each mockup and Story page keeps its newest 10 versions.",
    );
  });
});

describe("the plans side by side", () => {
  it("never says a plan takes a larger file than the deployment can, in every limit either", async () => {
    const { PlanComparison } = await import("../src/routes/plan-comparison.tsx");
    const file = { key: "file_max_bytes", group: "size", label: "File size", unit: "bytes", per: "Each file", refusal: "413 too_large", help: "" };
    const limits = { file_max_bytes: 100 * MB };
    const html = renderToStaticMarkup(
      <PlanComparison plans={[{ id: "pro", name: "Pro", about: "", price: null, limits }]} limits={[file] as never} fileMaxBytes={25 * MB} every="open" />,
    );
    expect(html).toContain("25 MB");
    expect(html).not.toContain("100 MB");
  });
});

describe("what an organization holds, in a line", () => {
  it("says its people leave out Story readers, as its plan does and its People in Settings doesn't", async () => {
    const { heldLine } = await import("../src/routes/limits.tsx");
    const line = heldLine({ members: 4, invited: 1, products: 2, sources: 3, storage: { files: 0, text: 0, total: 0 } });
    expect(line).toMatch(/^4 people besides Story readers \(\+1 invited\) · 2 products · 3 sources · /);
  });
});
