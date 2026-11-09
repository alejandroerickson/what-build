import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// An organization someone isn't in answers its own address, and its addresses from before Settings
// (Members, Plan and limits), as one that doesn't exist: the person's own organizations say so, with
// nothing asked of it, shown as the screen a product they can't see shows, titled for itself rather
// than for the screen it stands in for.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HIDDEN = "No such organization is visible to you. It may not exist, or you may not be a member.";
const calls: string[] = [];

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...real,
    api: vi.fn(async (_method: string, path: string) => {
      calls.push(path);
      if (path.startsWith("/api/v1/me/products")) return { items: [], tenants: [] };
      if (path.startsWith("/api/v1/tenants/elsewhere")) throw new real.ApiError(404, "not_found", HIDDEN);
      // The shell around the screen: no agents, no invitations.
      if (path.startsWith("/api/v1/me/")) return { items: [] };
      return {};
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useMe: () => ({ isPending: false, data: { account_id: "a1", tenant_allowance: { instance_owner: false } } }),
}));

// The theme module reads the system's scheme as it loads, and the shell brings it in.
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

const { retryRead } = await import("../src/lib/api.ts");
const { OrganizationHome, OrganizationSettingsAddress } = await import("../src/routes/addresses.tsx");
const { plainSection } = await import("../src/shell/Shell.tsx");
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
  calls.length = 0;
});

/** The screen at the address, with the app's own rule for asking again, once its requests settle. */
async function open(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: retryRead, retryDelay: 1 } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots as never}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/t/:tenant" element={<OrganizationHome />} />
              <Route path="/t/:tenant/members" element={<OrganizationSettingsAddress section="organization/people" />} />
              <Route path="/t/:tenant/limits" element={<OrganizationSettingsAddress section="organization/plan" />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 40 && /Loading/.test(host.textContent ?? ""); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  // Long enough for a retry to have been asked, had there been one.
  await act(() => new Promise((r) => setTimeout(r, 30)));
  return host;
}

describe("an organization someone can't see", () => {
  for (const [screen, path] of [
    ["own address", "/t/elsewhere"],
    ["Members", "/t/elsewhere/members"],
    ["Plan and limits", "/t/elsewhere/limits"],
  ] as const) {
    it(`answers its ${screen} as one that doesn't exist, asking nothing of it`, async () => {
      const host = await open(path);
      expect(host.querySelector("h1")?.textContent).toBe("This organization doesn’t exist, or you can’t see it");
      expect(host.textContent).toContain("To see it, ask one of its admins for a role.");
      expect(host.textContent).not.toContain("tenant");
      expect(host.textContent).not.toContain("Roles in the organization");
      expect(calls.filter((c) => c.startsWith("/api/v1/tenants/elsewhere"))).toHaveLength(0);
      expect(document.title).toBe("Organization not found · WhatBuild");
    });
  }

  it("is never named for the screen it stands in for", () => {
    // An address the app doesn't know, a product that didn't open, an organization's own: no section.
    expect(plainSection("/t/elsewhere/members")).toBe("");
    expect(plainSection("/t/elsewhere/product")).toBe("");
    expect(plainSection("/t/elsewhere/product/idea")).toBe("");
    expect(plainSection("/connect/whatever")).toBe("");
    expect(plainSection("/_system")).toBe("_system");
    expect(plainSection("/")).toBe("home");
  });
});
