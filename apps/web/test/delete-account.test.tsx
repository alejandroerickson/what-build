import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Deleting your own account says what goes and what stays before anything can be confirmed, then
// shows the one step left: what blocks it, signing in again, or the typed address and the button
// that names the act. Nothing is sent until the address matches.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOON = () => new Date(Date.now() + 10 * 60_000).toISOString();
const IMPACT = {
  email: "dana@example.com",
  display_name: "Dana Editor",
  instance_owner: false,
  organizations: [
    { slug: "owen-co", name: "Owen Co", role: null, roles: 1, only_owner: false },
    { slug: "shared-co", name: "Shared Co", role: "owner", roles: 0, only_owner: false },
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

const { DeleteAccountPage } = await import("../src/routes/delete-account.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");

const slots = {
  panelContextEl: null, inspectorEl: null, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
  inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
};

let unmount: (() => void) | null = null;
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

async function page() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots as never}>
          <MemoryRouter initialEntries={["/settings/delete-account"]}>
            <Routes>
              <Route path="/settings/delete-account" element={<DeleteAccountPage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const step = (host: HTMLElement) => host.querySelector("#farewell-step")?.textContent;
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button, a")].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | HTMLAnchorElement | undefined;

async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Delete your account", () => {
  it("says what goes and what stays, with what it means for this person", async () => {
    const text = (await page()).textContent ?? "";
    expect(text).toContain("What goes, at once");
    expect(text).toContain("What stays");
    expect(text).toContain("2 browsers signed in as you now.");
    expect(text).not.toContain("0 agents");
    expect(text).toContain("In Owen Co (a role on a team or product) and Shared Co (owner).");
    expect(text).toContain("1 invitation waiting.");
    expect(text).toContain("within 35 days");
  });

  it("sends nothing until the address is typed exactly, then deletes with the confirmation", async () => {
    const host = await page();
    expect(step(host)).toBe("Confirm with your email address");
    const del = button(host, "Delete my account") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    const input = host.querySelector("input") as HTMLInputElement;
    await type(input, "dana@example.org");
    expect(del.disabled).toBe(true);
    await type(input, "Dana@Example.com ");
    expect(del.disabled).toBe(false);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await act(async () => del.click());
    await settle();
    expect(calls.find((c) => c.path === "/api/v1/me/delete")?.body).toEqual({ email: "Dana@Example.com", confirm: "delete permanently" });
    expect(assign).toHaveBeenCalledWith("/account-deleted?mailed=1");
    vi.unstubAllGlobals();
  });

  it("names each organization only this person owns, with both ways out, and offers no confirmation", async () => {
    state.impact.organizations[1]!.only_owner = true;
    state.impact.only_owner_of = [{ slug: "shared-co", name: "Shared Co" }];
    const host = await page();
    expect(step(host)).toBe("You’re the only owner of Shared Co");
    expect(host.querySelector("input")).toBeNull();
    expect(button(host, "Delete my account")).toBeUndefined();
    const links = [...host.querySelectorAll(".farewell-block a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/t/shared-co/members", "/t/shared-co/members#delete-org-title"]);
  });

  it("says why an owner of the instance can't delete it here", async () => {
    state.impact.instance_owner = true;
    const host = await page();
    expect(step(host)).toBe("You own this WhatBuild");
    expect(host.querySelector("input")).toBeNull();
  });

  it("asks a browser that signed in long ago to sign in again, coming back here", async () => {
    state.impact.recent_until = null;
    state.impact.signed_in_at = new Date(Date.now() - 2 * 3600_000).toISOString();
    const host = await page();
    expect(step(host)).toBe("Sign in again to continue");
    expect(host.querySelector("input")).toBeNull();
    expect(button(host, "Continue with Google")?.getAttribute("href")).toBe("/auth/google?next=%2Fsettings%2Fdelete-account");
    await act(async () => (button(host, "Email me a sign-in link") as HTMLButtonElement).click());
    await settle();
    expect(calls.find((c) => c.path === "/auth/email")?.body).toEqual({ email: "dana@example.com", next: "/settings/delete-account" });
    expect(host.textContent).toContain("Check your email");
  });

  it("moves to signing in again when the server says the sign-in lapsed", async () => {
    const host = await page();
    await type(host.querySelector("input") as HTMLInputElement, "dana@example.com");
    state.deleteError = { status: 403, code: "sign_in_again", message: "To delete your account, sign in again first." };
    state.impact = { ...state.impact, recent_until: null };
    await act(async () => (button(host, "Delete my account") as HTMLButtonElement).click());
    await settle();
    expect(step(host)).toBe("Sign in again to continue");
    // The step that replaced the form says the account is still there, in the server's words, and takes the focus.
    expect(host.textContent).toContain("Your account wasn’t deleted");
    expect(host.textContent).toContain("To delete your account, sign in again first.");
    expect(document.activeElement?.id).toBe("farewell-step");
  });

  it("shows every block at once: owning the instance and being an organization's only owner", async () => {
    state.impact = { ...state.impact, instance_owner: true, only_owner_of: [{ slug: "shared-co", name: "Shared Co" }], organizations: state.impact.organizations.map((o) => ({ ...o, only_owner: o.slug === "shared-co" })) };
    const host = await page();
    const headings = [...host.querySelectorAll("h2.sheet-title")].map((h) => h.textContent);
    expect(headings).toEqual(["You own this WhatBuild", "You’re the only owner of Shared Co"]);
    expect(host.textContent).toContain("Before it can go, your address has to come off this WhatBuild’s owners");
  });

  it("says a mistyped address is not theirs once the field is left", async () => {
    const host = await page();
    const input = host.querySelector("input") as HTMLInputElement;
    await type(input, "dana@example.org");
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(host.textContent).toContain("That isn’t your address. Type dana@example.com.");
  });
});
