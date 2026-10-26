import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// An organization's Plan and limits says to its people what they can use and add, in words, and
// keeps the refusals, the deployment's internals and what sets them for whoever runs WhatBuild.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;
const state = { instanceOwner: false, meets: true as boolean | "calls_per_minute_only" };

const limit = (key: string, group: string, label: string, unit: string, value: number | boolean, used?: number) => ({
  key, group, label, unit, value, free_plan: value, per: "Each person, each day", refusal: key === "requests_per_minute" ? "429 rate_limited" : "409 quota_exceeded", help: "",
  ...(used === undefined ? {} : { used }),
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async () => ({
    organization: { slug: "acme", name: "Acme" },
    plan: "free",
    plan_name: "Free",
    you_meet_them: state.meets,
    allowances_restart_at: "2026-10-26T00:00:00.000Z",
    limits: [
      limit("requests_per_minute", "frequency", "Calls", "calls", 120),
      limit("writes_per_day", "frequency", "Writes", "writes", 200, state.meets === true ? 12 : undefined),
      limit("exports_per_day", "frequency", "Exports", "exports", 0, state.meets === true ? 0 : undefined),
      limit("file_max_bytes", "size", "File size", "bytes", 10 * MB),
      limit("fetch_url", "switch", "Fetching a file from a URL", "", false),
    ],
    deployment_limits: [
      { key: "file_max_bytes", label: "File size", value: 100 * MB, unit: "bytes", set_by: "WHATBUILD_FILE_MAX_BYTES" },
      { key: "parse_cap_bytes", label: "Read per attachment", value: 25 * MB, unit: "bytes", set_by: "WHATBUILD_PARSE_CAP_BYTES" },
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
  Object.assign(state, { instanceOwner: false, meets: true });
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
  return host.textContent ?? "";
}

describe("Plan and limits", () => {
  it("tells a person on the free plan what they used today and what they can add, in words", async () => {
    const text = await page();
    expect(text).toContain("Acme is on the free plan");
    expect(text).toContain("12 of 200");
    expect(text).toContain("Off on this plan");
    // The plan's file size is lower than the deployment's, so it is the one that applies.
    expect(text).toContain("Files up to 10.0 MB each.");
    expect(text).toContain("Up to 50 attachments on a source.");
    expect(text).toContain("Adding a file from a link is off on this plan.");
    for (const internal of ["WHATBUILD_", "rate_limited", "quota_exceeded", "Memory for reading", "Limits of this deployment", "Calls"]) expect(text).not.toContain(internal);
  });

  it("gives a guest of the example organization no allowances and no limits", async () => {
    state.meets = "calls_per_minute_only";
    const text = await page();
    expect(text).toContain("you have no allowances here");
    for (const internal of ["120", "WHATBUILD_", "rate_limited", "Files up to"]) expect(text).not.toContain(internal);
  });

  it("shows whoever runs WhatBuild every limit, its refusal and what sets the deployment's", async () => {
    state.instanceOwner = true;
    const text = await page();
    expect(text).toContain("Change plan and limits");
    expect(text).toContain("429 rate_limited");
    expect(text).toContain("Limits of this deployment");
    expect(text).toContain("WHATBUILD_PARSE_MEMORY_MB");
  });
});
