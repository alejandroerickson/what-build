import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// An organization someone isn't in answers its Members and its Plan and limits as one that doesn't
// exist: the server's 404, asked once, shown at once as the screen a product they can't see shows,
// titled for itself rather than for the screen it stands in for.

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
      if (path.startsWith("/api/v1/tenants/elsewhere/")) throw new real.ApiError(404, "not_found", HIDDEN);
      throw new Error(`unexpected request ${path}`);
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
const { MembersPage } = await import("../src/routes/org.tsx");
const { LimitsPage } = await import("../src/routes/limits.tsx");
const { plainSection } = await import("../src/shell/Shell.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");

let title: string | null = null;
const slots = {
  panelContextEl: null, inspectorEl: null, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
  inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: (t: string | null) => void (title = t), focus: false, setFocus: () => {},
};

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  calls.length = 0;
  title = null;
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
              <Route path="/t/:tenant/members" element={<MembersPage />} />
              <Route path="/t/:tenant/limits" element={<LimitsPage />} />
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
  for (const [screen, path, request] of [
    ["Members", "/t/elsewhere/members", "/api/v1/tenants/elsewhere/members"],
    ["Plan and limits", "/t/elsewhere/limits", "/api/v1/tenants/elsewhere/limits"],
  ] as const) {
    it(`answers its ${screen} as one that doesn't exist, asking once`, async () => {
      const host = await open(path);
      expect(host.querySelector("h1")?.textContent).toBe("This organization doesn’t exist, or you can’t see it");
      expect(host.textContent).toContain("To see it, ask one of its admins for a role.");
      expect(host.textContent).not.toContain("tenant");
      expect(host.textContent).not.toContain("Roles in the organization");
      expect(calls.filter((c) => c === request)).toHaveLength(1);
      expect(title).toBe("Organization not found");
    });
  }

  it("is never named for the screen it stands in for", () => {
    expect(plainSection("/t/elsewhere/members")).toBe("members");
    expect(plainSection("/t/elsewhere/limits/")).toBe("limits");
    // A product that didn't open, and an address the app doesn't know, are in no section.
    expect(plainSection("/t/elsewhere/team/product")).toBe("");
    expect(plainSection("/t/elsewhere/team/product/idea")).toBe("");
    expect(plainSection("/t/elsewhere/whatever")).toBe("");
    expect(plainSection("/connect/whatever")).toBe("");
    expect(plainSection("/connect")).toBe("connect");
    expect(plainSection("/")).toBe("home");
  });
});
