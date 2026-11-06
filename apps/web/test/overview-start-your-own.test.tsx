import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Someone with no organization of their own who may not start one is told, on the overview, to ask
// for one. Once they have asked, the sheet stops telling them to: the line under it says since when
// they are on the waitlist, after the click and after a reload alike.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = { asked: null as string | null, calls: [] as string[] };

const me = () => ({
  signed_in: true,
  account_id: "a",
  email: "ana@example.com",
  display_name: "Ana",
  tenant_allowance: { instance_owner: false, allowed: 0, created: 0, remaining: 0, source: "default" },
  new_organization_plan: "free",
  hide_example: false,
  asked_for_organization_at: state.asked,
});

const example = {
  tenant_id: "t-example",
  slug: "example",
  name: "Example organization",
  name_etag: "e",
  example: true,
  plan: "unlimited",
  your_role: null,
  teams: [{ team_id: "tm", slug: "team", name: "Team", your_role: null }],
};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string) => {
    state.calls.push(`${method} ${path}`);
    if (path === "/auth/session") return me();
    if (path.startsWith("/api/v1/me/products")) return { items: [], tenants: [example] };
    if (method === "POST" && path === "/api/v1/me/ask-for-organization") {
      state.asked = "2026-11-06T10:00:00.000Z";
      return me();
    }
    return {};
  }),
}));

const { OverviewPage } = await import("../src/routes/overview.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  Object.assign(state, { asked: null, calls: [] });
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
        <MemoryRouter initialEntries={["/"]}>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const sheet = (host: HTMLElement) => host.querySelector(".overview-start") as HTMLElement;

describe("Your own organization, for someone who may not start one", () => {
  it("tells them to ask until they have, then no longer does", async () => {
    const host = await show();
    expect(sheet(host).textContent).toContain("ask for yours");
    const ask = [...sheet(host).querySelectorAll("button")].find((b) => b.textContent?.includes("Ask for your own organization"));
    expect(ask).toBeTruthy();
    await act(async () => ask!.click());
    await settle();
    const text = sheet(host).textContent ?? "";
    expect(text).toContain("On the waitlist since");
    expect(text).not.toContain("ask for yours");
    expect(text).toContain("someone who uses WhatBuild can invite you to theirs");
    // The state comes from the account already loaded: asking reads nothing more.
    expect(state.calls.filter((c) => c === "GET /auth/session")).toHaveLength(1);
  });

  it("does not tell them to ask after a reload once they are on the waitlist", async () => {
    state.asked = "2026-11-01T10:00:00.000Z";
    const host = await show();
    const text = sheet(host).textContent ?? "";
    expect(text).toContain("On the waitlist since");
    expect(text).not.toContain("ask for yours");
    expect(sheet(host).querySelector("button")).toBeNull();
  });
});
