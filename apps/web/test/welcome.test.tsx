import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Welcome for someone who may not start an organization: in none, it says so and offers to ask for
// one, as Home does; having started all they may, it says whom to write to for another.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
  asked: null as string | null,
  created: 0,
  allowed: 0,
  orgs: [] as { tenant_id: string; slug: string; name: string; example?: boolean }[],
  invitations: [] as unknown[],
  contact: null as string | null,
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
});

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string) => {
    if (path === "/auth/session") return me();
    if (path.startsWith("/api/v1/me/products")) return { items: [], tenants: state.orgs };
    if (path === "/api/v1/me/invitations") return { items: state.invitations };
    if (path === "/api/v1/plans") return { plans: [], starting_plan: "unlimited", limits: [], file_max_bytes: 0, contact: state.contact };
    if (method === "POST" && path === "/api/v1/me/ask-for-organization") {
      state.asked = "2026-11-06T10:00:00.000Z";
      return me();
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
  Object.assign(state, { asked: null, created: 0, allowed: 0, orgs: [], invitations: [], contact: null });
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

describe("Welcome, for someone in no organization who may not start one", () => {
  it("says so and offers to ask, then says they are on the waitlist", async () => {
    state.orgs = [{ tenant_id: "x", slug: "example", name: "Example", example: true }];
    const host = await show();
    expect(host.querySelector("h1")?.textContent).toBe("Welcome, Maya");
    expect(body(host).querySelector("p")?.textContent).toBe("You’re not in an organization yet.");
    expect(body(host).textContent).not.toMatch(/owners|invite you/);
    const ask = [...body(host).querySelectorAll("button")].find((b) => b.textContent?.includes("Ask for your own organization"));
    expect(ask).toBeTruthy();
    await act(async () => ask!.click());
    await settle();
    expect(body(host).textContent).toBe("You’re not in an organization yet.You’re on the waitlist. We’ll email maya@example.com when you can start your organization.");
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
