import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// A guest waiting for the example, for whom one of the day's places is open, follows Start your
// own organization from the waiting page to Welcome and starts their organization there. They are
// no guest from then on, so their new product opens, not the waiting page they came from.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
  started: false,
  calls: [] as { method: string; path: string }[],
};

const me = () => ({
  signed_in: true,
  account_id: "a",
  email: "maya@example.com",
  display_name: "Maya Patel",
  tenant_allowance: state.started
    ? { instance_owner: false, allowed: 1, created: 1, remaining: 0, source: "given" }
    : { instance_owner: false, allowed: 0, created: 0, remaining: 0, source: "default" },
  new_organization_plan: "free",
  hide_example: false,
  asked_for_organization_at: null,
  guest: !state.started,
  place_open: !state.started,
});

const example = { tenant_id: "x", slug: "example", name: "Example", example: true };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string) => {
    state.calls.push({ method, path });
    if (path === "/auth/session") return me();
    if (path === "/api/v1/me/guest-pass") return state.started ? { guest: false, status: "in" } : { guest: true, status: "waiting", reason: "full", position: 1, in_now: 1 };
    if (path.startsWith("/api/v1/me/products")) return { items: [], tenants: state.started ? [example, { tenant_id: "m", slug: "maya-studio", name: "Maya's studio" }] : [example] };
    if (path === "/api/v1/me/invitations") return { items: [] };
    if (path === "/api/v1/plans") return { plans: [], starting_plan: "unlimited", limits: [], file_max_bytes: 0, contact: null };
    if (method === "POST" && path === "/api/v1/tenants") {
      state.started = true;
      return { tenant: { slug: "maya-studio" } };
    }
    if (method === "POST" && path === "/api/v1/tenants/maya-studio/products") return { path: "maya-studio/fieldnote" };
    return {};
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useSignOut: () => async () => {},
}));

const { GuestGate } = await import("../src/shell/guest-gate.tsx");
const { Welcome } = await import("../src/routes/org.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  Object.assign(state, { started: false, calls: [] });
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("starting an organization from the guests' waiting page", () => {
  it("opens the new product, not the waiting page, once the organization is started", async () => {
    const router = createMemoryRouter(
      [
        {
          element: (
            <GuestGate>
              <Outlet />
            </GuestGate>
          ),
          children: [
            { path: "/", element: <p>the example</p> },
            { path: "/welcome", element: <Welcome /> },
            { path: "/t/:tenant/:product/idea", element: <p>the product</p> },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    unmount = () => act(() => root.unmount());
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
    });
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("WhatBuild is full right now");

    const link = [...host.querySelectorAll("a")].find((a) => a.textContent?.includes("Start your own organization"));
    expect(link?.getAttribute("href")).toBe("/welcome");
    await act(async () => link!.click());
    await settle();
    expect(router.state.location.pathname).toBe("/welcome");
    const form = host.querySelector("form") as HTMLFormElement;
    const [organization, product] = [...form.querySelectorAll("input")] as HTMLInputElement[];
    await type(organization!, "Maya's studio");
    await type(product!, "Fieldnote");
    await act(async () => (form.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    await settle();

    expect(router.state.location.pathname).toBe("/t/maya-studio/fieldnote/idea");
    expect(host.textContent).toBe("the product");
    expect(host.textContent).not.toContain("WhatBuild is full right now");
  });
});
