import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// An organization's Plan says to its people what plan it is on, what it holds against the plan's
// totals and what they used today, in words, with the plans side by side. The refusals, the
// deployment's internals and what sets them are for whoever runs WhatBuild.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;
const FRESH = {
  instanceOwner: false,
  plan: "free" as "free" | "pro" | "unlimited",
  meets: true as boolean | "calls_per_minute_only",
  contact: null as string | null,
  holds: { members: 2, invited: 0, products: 1, sources: 41, storage: { files: 30 * MB, text: 4 * MB, total: 34 * MB } },
  /** What the person's list of products says of the organization. */
  storyOnly: false,
  /** The server refuses the person, whatever their list says. */
  refused: false,
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
const held = (key: string) =>
  ({ members_max: state.holds.members + state.holds.invited, products_max: state.holds.products, sources_max: state.holds.sources, storage_max_bytes: state.holds.storage.total })[key];

const plans = () => [
  { id: "free", name: "Free", about: "For trying WhatBuild on one discovery.", price: null, limits: FREE },
  { id: "pro", name: "Pro", about: "For a product team and its discoveries.", price: "$10 a month", limits: PRO },
];

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    asked.push(path);
    if (path === "/api/v1/me/products") return { items: [], tenants: [{ slug: "acme", name: "Acme", plan: state.plan, ...(state.storyOnly ? { story_only: true } : {}) }] };
    if (state.refused && path.endsWith("/limits")) throw new (await original<typeof import("../src/lib/api.ts")>()).ApiError(403, "forbidden", "You read only the Story in Acme.");
    if (path === "/api/v1/plans") return { plans: plans(), starting_plan: "free", limits: info, file_max_bytes: 100 * MB, contact: state.contact };
    const guest = state.meets === "calls_per_minute_only";
    const values = state.plan === "free" ? FREE : state.plan === "pro" ? PRO : null;
    return {
      organization: { slug: "acme", name: "Acme" },
      plan: state.plan,
      plan_name: { free: "Free", pro: "Pro", unlimited: "Unlimited" }[state.plan],
      plan_about: "For trying WhatBuild on one discovery.",
      you_meet_them: state.meets,
      ...(guest ? {} : { holds: state.holds }),
      allowances_restart_at: "2026-10-26T00:00:00.000Z",
      limits: info.map((l) => ({
        ...l,
        value: values ? (values as Record<string, unknown>)[l.key] ?? null : null,
        ...(guest ? {} : held(l.key) !== undefined ? { used: held(l.key) } : used[l.key] !== undefined ? { used: used[l.key] } : {}),
      })),
      plans: plans(),
      deployment_limits: [
        { key: "file_max_bytes", label: "File size", value: 100 * MB, unit: "bytes", set_by: "WHATBUILD_FILE_MAX_BYTES" },
        { key: "relay_max_bytes", label: "File size through the upload relay", value: 25 * MB, unit: "bytes", set_by: "WHATBUILD_RELAY_MAX_BYTES" },
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

const { PlanPage } = await import("../src/routes/limits.tsx");
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
    expect(host.querySelector("h1")?.textContent).toContain("Plan");
    expect(host.textContent).toContain("The plan isn’t shown to Story readers");
    expect(host.textContent).toContain("An admin of one of its products can give you more access.");
    expect(host.querySelector('a[href="/"]')?.textContent).toBe("Go to your products");
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
    expect(host.querySelector('a[href="/t/acme/plan"]')).toBeNull();
  });

  it("offers the plan from that banner to anyone who reads more", async () => {
    const host = await banner();
    expect(host.querySelector('a[href="/t/acme/plan"]')?.textContent).toBe("See plan");
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
      "PeopleReaders of the Story don’t count.2 of 2Full",
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
    expect(text).toContain("Acme has no limits: nobody in it meets any.");
    expect(rows(host, "holds-title")[0]).toBe("PeopleReaders of the Story don’t count.2 · no limit");
    expect(host.querySelector('[aria-labelledby="today-title"]')).toBeNull();
    expect(text).toContain("Files up to 25 MB each.");
    // The deployment reads less of a file than it takes.
    expect(text).toContain("Text is read from files up to 20 MB; a larger file is kept but not read.");
    for (const internal of INTERNALS) expect(text).not.toContain(internal);
  });

  it("gives a guest of the example organization no holdings and no allowances", async () => {
    state.meets = "calls_per_minute_only";
    const host = await page();
    const text = host.textContent ?? "";
    expect(text).toContain("You can read it but not change it");
    expect(host.querySelector('[aria-labelledby="holds-title"]')).toBeNull();
    for (const internal of [...INTERNALS, "Files up to"]) expect(text).not.toContain(internal);
  });

  it("shows whoever runs WhatBuild every limit of the plan, its refusal and what sets the deployment's, and where to change the plan", async () => {
    state.instanceOwner = true;
    const host = await page();
    const text = host.textContent ?? "";
    expect(host.querySelector('a[href="/instance?org=acme"]')?.textContent).toContain("Change plan");
    expect(text).toContain("Limits of the Free plan");
    expect(text).toContain("429 rate_limited");
    expect(text).toContain("Limits of this deployment");
    expect(text).toContain("WHATBUILD_PARSE_MEMORY_MB");
    expect([...host.querySelectorAll("th[role=columnheader]")].map((th) => th.textContent)).toContain("Used");
  });
});
