import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// A guest account comes into WhatBuild while there is room, and otherwise waits on a page that says
// where they stand; anyone in an organization goes straight through.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
  guest: true,
  pass: { guest: true, status: "in", minutes_left: 100 } as Record<string, unknown>,
  asked: 0,
  remaining: undefined as number | undefined,
  waitlisted: null as string | null,
  invitations: [] as unknown[],
};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => (path === "/api/v1/me/invitations" ? { items: state.invitations } : (state.asked++, state.pass))),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useMe: () => ({
    isPending: false,
    data: { guest: state.guest, email: "gus@example.com", tenant_allowance: { instance_owner: false, remaining: state.remaining }, asked_for_organization_at: state.waitlisted },
  }),
  useSignOut: () => async () => {},
}));

const { GuestGate } = await import("../src/shell/guest-gate.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  Object.assign(state, { guest: true, pass: { guest: true, status: "in", minutes_left: 100 }, asked: 0, remaining: undefined, waitlisted: null, invitations: [] });
});

async function gate() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/"]}>
          <GuestGate>
            <p>the app</p>
          </GuestGate>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && host.textContent?.includes("Finding you a place"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

describe("the guest gate", () => {
  it("lets someone in an organization straight through, without asking for a place", async () => {
    state.guest = false;
    expect((await gate()).textContent).toBe("the app");
    expect(state.asked).toBe(0);
  });

  it("shows a guest the app while they are in", async () => {
    expect((await gate()).textContent).toBe("the app");
  });

  it("shows a guest who must wait where they stand in line, and how to keep their place", async () => {
    state.pass = { guest: true, status: "waiting", reason: "full", position: 3, in_now: 25, retry_after_seconds: 20 };
    const host = await gate();
    const text = host.textContent ?? "";
    expect(text).toContain("WhatBuild is full right now");
    expect(text).toContain("Number 3 in line");
    expect(host.querySelector(".waiting p")?.textContent).toBe("Try again within two minutes to keep your place.");
    expect(text).not.toMatch(/guests are exploring|example organization/);
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Try again");
    expect(text).not.toContain("the app");
  });

  it("shows a waiting guest the invitations waiting for them, since accepting one ends the wait", async () => {
    state.pass = { guest: true, status: "waiting", reason: "full", position: 3, in_now: 25 };
    state.invitations = [{ invitation_id: "i", tenant: { slug: "acme", name: "Acme Labs" }, scope_type: "product", scope: "Research", role: "editor", invited_by: "Riley Chen", invited_by_email: "riley@example.com", expires_at: "2026-11-07T12:00:00.000Z" }];
    const host = await gate();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(host.textContent).toContain("WhatBuild is full right now");
    expect(host.textContent).toContain("Join Acme Labs?");
    expect(host.textContent).toContain("Riley Chen (riley@example.com) invited you as an editor on Research.");
    expect(host.querySelector(`[aria-label='Accept the invitation to Acme Labs']`)).toBeTruthy();
  });

  it("offers a waiting guest the waitlist, and once they are on it says so, with the address they'll hear at", async () => {
    state.pass = { guest: true, status: "waiting", reason: "full", position: 2, in_now: 25 };
    state.remaining = 0;
    const host = await gate();
    expect(host.textContent).not.toContain("open a few at a time");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Start your own organization");
    unmount?.();
    state.waitlisted = "2026-10-26T15:00:00.000Z";
    const text = (await gate()).textContent ?? "";
    expect(text).toContain("Your organization is on its way. We’ll email gus@example.com as soon as it’s ready.");
    expect(text).not.toContain("Start your own organization");
  });

  it("tells a new guest past today's places when they open again in the title and badge alone", async () => {
    state.pass = { guest: true, status: "waiting", reason: "new_today", resets_at: new Date(Date.now() + 5 * 3600_000).toISOString() };
    const host = await gate();
    const text = host.textContent ?? "";
    expect(text).toContain("Today’s places for new guests are taken");
    expect(text).toContain("Opens again in 5 h");
    expect(host.querySelector(".waiting > p")).toBeNull();
    // Nothing changes before midnight, so there is nothing to try again.
    expect(text).not.toContain("Try again");
  });

  it("tells a guest who has used today's time when it starts again in the title and badge alone", async () => {
    state.pass = { guest: true, status: "waiting", reason: "time_today", resets_at: new Date(Date.now() + 2 * 3600_000).toISOString() };
    const host = await gate();
    const text = host.textContent ?? "";
    expect(text).toContain("You’ve used today’s time");
    expect(text).toContain("Back in 2 h");
    expect(host.querySelector(".waiting > p")).toBeNull();
    expect(text).not.toContain("Try again");
  });
});
