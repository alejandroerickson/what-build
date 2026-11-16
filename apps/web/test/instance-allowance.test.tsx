import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Instance admin → Starting organizations: the dialog that sets how many organizations someone can
// start says what the number counts as the server counts it, and as the list above it says: the
// organizations they started on the plan new ones start on, not read-only ones, so moving one to
// another plan frees its place.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute("open");
};
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;

const state = { plans: true, plansPending: false };
const by = { display_name: "Olive Owner" };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/auth/session")
      return { signed_in: true, account_id: "a1", email: "olive@example.com", display_name: "Olive Owner", tenant_allowance: { instance_owner: true } };
    if (path === "/api/v1/plans" && state.plansPending) return new Promise(() => {});
    if (path === "/api/v1/plans")
      return state.plans
        ? { plans: [{ id: "free", name: "Free", about: "", price: null, limits: {} }], starting_plan: "free", limits: [], file_max_bytes: 0, contact: null }
        : { plans: [], starting_plan: "unlimited", limits: [], file_max_bytes: 0, contact: null };
    if (path === "/api/v1/tenant-allowances")
      return {
        instance_owners: ["olive@example.com"],
        default_allowed: 0,
        new_organization_plan: state.plans ? "free" : "unlimited",
        items: [{ email: "sam@example.com", allowed: 2, created: 1, remaining: 1, account: { account_id: "a2", display_name: "Sam Lee" }, note: "", etag: "e1", updated_at: "2026-11-10T09:00:00.000Z", updated_by: by }],
        waitlist: [],
      };
    return {};
  }),
}));

const { AdminStarting } = await import("../src/routes/instance.tsx");
const { ToastProvider } = await import("../src/ui/index.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  state.plans = true;
  state.plansPending = false;
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
        <ToastProvider>
          <MemoryRouter initialEntries={["/admin/starting"]}>
            <AdminStarting />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && !host.textContent?.includes("Sam Lee"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

const button = (root: ParentNode, label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;

describe("how many organizations someone can start", () => {
  it("counts what the server counts, as the list says, naming the plan new organizations start on", async () => {
    const host = await page();
    expect(host.textContent).toContain("moving one to another plan frees its place");
    await act(async () => button(host, "Change how many sam@example.com can start").click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("The number counts the Free organizations they’ve started, not read-only ones or ones they’re invited to. Moving one to another plan frees its place.");
    expect(dialog.textContent).not.toContain("every organization they’ve started");
    expect(dialog.textContent).toContain("1 Free organization of theirs counts now. 0 stops them starting more.");
  });

  it("says neither plan sentence while the plans are loading", async () => {
    state.plansPending = true;
    const host = await page();
    expect(host.textContent).not.toContain("Each person listed");
    await act(async () => button(host, "Change how many sam@example.com can start").click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).not.toContain("The number counts");
    expect(dialog.textContent).toContain("1 organization of theirs counts now.");
  });

  it("names no plan where the deployment offers none", async () => {
    state.plans = false;
    const host = await page();
    await act(async () => button(host, "Let someone start organizations").click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("The number counts the organizations they’ve started, not read-only ones or ones they’re invited to.");
    expect(dialog.textContent).not.toContain("another plan");
  });
});
