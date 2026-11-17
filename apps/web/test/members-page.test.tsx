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

const state = { readOnly: false, refuseGrant: false, guest: false, role: "owner", allProducts: false, onlyOwner: false, invited: false, roomFor: 0, self: "a1", sessionPending: false, patInOrg: false, partial: false, refuseFromCall: 0, limit: 2, used: 2, otherRefusal: false, noAnswer: false };
const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
/** The calls that add people refused before this many have been made: the later calls of a long list. */
const grantCalls = () => calls.filter((c) => c.method === "POST" && c.path === "/api/v1/tenants/acme/members/many").length;

const tenant = () => ({
  tenant_id: "t1", slug: "acme", name: "Acme", name_etag: "e1", plan: "free", your_role: state.role,
  ...(state.readOnly ? { read_only: { since: "2026-10-26T10:00:00.000Z", kept_until: "2027-10-26T10:00:00.000Z" } } : {}),
});
const members = () => state.guest ? { members: [], invitations: [], guest: true } : ({
  members: [
    { account_id: "a1", display_name: "Olive Owner", email: "olive@example.com", grants: [{ membership_id: "m1", scope_type: "tenant", scope_id: "t1", scope: { name: "Acme", slug: "acme" }, role: "owner", since: "" }] },
    ...(state.onlyOwner
      ? []
      : [{
          account_id: "a2", display_name: "Pat Editor", email: "pat@example.com",
          grants: [
            ...(state.patInOrg ? [{ membership_id: "m5", scope_type: "tenant", scope_id: "t1", scope: { name: "Acme", slug: "acme" }, role: "member", since: "" }] : []),
            { membership_id: "m2", scope_type: "product", scope_id: "p1", scope: { name: "Planner", slug: "planner" }, role: "editor", since: "" },
          ],
        }]),
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
  ...(state.partial ? { partial: true } : {}),
  invitations: state.invited ? [{ invitation_id: "i1", email: "ivy@example.com", scope_type: "product", scope_id: "p1", scope: { name: "Planner" }, role: "editor", expires_at: "2026-11-20T00:00:00.000Z" }] : [],
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
    calls.push({ method, path, ...(body ? { body } : {}) });
    if (path === "/auth/session") return state.sessionPending ? new Promise(() => {}) : { signed_in: true, account_id: state.self, email: "olive@example.com", display_name: "Olive Owner" };
    if (path.startsWith("/api/v1/me/products"))
      return { items: [{ product_id: "p1", path: "acme/planner", name: "Planner", tenant: { tenant_id: "t1", slug: "acme", name: "Acme" }, your_role: "admin" }], tenants: [tenant()] };
    if (path.includes("/members/activity")) return { items: [], next_cursor: null };
    if (method === "GET" && path === "/api/v1/tenants/acme/members") return members();
    if (method === "POST" && path === "/api/v1/tenants/acme/members/many" && state.refuseGrant && grantCalls() > state.refuseFromCall && state.noAnswer)
      throw new ApiError(0, "network", "WhatBuild couldn’t be reached. Check your connection and try again.");
    if (method === "POST" && path === "/api/v1/tenants/acme/members/many" && state.refuseGrant && grantCalls() > state.refuseFromCall && state.otherRefusal)
      throw new ApiError(422, "invalid_role", `${(body!.people as { email: string }[])[state.roomFor]!.email}: Role owner doesn’t apply to all products; use admin, editor, viewer, story_reader. Nothing was changed.`, { email: (body!.people as { email: string }[])[state.roomFor]!.email });
    if (method === "POST" && path === "/api/v1/tenants/acme/members/many" && state.refuseGrant && grantCalls() > state.refuseFromCall)
      throw new ApiError(409, "quota_exceeded", "This organization's plan allows 2 people, and it has 2. Story readers don't count: invite someone who reads only the Story as a Story reader (story_reader).", {
        quota: "members_max", limit: state.limit, used: state.used, unit: "people", email: (body!.people as { email: string }[])[state.roomFor]!.email, room_for: state.roomFor,
      });
    if (path === "/api/v1/plans") return { plans: [{ id: "free", name: "Free", about: "", price: null, limits: {} }], starting_plan: "free", limits: [], file_max_bytes: 0, contact: null };
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
  Object.assign(state, { readOnly: false, refuseGrant: false, guest: false, role: "owner", allProducts: false, onlyOwner: false, invited: false, roomFor: 0, self: "a1", sessionPending: false, patInOrg: false, partial: false, refuseFromCall: 0, limit: 2, used: 2, otherRefusal: false, noAnswer: false });
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
  for (let i = 0; i < 20 && !host.textContent?.includes(state.onlyOwner ? "Olive Owner" : "Pat Editor") && !host.textContent?.includes("example organization"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
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
      expect.stringContaining("Admin"), expect.stringContaining("Editor"), expect.stringContaining("Viewer"), expect.stringContaining("Story reader"),
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
      reader.value = "story_reader";
      reader.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => buttons(dialog, "Add 1 person to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 2 people")[0]!.click());
    await settle();
    expect(calls.filter((c) => c.path.endsWith("/members/many"))).toEqual([
      {
        method: "POST",
        path: "/api/v1/tenants/acme/members/many",
        body: { all_products: true, people: [{ email: "ana@example.com", role: "story_reader" }, { email: "pat@example.com", role: "editor" }] },
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
    expect(joinAs(dialog)).toEqual(["Admin", "Editor", "Viewer", "Story reader"]);
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

  it("says a plan's people limit in the app's own words, and forgets it as soon as the choice changes", async () => {
    state.refuseGrant = true;
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, "new@example.com");
    await act(async () => buttons(dialog, "Add 1 person to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 1 person")[0]!.click());
    await settle();
    const callout = [...dialog.querySelectorAll(".callout")].find((c) => c.textContent?.includes("plan holds"))!;
    expect(callout.querySelector(".callout-title")?.textContent).toBe("Acme’s Free plan holds 2 people");
    // Nobody is invited, so there's no invitation to cancel; Pat could be removed.
    expect(callout.querySelector(".callout-text")?.textContent).toBe("No places are left for new@example.com. Remove someone. Story readers don’t count. Compare plans");
    expect(callout.querySelector("a")?.getAttribute("href")).toBe("/plans");
    expect(callout.querySelector("a")?.getAttribute("target")).toBe("_blank");
    // The refusal's own words are for agents.
    expect(dialog.textContent).not.toContain("story_reader");
    const role = dialog.querySelector<HTMLSelectElement>('select[aria-label="Role for new@example.com"]')!;
    await act(async () => {
      role.value = "story_reader";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dialog.textContent).not.toContain("plan holds");
  });

  it("says how many places are left when some of the addresses fit, and offers only the ways to make room that exist", async () => {
    Object.assign(state, { refuseGrant: true, onlyOwner: true, roomFor: 1 });
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    await type(dialog.querySelector("textarea")!, "ana@example.com, ben@example.com");
    await act(async () => buttons(dialog, "Add 2 people to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 2 people")[0]!.click());
    await settle();
    const callout = [...dialog.querySelectorAll(".callout")].find((c) => c.textContent?.includes("plan holds"))!;
    // Only the owner is in Acme and nobody is invited: neither cancelling nor removing is offered.
    expect(callout.querySelector(".callout-text")?.textContent).toBe("Nothing was saved. There’s room for 1 more person. Add fewer people. Story readers don’t count. Compare plans");
  });

  it("offers cancelling an invitation only when one is open", async () => {
    Object.assign(state, { refuseGrant: true, onlyOwner: true, invited: true });
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    await type(dialog.querySelector("textarea")!, "new@example.com");
    await act(async () => buttons(dialog, "Add 1 person to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 1 person")[0]!.click());
    await settle();
    const callout = [...dialog.querySelectorAll(".callout")].find((c) => c.textContent?.includes("plan holds"))!;
    expect(callout.querySelector(".callout-text")?.textContent).toBe("No places are left for new@example.com. Cancel an invitation. Story readers don’t count. Compare plans");
  });

  /** Adds one address to all products, refused by the plan's total, and gives the words that say so. */
  async function refusedFor(address: string, place?: string) {
    state.refuseGrant = true;
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    if (place) await choose(placeSelect(dialog), place);
    if (buttons(dialog, "Paste addresses")[0]) await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, address);
    await act(async () => [...dialog.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Add 1 person to"))!.click());
    await act(async () => buttons(dialog, "Add 1 person")[0]!.click());
    await settle();
    return [...dialog.querySelectorAll(".callout")].find((c) => c.textContent?.includes("plan holds"))?.querySelector(".callout-text")?.textContent;
  }

  it("offers removing someone only where the person adding can take every counted role of theirs off", async () => {
    // An organization admin can't remove its owner, the only other person in it.
    Object.assign(state, { onlyOwner: true, role: "admin", self: "a9" });
    expect(await refusedFor("new@example.com")).toBe("No places are left for new@example.com. Story readers don’t count. Compare plans");
  });

  it("doesn't offer removing someone to a product admin, whose list leaves out roles on other products", async () => {
    // A product admin sees part of the organization: its owner, whom they can't remove, and Pat, whose role in the organization they can't take off.
    Object.assign(state, { role: "member", self: "a9", partial: true, patInOrg: true });
    expect(await refusedFor("new@example.com", "product:p1")).toBe("No places are left for new@example.com. Story readers don’t count. Compare plans");
    unmount?.();
    document.body.innerHTML = "";
    // Pat's one listed role is on the product they administer, but Pat may hold one on a product they can't open.
    Object.assign(state, { patInOrg: false });
    expect(await refusedFor("new@example.com", "product:p1")).toBe("No places are left for new@example.com. Story readers don’t count. Compare plans");
  });

  it("doesn't offer removing someone before it knows who is adding", async () => {
    state.sessionPending = true;
    expect(await refusedFor("new@example.com")).toBe("No places are left for new@example.com. Story readers don’t count. Compare plans");
  });

  it("says what a long list's earlier calls saved when a later one is refused, counting room from the first address", async () => {
    // 106 addresses go in two calls: the first 100 are saved, and the plan refuses the 6th of the second call.
    // Pat, first, is counted already; the 5 before the refused one each take a place.
    const fresh = Array.from({ length: 105 }, (_, i) => `n${String(i).padStart(3, "0")}@example.com`);
    Object.assign(state, { refuseGrant: true, refuseFromCall: 1, roomFor: 5, limit: 107, used: 107 });
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, ["pat@example.com", ...fresh].join("\n"));
    await act(async () => buttons(dialog, "Add 106 people to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 106 people")[0]!.click());
    await settle();
    const sent = calls.filter((c) => c.path === "/api/v1/tenants/acme/members/many").map((c) => (c.body!.people as unknown[]).length);
    expect(sent).toEqual([100, 6]);
    const callout = [...dialog.querySelectorAll(".callout")].find((c) => c.textContent?.includes("plan holds"))!;
    expect(callout.querySelector(".callout-text")?.textContent).toBe(
      "The first 100 addresses are saved and off the list, and none after them. There’s room for 5 more people. Add fewer people or remove someone. Story readers don’t count. Compare plans",
    );
  });

  /** Adds Pat and 105 new addresses to all products in two calls, the second refused, and gives the dialog. */
  async function refusedAfterTheFirstCall() {
    const fresh = Array.from({ length: 105 }, (_, i) => `n${String(i).padStart(3, "0")}@example.com`);
    Object.assign(state, { refuseGrant: true, refuseFromCall: 1, roomFor: 5, limit: 107, used: 107 });
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, ["pat@example.com", ...fresh].join("\n"));
    await act(async () => buttons(dialog, "Add 106 people to all products")[0]!.click());
    await act(async () => buttons(dialog, "Add 106 people")[0]!.click());
    await settle();
    return dialog;
  }
  const membersReads = () => calls.filter((c) => c.method === "GET" && c.path === "/api/v1/tenants/acme/members").length;
  /** Who the dialog's right-hand list shows: those to add, then those already there. */
  const listed = (dialog: ParentNode) => [...dialog.querySelectorAll('.pe-list[role="group"] li')].map((li) => li.querySelector(".pe-name")?.textContent);

  it("takes what a long list's earlier calls saved off the list, keeps their invitation links, and sends only the rest again", async () => {
    const dialog = await refusedAfterTheFirstCall();
    // The first call's 100 are saved: they leave the list, and the people list is read again to show them.
    expect(listed(dialog)).toEqual(["n099@example.com", "n100@example.com", "n101@example.com", "n102@example.com", "n103@example.com", "n104@example.com", "Olive Owner"]);
    expect(dialog.querySelector(".pe-summary")?.textContent).toBe("6 people to add.");
    expect(buttons(dialog, "Add 6 people")).toHaveLength(1);
    // Something is saved, so the foot no longer offers to cancel.
    expect(buttons(dialog, "Cancel")).toHaveLength(0);
    expect([...dialog.querySelectorAll(".dialog-foot button")].map((b) => b.textContent?.trim())).toContain("Close");
    expect(membersReads()).toBe(2);
    // The 99 invitations the first call made can be copied.
    expect(dialog.querySelector(".pe-links")?.querySelectorAll("li")).toHaveLength(99);
    expect(dialog.textContent).toContain("99 invitations created");
    // Saved again, with room now, only the 6 not saved go.
    state.refuseGrant = false;
    await act(async () => buttons(dialog, "Add 6 people")[0]!.click());
    await settle();
    const sent = calls.filter((c) => c.path === "/api/v1/tenants/acme/members/many").map((c) => (c.body!.people as { email: string }[]).map((p) => p.email));
    expect(sent.map((x) => x.length)).toEqual([100, 6, 6]);
    expect(sent[2]).toEqual(["n099@example.com", "n100@example.com", "n101@example.com", "n102@example.com", "n103@example.com", "n104@example.com"]);
    const made = document.querySelector("dialog[open]")!;
    expect(made.querySelector(".callout-title")?.textContent).toBe("105 invitations created");
    expect(made.querySelector(".pe-links")?.querySelectorAll("li")).toHaveLength(105);
  });

  it("says what earlier calls saved when a later one is refused for something other than the plan", async () => {
    state.otherRefusal = true;
    const dialog = await refusedAfterTheFirstCall();
    const callout = [...dialog.querySelectorAll(".callout")].find((c) => c.textContent?.includes("didn’t work"))!;
    expect(callout.querySelector(".callout-text")?.textContent).toBe(
      "The first 100 addresses are saved and off the list, and none after them. n104@example.com: Role owner doesn’t apply to all products; use admin, editor, viewer, story_reader.",
    );
    expect(listed(dialog)).toHaveLength(7);
  });

  it("doesn't say the rest went unsaved when a later call got no answer", async () => {
    state.noAnswer = true;
    const dialog = await refusedAfterTheFirstCall();
    const callout = [...dialog.querySelectorAll(".callout")].find((c) => c.textContent?.includes("couldn’t be reached"))!;
    expect(callout.querySelector(".callout-text")?.textContent).toBe(
      "The first 100 addresses are saved and off the list. WhatBuild couldn’t be reached. Check your connection and try again.",
    );
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe("The first 100 addresses are saved and off the list.");
    expect(listed(dialog)).toHaveLength(7);
  });

  it("says what is waiting by the button's own words, and one invitation as one", async () => {
    const host = await page();
    await act(async () => buttons(host, "Add people")[0]!.click());
    const dialog = document.querySelector("dialog[open]")!;
    await act(async () => buttons(dialog, "Paste addresses")[0]!.click());
    await type(dialog.querySelector("textarea")!, "ana@example.com");
    await act(async () => buttons(dialog, "Add 1 person to all products")[0]!.click());
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe("Moved 1 person across as editor. Nothing changes until you choose Add 1 person.");
    expect(buttons(dialog, "Add 1 person")).toHaveLength(1);
    await act(async () => buttons(dialog, "Add 1 person")[0]!.click());
    await settle();
    const made = document.querySelector("dialog[open]")!;
    expect(made.querySelector(".callout-title")?.textContent).toBe("Invitation created");
    expect(made.querySelector(".callout-text")?.textContent).toBe(
      "ana@example.com joins when they accept. We email the invitation where email is set up, and you can share its link yourself: it works once, within 7 days, and only for that address.",
    );
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
