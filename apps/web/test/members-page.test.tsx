import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import { ToastProvider } from "../src/ui/index.tsx";

// An organization's Members page offers only what the server would do: a team or product role can
// be changed where it is shown, the dialog for someone's only role says what each choice does, Give
// access forgets a refusal once the choice changes, and a read-only organization offers no new role.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute("open");
};
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;

const state = { readOnly: false, refuseGrant: false };
const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];

const tenant = () => ({
  tenant_id: "t1", slug: "acme", name: "Acme", name_etag: "e1", plan: "free", your_role: "owner",
  ...(state.readOnly ? { read_only: { since: "2026-10-26T10:00:00.000Z", kept_until: "2027-10-26T10:00:00.000Z" } } : {}),
  teams: [{ team_id: "team1", slug: "core", name: "Core", your_role: "owner" }],
});
const members = () => ({
  members: [
    { account_id: "a1", display_name: "Olive Owner", email: "olive@example.com", grants: [{ membership_id: "m1", scope_type: "tenant", scope_id: "t1", scope: { name: "Acme", slug: "acme" }, role: "owner", since: "" }] },
    { account_id: "a2", display_name: "Pat Editor", email: "pat@example.com", grants: [{ membership_id: "m2", scope_type: "product", scope_id: "p1", scope: { name: "Planner", slug: "planner" }, role: "editor", since: "" }] },
  ],
  invitations: [],
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
    calls.push({ method, path, ...(body ? { body } : {}) });
    if (path === "/auth/session") return { signed_in: true, account_id: "a1", email: "olive@example.com", display_name: "Olive Owner" };
    if (path.startsWith("/api/v1/me/products"))
      return { items: [{ product_id: "p1", path: "acme/core/planner", name: "Planner", tenant: { tenant_id: "t1", slug: "acme", name: "Acme" }, team: { team_id: "team1", slug: "core", name: "Core" }, your_role: "admin" }], tenants: [tenant()] };
    if (path.includes("/members/activity")) return { items: [], next_cursor: null };
    if (method === "GET" && path === "/api/v1/tenants/acme/members") return members();
    if (method === "POST" && path === "/api/v1/tenants/acme/members" && state.refuseGrant)
      throw new ApiError(409, "quota_exceeded", "A limit was reached: Acme has 2 people, all its plan allows.");
    return {};
  }),
}));

const { MembersPage } = await import("../src/routes/org.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  calls.length = 0;
  Object.assign(state, { readOnly: false, refuseGrant: false });
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
          <MemoryRouter initialEntries={["/t/acme/members"]}>
            <Routes>
              <Route path="/t/:tenant/members" element={<MembersPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && !host.textContent?.includes("Pat Editor"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

const buttons = (root: ParentNode, label: string) => [...root.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const settle = () => act(() => new Promise((r) => setTimeout(r, 10)));

describe("the Members page", () => {
  it("changes a product role from the role's own menu, and offers removing it there", async () => {
    const host = await page();
    const change = buttons(host, "Change or remove Pat Editor’s editor role on Planner")[0]!;
    await act(async () => change.click());
    const menu = document.querySelector('[role="menu"]')!;
    expect([...menu.querySelectorAll('[role="menuitemradio"]')].map((r) => r.textContent)).toEqual([
      expect.stringContaining("Admin"), expect.stringContaining("Editor"), expect.stringContaining("Viewer"), expect.stringContaining("Reader"),
    ]);
    expect(menu.textContent).toContain("Remove role");
    const viewer = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((r) => r.textContent?.startsWith("Viewer"))!;
    await act(async () => viewer.click());
    await settle();
    expect(calls).toContainEqual({ method: "POST", path: "/api/v1/tenants/acme/members", body: { email: "pat@example.com", role: "viewer", product: "p1" } });
  });

  it("asks before removing someone's only role, offering to keep them as a member or to remove them, without saying both happen", async () => {
    const host = await page();
    await act(async () => buttons(host, "Change or remove Pat Editor’s editor role on Planner")[0]!.click());
    const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((r) => r.textContent?.includes("Remove role"))!;
    await act(async () => remove.click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Remove Pat Editor’s only role?");
    expect(dialog.textContent).toContain("Editor on Planner is Pat Editor’s only role here. Keep them in Acme as a member");
    expect(dialog.textContent).not.toContain("so removing it removes them from the organization");
    expect(buttons(dialog, "Remove role, keep as member")).toHaveLength(1);
    expect(buttons(dialog, "Remove from organization")).toHaveLength(1);
  });

  it("forgets Give access's refusal as soon as the choice changes", async () => {
    state.refuseGrant = true;
    const host = await page();
    await act(async () => buttons(host, "Give access")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    const email = dialog.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "new@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttons(dialog, "Give access")[0]!.click());
    await settle();
    expect(dialog.textContent).toContain("A limit was reached");
    const role = [...dialog.querySelectorAll("select")].at(-1)!;
    await act(async () => {
      role.value = "reader";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dialog.textContent).not.toContain("A limit was reached");
  });

  it("says a read-only organization is read-only, and offers only what still works there", async () => {
    state.readOnly = true;
    const host = await page();
    expect(host.textContent).toContain("Acme is read-only");
    expect(host.textContent).toContain("Nobody can be given access or a new role while it is. Everyone in it can still read, export and delete what it holds, and take people out, as their roles allow.");
    expect(buttons(host, "Give access")).toHaveLength(0);
    expect(buttons(host, "Change or remove Pat Editor’s editor role on Planner")).toHaveLength(0);
    // Taking a role away still works there.
    expect(buttons(host, "Remove Pat Editor’s editor role on Planner")).toHaveLength(1);
    expect(host.textContent).toContain("It’s read-only, so these can’t be changed until it moves to another plan.");
    await act(async () => buttons(host, "Remove Pat Editor’s editor role on Planner")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("so removing it removes them from the organization");
    expect(buttons(dialog, "Remove role, keep as member")).toHaveLength(0);
  });
});
