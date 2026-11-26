import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Welcome for someone who may not start an organization: in none, it says so and offers to ask for
// one, as Home does; having started all they may, it says whom to write to for another. For someone
// for whom one of the day's places is open it is the form, which takes the place only when they
// press Start organization; and when the last place went just before, it says so plainly and they
// are on the waitlist.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
  asked: null as string | null,
  created: 0,
  allowed: 0,
  orgs: [] as { tenant_id: string; slug: string; name: string; example?: boolean }[],
  invitations: [] as unknown[],
  contact: null as string | null,
  placeOpen: false,
  calls: [] as { method: string; path: string; body?: unknown }[],
};

const me = () => ({
  signed_in: true,
  account_id: "a",
  email: "maya@example.com",
  display_name: "Maya Patel",
  tenant_allowance: { instance_owner: false, allowed: state.allowed, created: state.created, remaining: 0, source: state.allowed ? "given" : "default" },
  new_organization_plan: "free",
  hide_example: false,
  asked_for_organization_at: state.asked,
  place_open: state.placeOpen,
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body?: unknown) => {
    state.calls.push({ method, path, body });
    if (path === "/auth/session") return me();
    if (path.startsWith("/api/v1/me/products")) return { items: [], tenants: state.orgs };
    if (path === "/api/v1/me/invitations") return { items: state.invitations };
    if (path === "/api/v1/plans") return { plans: [], starting_plan: "unlimited", limits: [], file_max_bytes: 0, contact: state.contact };
    if (method === "POST" && path === "/api/v1/me/ask-for-organization") {
      state.asked = "2026-11-06T10:00:00.000Z";
      return me();
    }
    if (method === "POST" && path === "/api/v1/tenants") {
      // Someone else took the last place while the form was open.
      state.placeOpen = false;
      const { ApiError } = await import("../src/lib/api.ts");
      throw new ApiError(409, "places_taken", "The last open place to start an organization was taken just before you, so nothing was started.");
    }
    return {};
  }),
}));

const { Welcome } = await import("../src/routes/org.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  Object.assign(state, { asked: null, created: 0, allowed: 0, orgs: [], invitations: [], contact: null, placeOpen: false, calls: [] });
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

async function show() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/welcome"]}>
          <Welcome />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const body = (host: HTMLElement) => host.querySelector('[aria-labelledby="welcome-title"] .entry-form') as HTMLElement;

async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Welcome, for someone for whom one of the day's places is open", () => {
  it("is the form, and takes nothing until they press Start organization", async () => {
    state.orgs = [{ tenant_id: "x", slug: "example", name: "Example", example: true }];
    state.placeOpen = true;
    const host = await show();
    expect(host.querySelector("h1")?.textContent).toBe("Welcome, Maya");
    expect(body(host).querySelector('button[type="submit"]')?.textContent).toContain("Start organization");
    expect(state.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("says plainly when the last place went before they pressed Start organization, and puts them on the waitlist with the name they typed", async () => {
    state.orgs = [{ tenant_id: "x", slug: "example", name: "Example", example: true }];
    state.placeOpen = true;
    const host = await show();
    const [organization, product] = [...body(host).querySelectorAll("input")] as HTMLInputElement[];
    await type(organization!, "Maya's studio");
    await type(product!, "Fieldnote");
    await act(async () => (body(host).querySelector('button[type="submit"]') as HTMLButtonElement).click());
    await settle();
    expect(state.calls.find((c) => c.path === "/api/v1/me/ask-for-organization")?.body).toEqual({ organization: "Maya's studio" });
    expect(body(host).textContent).toBe("The last open place was taken just before you.Your organization is on its way. We’ll email maya@example.com as soon as it’s ready.");
    expect(body(host).querySelector("form, input")).toBeNull();
  });
});

describe("Welcome, for someone in no organization who may not start one", () => {
  it("says so and offers to ask, then says they are on the waitlist", async () => {
    state.orgs = [{ tenant_id: "x", slug: "example", name: "Example", example: true }];
    const host = await show();
    expect(host.querySelector("h1")?.textContent).toBe("Welcome, Maya");
    expect(body(host).querySelector("p")?.textContent).toBe("You’re not in an organization yet.");
    expect(body(host).textContent).not.toMatch(/owners|invite you/);
    const ask = [...body(host).querySelectorAll("button")].find((b) => b.textContent?.includes("Start your own organization"));
    expect(ask).toBeTruthy();
    await act(async () => ask!.click());
    await settle();
    expect(body(host).textContent).toBe("You’re not in an organization yet.Your organization is on its way. We’ll email maya@example.com as soon as it’s ready.");
  });

  it("says to accept the invitation waiting for them", async () => {
    state.invitations = [{ invitation_id: "i", tenant: { slug: "acme", name: "Acme Labs" }, scope_type: "tenant", scope: null, role: "editor", invited_by: "Riley Chen", invited_by_email: "riley@example.com", expires_at: "2026-11-20T12:00:00.000Z" }];
    const host = await show();
    expect(body(host).querySelector("p")?.textContent).toBe("You’re not in an organization yet. Accept an invitation to join one.");
  });
});

describe("Welcome, for someone who has started all the organizations they may", () => {
  it("says whom to write to for another, where the deployment names someone", async () => {
    state.orgs = [{ tenant_id: "o", slug: "fieldnote", name: "Fieldnote" }];
    Object.assign(state, { allowed: 1, created: 1, contact: "hello@example.com" });
    const host = await show();
    expect(host.querySelector("h1")?.textContent).toBe("You can’t start another organization");
    expect(body(host).textContent).toBe("To start another organization, write to hello@example.com.");
    expect(body(host).querySelector("a")?.getAttribute("href")).toBe("mailto:hello@example.com");
  });

  it("says to ask this WhatBuild's owners where it names nobody", async () => {
    state.orgs = [{ tenant_id: "o", slug: "fieldnote", name: "Fieldnote" }];
    Object.assign(state, { allowed: 1, created: 1 });
    const host = await show();
    expect(body(host).textContent).toBe("To start another organization, ask this WhatBuild’s owners.");
  });
});
