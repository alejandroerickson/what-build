import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// An organization's Plan and limits says to its people what they can use and add, in words, and
// keeps the refusals, the deployment's internals and what sets them for whoever runs WhatBuild.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;
const FRESH = { instanceOwner: false, plan: "free" as "free" | "unlimited", meets: true as boolean | "calls_per_minute_only", values: {} as Record<string, number | boolean> };
const state = { ...FRESH };

const limit = (key: string, group: string, label: string, unit: string, value: number | boolean, used?: number) => ({
  key, group, label, unit, value: state.values[key] ?? value, free_plan: value, per: "Each person, each day", refusal: key === "requests_per_minute" ? "429 rate_limited" : "409 quota_exceeded", help: "",
  ...(used === undefined || state.meets !== true ? {} : { used }),
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async () => ({
    organization: { slug: "acme", name: "Acme" },
    plan: state.plan,
    plan_name: state.plan === "free" ? "Free" : "Unlimited",
    you_meet_them: state.meets,
    allowances_restart_at: "2026-10-26T00:00:00.000Z",
    limits: [
      limit("requests_per_minute", "frequency", "Calls", "calls", 120),
      limit("writes_per_day", "frequency", "Writes", "writes", 500, 12),
      limit("sources_per_day", "frequency", "Sources added", "sources", 25, 25),
      limit("exports_per_day", "frequency", "Exports", "exports", 0, 0),
      limit("org_writes_per_day", "frequency", "Writes", "writes", 2000, 40),
      limit("file_max_bytes", "size", "File size", "bytes", 10 * MB),
      limit("bytes_per_day", "size", "Uploads", "bytes", 100 * MB, 2.5 * MB),
      limit("fetch_url", "switch", "Fetching a file from a URL", "", false),
    ],
    deployment_limits: [
      { key: "file_max_bytes", label: "File size", value: 100 * MB, unit: "bytes", set_by: "WHATBUILD_FILE_MAX_BYTES" },
      { key: "relay_max_bytes", label: "File size through the upload relay", value: 25 * MB, unit: "bytes", set_by: "WHATBUILD_RELAY_MAX_BYTES" },
      { key: "parse_cap_bytes", label: "Read per attachment", value: 20 * MB, unit: "bytes", set_by: "WHATBUILD_PARSE_CAP_BYTES" },
      { key: "parse_memory_bytes", label: "Memory for reading one attachment", value: 384 * MB, unit: "bytes", set_by: "WHATBUILD_PARSE_MEMORY_MB" },
      { key: "attachments_per_source", label: "Attachments on a source", value: 50, unit: "attachments", set_by: null },
    ],
  })),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useMe: () => ({ isPending: false, data: { tenant_allowance: { instance_owner: state.instanceOwner } } }),
}));

const { LimitsPage } = await import("../src/routes/limits.tsx");
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
  Object.assign(state, FRESH, { values: {} });
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
          <MemoryRouter initialEntries={["/t/acme/limits"]}>
            <Routes>
              <Route path="/t/:tenant/limits" element={<LimitsPage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && host.textContent?.includes("Loading"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

const INTERNALS = ["WHATBUILD_", "rate_limited", "quota_exceeded", "Memory for reading", "Limits of this deployment", "Calls", "120"];

describe("Plan and limits", () => {
  it("tells a person on the free plan what they used today, theirs and everyone's, and what they can add, in words", async () => {
    const host = await page();
    const text = host.textContent ?? "";
    expect(text).toContain("Acme is on the free plan");
    const groups = [...host.querySelectorAll(".limits-group")].map((g) => ({ title: g.querySelector("h3")?.textContent, rows: [...g.querySelectorAll("li")].map((li) => li.textContent) }));
    expect(groups).toEqual([
      { title: "You", rows: ["Changes12 of 500", "Sources added25 of 25, used up", "Files uploaded2.5 MB of 100 MB", "ExportsOff on this plan"] },
      { title: "Everyone in Acme", rows: ["Changes40 of 2,000"] },
    ]);
    // The plan's file size is lower than the deployment's and the relay's, so it is the one that applies.
    expect(text).toContain("Files up to 10 MB each.");
    expect(text).not.toContain("Text is read from files");
    expect(text).toContain("Up to 50 attachments on a source.");
    expect(text).toContain("Adding a file from a link is off on this plan.");
    for (const internal of INTERNALS) expect(text).not.toContain(internal);
  });

  it("says uploading is off when the plan allows no file, rather than a size", async () => {
    state.values = { file_max_bytes: 0 };
    const text = (await page()).textContent ?? "";
    expect(text).toContain("Uploading files is off on this plan.");
    expect(text).not.toContain("Files up to");
    expect(text).not.toContain("attachments on a source");
    expect(text).not.toContain("from a link");
  });

  it("gives a member of an unlimited organization the size the web app takes, which the relay limits", async () => {
    Object.assign(state, { plan: "unlimited", meets: false });
    const text = (await page()).textContent ?? "";
    expect(text).toContain("Acme has no daily allowances");
    expect(text).not.toContain("Today");
    expect(text).toContain("Files up to 25 MB each.");
    // The deployment reads less of a file than it takes.
    expect(text).toContain("Text is read from files up to 20 MB; a larger file is kept but not read.");
    expect(text).not.toContain("Adding a file from a link");
    for (const internal of INTERNALS) expect(text).not.toContain(internal);
  });

  it("gives a guest of the example organization no allowances and no limits", async () => {
    state.meets = "calls_per_minute_only";
    const text = (await page()).textContent ?? "";
    expect(text).toContain("you have no allowances here");
    for (const internal of [...INTERNALS, "Files up to"]) expect(text).not.toContain(internal);
  });

  it("shows whoever runs WhatBuild every limit, its refusal and what sets the deployment's", async () => {
    state.instanceOwner = true;
    const host = await page();
    const text = host.textContent ?? "";
    expect(text).toContain("Change plan and limits");
    expect(text).toContain("Everyone in it meets these limits");
    expect(text).toContain("429 rate_limited");
    expect(text).toContain("Limits of this deployment");
    expect(text).toContain("WHATBUILD_PARSE_MEMORY_MB");
    expect([...host.querySelectorAll("th[role=columnheader]")].map((th) => th.textContent)).toContain("Used today");
  });

  it("leaves out what the instance owner used today where nothing is counted", async () => {
    Object.assign(state, { instanceOwner: true, plan: "unlimited", meets: false });
    const host = await page();
    expect(host.textContent).toContain("Limits on the free plan");
    expect(host.textContent).toContain("Nobody in it meets these limits.");
    expect([...host.querySelectorAll("th[role=columnheader]")].map((th) => th.textContent)).not.toContain("Used today");
    expect(host.textContent).not.toContain("Not a daily limit");
  });
});
