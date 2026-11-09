import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import { ToastProvider } from "../src/ui/index.tsx";

// An organization's People and General, in Settings, offer only what the server would do: a role on a
// product or on all products can be changed where it is shown, the dialog for someone's only role says
// what each choice does, Add people offers all products, each product and the organization (with its
// product creators) to those who may give them, gives many people roles in one call and forgets a
// refusal once the choice changes, and a read-only organization offers no new role.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute("open");
};
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;

const state = { readOnly: false, refuseGrant: false, guest: false, role: "owner", allProducts: false };
const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];

const tenant = () => ({
  tenant_id: "t1", slug: "acme", name: "Acme", name_etag: "e1", plan: "free", your_role: state.role,
  ...(state.readOnly ? { read_only: { since: "2026-10-26T10:00:00.000Z", kept_until: "2027-10-26T10:00:00.000Z" } } : {}),
});
const members = () => state.guest ? { members: [], invitations: [], guest: true } : ({
  members: [
    { account_id: "a1", display_name: "Olive Owner", email: "olive@example.com", grants: [{ membership_id: "m1", scope_type: "tenant", scope_id: "t1", scope: { name: "Acme", slug: "acme" }, role: "owner", since: "" }] },
    { account_id: "a2", display_name: "Pat Editor", email: "pat@example.com", grants: [{ membership_id: "m2", scope_type: "product", scope_id: "p1", scope: { name: "Planner", slug: "planner" }, role: "editor", since: "" }] },
    ...(state.allProducts
      ? [
          {
            account_id: "a3", display_name: "Vic Viewer", email: "vic@example.com",
            grants: [
              { membership_id: "m3", scope_type: "tenant", scope_id: "t1", scope: { name: "Acme", slug: "acme" }, role: "creator", since: "" },
              { membership_id: "m4", scope_type: "all_products", scope_id: "t1", scope: { name: "All products", slug: "" }, role: "viewer", since: "" },
            ],
          },
        ]
      : []),
  ],
  invitations: [],
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
    calls.push({ method, path, ...(body ? { body } : {}) });
    if (path === "/auth/session") return { signed_in: true, account_id: "a1", email: "olive@example.com", display_name: "Olive Owner" };
    if (path.startsWith("/api/v1/me/products"))
      return { items: [{ product_id: "p1", path: "acme/planner", name: "Planner", tenant: { tenant_id: "t1", slug: "acme", name: "Acme" }, your_role: "admin" }], tenants: [tenant()] };
    if (path.includes("/members/activity")) return { items: [], next_cursor: null };
    if (method === "GET" && path === "/api/v1/tenants/acme/members") return members();
    if (method === "POST" && path === "/api/v1/tenants/acme/members/many" && state.refuseGrant)
      throw new ApiError(409, "quota_exceeded", "A limit was reached: Acme has 2 people, all its plan allows.");
    if (method === "POST" && path === "/api/v1/tenants/acme/members/many")
      return { results: (body!.people as { email: string }[]).map((p) => ({ email: p.email, invited: !p.email.startsWith("pat"), invite_link: "http://localhost/invite/x" })) };
    return {};
  }),
}));

const { OrganizationGeneral, OrganizationPeople } = await import("../src/routes/org.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  calls.length = 0;
  Object.assign(state, { readOnly: false, refuseGrant: false, guest: false, role: "owner", allProducts: false });
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
          <MemoryRouter initialEntries={["/t/acme/planner/idea?settings=organization/people"]}>
            <Routes>
              <Route
                path="/t/:tenant/:product/idea"
                element={
                  <>
                    <OrganizationPeople tenant="acme" />
                    <OrganizationGeneral tenant="acme" />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && !host.textContent?.includes("Pat Editor") && !host.textContent?.includes("example organization"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

const buttons = (root: ParentNode, label: string) => [...root.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const settle = () => act(() => new Promise((r) => setTimeout(r, 10)));
/** Add people's choice of place: the select whose options name the places. */
const placeSelect = (dialog: ParentNode) => [...dialog.querySelectorAll<HTMLSelectElement>("select")].find((x) => [...x.options].some((o) => o.textContent?.startsWith("Product: ")))!;
/** The roles someone joins with, as Join as offers them. */
const joinAs = (dialog: ParentNode) => [...dialog.querySelector<HTMLSelectElement>('select[id$="-join"]')!.options].map((o) => o.textContent);
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function type(field: HTMLTextAreaElement | HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("an organization's People and General", () => {
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

  it("gives people from the organization and pasted addresses their roles in one call", async () => {
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    // On all products, Olive is admin as the organization's owner; Pat, with a product role only, is offered.
    expect(dialog.querySelector('[aria-label="People on all products"]')!.textContent).toContain("Olive Owner");
    const offered = dialog.querySelector('[aria-label="People in Acme not on all products"]')!;
    expect(offered.textContent).toContain("Pat Editor");
    expect(offered.textContent).not.toContain("Olive Owner");
    await act(async () => offered.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => buttons(dialog, "Add 1 person to all products")[0]!.click());
    await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, "Ana Lima <ana@example.com>; pat@example.com, ben@");
    const read = dialog.querySelector('[aria-label="Addresses read"]')!.textContent;
    expect(read).toContain("Ana Lima");
    expect(read).toContain("gets an invitation");
    expect(read).toContain("already moved across");
    expect(dialog.textContent).toContain("Left out, not an address: ben@");
    const reader = dialog.querySelector<HTMLSelectElement>(`select[id$="-join"]`)!;
    await act(async () => {
      reader.value = "reader";
      reader.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => buttons(dialog, "Add 1 person to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 2 people")[0]!.click());
    await settle();
    expect(calls.filter((c) => c.path.endsWith("/members/many"))).toEqual([
      {
        method: "POST",
        path: "/api/v1/tenants/acme/members/many",
        body: { all_products: true, people: [{ email: "ana@example.com", role: "reader" }, { email: "pat@example.com", role: "editor" }] },
      },
    ]);
    // Ana had no account: her invitation's link is there to copy.
    expect(document.querySelector("dialog[open]")!.textContent).toContain("ana@example.com");
    expect(buttons(document, "Copy the invitation link for ana@example.com")).toHaveLength(1);
  });

  it("offers all products, each product and the organization, explaining each, with a product creator among the organization's roles", async () => {
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    const place = placeSelect(dialog);
    expect([...place.options].map((o) => o.textContent)).toEqual(["All products (every product, including ones made later)", "Product: Planner", "Organization: Acme"]);
    expect(dialog.textContent).toContain("Every product in the organization, including ones made later.");
    expect(joinAs(dialog)).toEqual(["Admin", "Editor", "Viewer", "Reader"]);
    await choose(place, [...place.options].find((o) => o.textContent === "Organization: Acme")!.value);
    expect(joinAs(dialog)).toEqual(["Owner", "Admin", "Product creator", "Member"]);
    expect(dialog.textContent).toContain("A product creator creates products, and is admin of each one they create.");
    await choose(dialog.querySelector<HTMLSelectElement>('select[id$="-join"]')!, "creator");
    expect(dialog.querySelector('[id$="-join-hint"]')!.textContent).toBe("Creates products, and is admin of each one they create");
    await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, "new@example.com");
    await act(async () => buttons(dialog, "Add 1 person to Acme")[0]!.click());
    await act(async () => buttons(dialog, "Add 1 person")[0]!.click());
    await settle();
    expect(calls.filter((c) => c.path.endsWith("/members/many"))).toEqual([
      { method: "POST", path: "/api/v1/tenants/acme/members/many", body: { people: [{ email: "new@example.com", role: "creator" }] } },
    ]);
  });

  it("offers a product's admin only the products they administer: all products and the organization are its owners' and admins'", async () => {
    state.role = "member";
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    expect([...placeSelect(dialog).options].map((o) => o.textContent)).toEqual(["Product: Planner"]);
    expect(dialog.querySelector('[aria-label="People on Planner"]')!.textContent).toContain("Pat Editor");
  });

  it("shows a product creator and a role on all products, and changes the role on all products in place", async () => {
    state.allProducts = true;
    const host = await page();
    const row = [...host.querySelectorAll(".members-row")].find((r) => r.textContent?.includes("Vic Viewer"))!;
    expect(row.textContent).toContain("Product creator");
    expect(row.textContent).toContain("Viewer on all products");
    expect(host.textContent).toContain("Creates products, and is admin of each one they create");
    await act(async () => buttons(host, "Change or remove Vic Viewer’s viewer role on all products")[0]!.click());
    const editor = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((r) => r.textContent?.startsWith("Editor"))!;
    await act(async () => editor.click());
    await settle();
    expect(calls).toContainEqual({ method: "POST", path: "/api/v1/tenants/acme/members", body: { email: "vic@example.com", role: "editor", all_products: true } });
    // The organization's roles, a product creator among them, in the person's own menu.
    await act(async () => buttons(host, "Actions for Vic Viewer")[0]!.click());
    const actions = [...document.querySelectorAll('[role="menu"]')].at(-1)!;
    expect([...actions.querySelectorAll('[role="menuitemradio"]')].map((r) => r.textContent)).toEqual([
      expect.stringContaining("Member"), expect.stringContaining("Product creator"), expect.stringContaining("Admin"), expect.stringContaining("Owner"),
    ]);
  });

  it("forgets Add people's refusal as soon as the choice changes", async () => {
    state.refuseGrant = true;
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, "new@example.com");
    await act(async () => buttons(dialog, "Add 1 person to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 1 person")[0]!.click());
    await settle();
    expect(dialog.textContent).toContain("A limit was reached");
    const role = dialog.querySelector<HTMLSelectElement>('select[aria-label="Role for new@example.com"]')!;
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
    expect(buttons(host, "Add people")).toHaveLength(0);
    expect(buttons(host, "Change or remove Pat Editor’s editor role on Planner")).toHaveLength(0);
    // Taking a role away still works there.
    expect(buttons(host, "Remove Pat Editor’s editor role on Planner")).toHaveLength(1);
    expect(host.textContent).toContain("It’s read-only, so these can’t be changed until it moves to another plan.");
    await act(async () => buttons(host, "Remove Pat Editor’s editor role on Planner")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("so removing it removes them from the organization");
    expect(buttons(dialog, "Remove role, keep as member")).toHaveLength(0);
  });

  it("tells a guest of the example organization that its people aren't shown to its guests, naming no other role", async () => {
    state.guest = true;
    const host = await page();
    expect(host.textContent).toContain("Acme is the example organization");
    expect(host.textContent).toContain("Its people aren’t shown to its guests.");
    expect(host.textContent).not.toMatch(/readers?\b/i);
    expect(host.textContent).not.toContain("Pat Editor");
  });
});
