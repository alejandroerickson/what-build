import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Delete account is the last section of Settings. Closed, it is one line and one button, and reads
// nothing. Open, it says what deleting will do, then the one step left: what blocks it, signing in
// again, or the typed address and Delete account. Nothing is sent until the address matches.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOON = () => new Date(Date.now() + 10 * 60_000).toISOString();
const IMPACT = {
  email: "dana@example.com",
  display_name: "Dana Editor",
  instance_owner: false,
  organizations: [
    { slug: "owen-co", name: "Owen Co", role: null as string | null, roles: 1, only_owner: false },
    { slug: "shared-co", name: "Shared Co", role: "owner" as string | null, roles: 0, only_owner: false },
  ],
  only_owner_of: [] as { slug: string; name: string }[],
  sessions: 2,
  agents: 0,
  invitations: 1,
  allowance: false,
  signed_in_at: new Date().toISOString(),
  recent_until: SOON() as string | null,
  recent_sign_in_minutes: 15,
  record_mailed: true,
};
const state = { impact: structuredClone(IMPACT), deleteError: null as null | { status: number; code: string; message: string } };
const calls: { method: string; path: string; body?: unknown }[] = [];

vi.mock("../src/lib/api.ts", async (original) => {
  const mod = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...mod,
    api: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (path === "/api/v1/me/delete-impact") return state.impact;
      if (path === "/auth/methods") return { email_link: true, google: true, microsoft: false };
      if (path === "/auth/email") return { sent: true };
      if (path === "/api/v1/me/delete") {
        if (state.deleteError) throw new mod.ApiError(state.deleteError.status, state.deleteError.code, state.deleteError.message);
        return { deleted: true, notice_sent: true };
      }
      throw new Error(`unexpected ${method} ${path}`);
    }),
  };
});

const { DeleteAccount } = await import("../src/routes/delete-account.tsx");

let unmount: (() => void) | null = null;
let at = "";
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  state.impact = structuredClone(IMPACT);
  state.impact.recent_until = SOON();
  state.deleteError = null;
  calls.length = 0;
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
};

function Where() {
  const loc = useLocation();
  at = `${loc.pathname}${loc.search}`;
  return null;
}

async function section(url = "/settings?delete=account") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route
              path="/settings"
              element={
                <>
                  <DeleteAccount />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button, a")].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | HTMLAnchorElement | undefined;
const click = async (el: Element | undefined) => {
  await act(async () => (el as HTMLElement).click());
  await settle();
};

async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Delete account, in Settings", () => {
  it("is closed until asked for, and reads nothing until then", async () => {
    const host = await section("/settings");
    expect(button(host, "Delete account…")?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).toContain("You’ll see what happens before anything is deleted.");
    expect(calls).toEqual([]);
    await click(button(host, "Delete account…"));
    expect(at).toBe("/settings?delete=account");
    expect(document.activeElement?.id).toBe("delete-account-region");
    expect(host.textContent).toContain("If you delete your account:");
  });

  it("says what deleting will do, naming the organizations, and nothing about backups", async () => {
    const text = (await section()).textContent ?? "";
    expect(text).toContain("You’ll be signed out everywhere, and your agents will be disconnected.");
    expect(text).toContain("You’ll lose access to Owen Co and Shared Co, and pending invitations will be cancelled.");
    expect(text).toContain("Your email address and usage data will be deleted.");
    expect(text).toContain("Anything you added to an organization stays there, with your name on it.");
    expect(text).not.toMatch(/backup|Right now|Deleted immediately/i);
  });

  it("sends nothing until the address is typed exactly, then deletes with the confirmation", async () => {
    const host = await section();
    const del = button(host, "Delete account") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    const input = host.querySelector("input") as HTMLInputElement;
    await type(input, "dana@example.org");
    expect(del.disabled).toBe(true);
    await type(input, "Dana@Example.com ");
    expect(del.disabled).toBe(false);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await click(del);
    expect(calls.find((c) => c.path === "/api/v1/me/delete")?.body).toEqual({ email: "Dana@Example.com", confirm: "delete permanently" });
    expect(assign).toHaveBeenCalledWith("/account-deleted?mailed=1");
    vi.unstubAllGlobals();
  });

  it("closes on Cancel, with focus back on its button", async () => {
    const host = await section();
    await click(button(host, "Cancel"));
    expect(at).toBe("/settings");
    expect(document.activeElement?.id).toBe("delete-account-open");
  });

  it("names each organization only this person owns, with both ways out, and offers no confirmation", async () => {
    state.impact.organizations[1]!.only_owner = true;
    state.impact.only_owner_of = [{ slug: "shared-co", name: "Shared Co" }];
    const host = await section();
    expect(host.textContent).toContain("You’re the only owner of Shared Co");
    expect(host.querySelector("input")).toBeNull();
    expect(button(host, "Delete account")).toBeUndefined();
    const links = [...host.querySelectorAll(".farewell-block a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/t/shared-co/members", "/t/shared-co/members#delete-org-title"]);
  });

  it("shows every block at once: owning the instance and being an organization's only owner", async () => {
    state.impact = { ...state.impact, instance_owner: true, only_owner_of: [{ slug: "shared-co", name: "Shared Co" }], organizations: state.impact.organizations.map((o) => ({ ...o, only_owner: o.slug === "shared-co" })) };
    const host = await section();
    const titles = [...host.querySelectorAll(".callout-title")].map((t) => t.textContent);
    expect(titles).toEqual(["You own this WhatBuild", "You’re the only owner of Shared Co"]);
  });

  it("asks a browser that signed in long ago to sign in again, coming back to the open section", async () => {
    state.impact.recent_until = null;
    const host = await section();
    expect(host.textContent).toContain("Sign in again to continue");
    expect(host.querySelector("input")).toBeNull();
    expect(button(host, "Continue with Google")?.getAttribute("href")).toBe("/auth/google?next=%2Fsettings%3Fdelete%3Daccount");
    await click(button(host, "Email me a sign-in link"));
    expect(calls.find((c) => c.path === "/auth/email")?.body).toEqual({ email: "dana@example.com", next: "/settings?delete=account" });
    expect(host.textContent).toContain("Check your email");
  });

  it("says the account wasn't deleted when the server refuses, and moves to signing in again", async () => {
    const host = await section();
    await type(host.querySelector("input") as HTMLInputElement, "dana@example.com");
    state.deleteError = { status: 403, code: "sign_in_again", message: "Sign in again to delete your account. Nothing was changed." };
    state.impact = { ...state.impact, recent_until: null };
    await click(button(host, "Delete account"));
    expect(host.textContent).toContain("Sign in again to continue");
    expect(host.textContent).toContain("Your account wasn’t deleted");
    expect(host.textContent).toContain("Sign in again to delete your account.");
    expect(document.activeElement?.id).toBe("delete-account-step");
  });

  it("says a mistyped address doesn't match once the field is left", async () => {
    const host = await section();
    const input = host.querySelector("input") as HTMLInputElement;
    await type(input, "dana@example.org");
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(host.textContent).toContain("That doesn’t match your email address.");
  });
});
