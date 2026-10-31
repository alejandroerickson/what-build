import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Someone joins an organization only by choosing to: opening an invitation's link asks, and the
// invitations waiting for a person show wherever they land, each with Accept and Decline.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invitation = (over: Record<string, unknown> = {}) => ({
  invitation_id: "inv-1",
  tenant: { slug: "acme", name: "Acme Labs" },
  scope_type: "team",
  scope: "Research",
  role: "editor",
  invited_by: '"Riley Chen"',
  expires_at: "2026-11-07T12:00:00.000Z",
  ...over,
});

const state = {
  signedIn: true,
  calls: [] as { method: string; path: string; body: unknown }[],
  answer: (_method: string, _path: string, _body: unknown): unknown => ({}),
};

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (method: string, path: string, body: unknown) => {
    state.calls.push({ method, path, body });
    return state.answer(method, path, body);
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useMe: () => ({ isPending: false, data: state.signedIn ? { email: "lee@example.com", display_name: "Lee" } : undefined }),
  useSignOut: () => async () => {},
}));

const { ApiError } = await import("../src/lib/api.ts");
const { AcceptInvite } = await import("../src/routes/auth.tsx");
const { InvitationsBanner, InvitationsSheet } = await import("../src/shell/invitations.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  Object.assign(state, { signedIn: true, calls: [], answer: () => ({}) });
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

async function show(element: React.ReactNode, at = "/somewhere") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[at]}>
          <Where />
          <Routes>
            <Route path="/invite/:token" element={element} />
            <Route path="*" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const button = (host: HTMLElement, name: RegExp) => [...host.querySelectorAll("button")].find((b) => name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
const press = async (b: HTMLButtonElement | undefined) => {
  expect(b).toBeTruthy();
  await act(async () => b!.click());
  await settle();
};
const sent = (path: string) => state.calls.filter((c) => c.path === path);

describe("an invitation's link", () => {
  const open = (answer: typeof state.answer) => {
    state.answer = answer;
    return show(<AcceptInvite />, "/invite/secret-token");
  };

  it("asks, and opening it answers nothing", async () => {
    const host = await open((_m, path) => (path.endsWith("/read") ? { ...invitation(), accepted: false } : {}));
    expect(host.querySelector("h1")?.textContent).toBe('Join "Acme Labs"?');
    const text = host.textContent ?? "";
    expect(text).toContain('"Riley Chen" invited you as an editor on the "Research" team.');
    expect(text).toContain("add and change");
    expect(text).toContain("You join only if you accept.");
    expect(sent("/api/v1/invitations/read")).toEqual([{ method: "POST", path: "/api/v1/invitations/read", body: { token: "secret-token" } }]);
    expect(sent("/api/v1/invitations/accept")).toEqual([]);
    expect(sent("/api/v1/invitations/decline")).toEqual([]);
    expect(button(host, /^Accept$/)).toBeTruthy();
    expect(button(host, /^Decline$/)).toBeTruthy();
  });

  it("accepts only on being asked to, then opens the overview", async () => {
    const host = await open((_m, path) => (path.endsWith("/read") ? { ...invitation(), accepted: false } : path.endsWith("/accept") ? { accepted: true, already: false, ...invitation() } : { items: [] }));
    await press(button(host, /^Accept$/));
    expect(sent("/api/v1/invitations/accept").map((c) => c.body)).toEqual([{ token: "secret-token" }]);
    expect(host.querySelector('[data-testid="where"]')?.textContent).toBe("/");
  });

  it("declines, stays, and says what the organization sees", async () => {
    const host = await open((_m, path) => (path.endsWith("/read") ? { ...invitation(), accepted: false } : path.endsWith("/decline") ? { declined: true, ...invitation() } : { items: [] }));
    await press(button(host, /^Decline$/));
    expect(sent("/api/v1/invitations/decline").map((c) => c.body)).toEqual([{ token: "secret-token" }]);
    expect(sent("/api/v1/invitations/accept")).toEqual([]);
    expect(host.querySelector("h1")?.textContent).toBe("You declined this invitation");
    expect(host.textContent).toContain("not your name");
    expect(button(host, /^Accept$/)).toBeUndefined();
    expect(host.querySelector('[data-testid="where"]')?.textContent).toBe("/invite/secret-token");
  });

  it("says so when this person has already accepted it", async () => {
    const host = await open(() => ({ ...invitation(), accepted: true }));
    expect(host.querySelector("h1")?.textContent).toBe('You’re already in "Acme Labs"');
    expect(button(host, /^Accept$/)).toBeUndefined();
  });

  it("is for another email: it says so masked, offering to sign in with it, and names nothing else", async () => {
    const host = await open(() => {
      throw new ApiError(403, "invitation_wrong_address", "This invitation was sent to l••••@example.com, and you’re signed in as lee@example.com.", { invited: "l••••@example.com" });
    });
    expect(host.querySelector("h1")?.textContent).toBe("This invitation is for another email");
    expect(host.textContent).toContain("l••••@example.com");
    expect(button(host, /^Sign in with that email$/)).toBeTruthy();
    expect(button(host, /^Accept$/)).toBeUndefined();
  });

  it.each([["invitation_expired"], ["invitation_used"]])("gives no choice once it is %s", async (code) => {
    const host = await open(() => {
      throw new ApiError(410, code, "This invitation can’t be answered now.");
    });
    expect(host.querySelector("h1")?.textContent).toBe("This invitation can’t be used");
    expect(button(host, /^Accept$/)).toBeUndefined();
    expect(button(host, /^Decline$/)).toBeUndefined();
    expect(button(host, /^Sign in with another email$/)).toBeTruthy();
  });

  it("keeps the choice after a failure to reach the server, and takes it away on a refusal", async () => {
    let reachable = false;
    const host = await open((_m, path) => {
      if (path.endsWith("/read")) return { ...invitation(), accepted: false };
      if (!reachable) throw new ApiError(0, "network", "WhatBuild couldn’t be reached.");
      throw new ApiError(410, "invitation_expired", "This invitation expired, was cancelled or was declined.");
    });
    await press(button(host, /^Accept$/));
    expect(host.textContent).toContain("couldn’t be reached");
    expect(button(host, /^Accept$/)).toBeTruthy();
    reachable = true;
    await press(button(host, /^Accept$/));
    expect(host.querySelector("h1")?.textContent).toBe("This invitation can’t be used");
    expect(button(host, /^Accept$/)).toBeUndefined();
  });
});

describe("the invitations waiting for a person", () => {
  const list = (items: unknown[]) => (_m: string, path: string) => (path === "/api/v1/me/invitations" ? { items } : { accepted: true, already: false, declined: true, ...invitation() });

  it("are asked for only once someone is signed in", async () => {
    state.signedIn = false;
    const host = await show(<InvitationsBanner />);
    expect(state.calls).toEqual([]);
    expect(host.querySelector("section")).toBeNull();
  });

  it("show nothing when none wait", async () => {
    state.answer = list([]);
    const banner = await show(<InvitationsBanner />);
    expect(banner.querySelector("section")).toBeNull();
    unmount?.();
    const sheet = await show(<InvitationsSheet />);
    expect(sheet.querySelector("h2")).toBeNull();
  });

  it("each name the organization, the role and who invited them, with Accept and Decline named for it", async () => {
    state.answer = list([invitation({ invitation_id: "a", scope_type: "tenant", scope: "Acme Labs", role: "admin" }), invitation({ invitation_id: "b", tenant: { slug: "b", name: "Beta" }, scope_type: "product", scope: "Planner", role: "reader", invited_by: '"Sam"' })]);
    const host = await show(<InvitationsBanner />);
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("Invitations waiting for your answer");
    const rows = [...host.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('"Riley Chen" invited you as an admin of the organization.');
    expect(rows[1]!.textContent).toContain('"Sam" invited you as a reader on "Planner".');
    expect(button(host, /^Accept the invitation to "Beta"$/)).toBeTruthy();
    expect(button(host, /^Decline the invitation to "Acme Labs"$/)).toBeTruthy();
  });

  it("are answered by their id, and accepting opens the overview", async () => {
    state.answer = list([invitation()]);
    const host = await show(<InvitationsSheet />);
    expect(host.textContent).toContain("Invitations for you");
    await press(button(host, /^Accept the invitation/));
    expect(sent("/api/v1/invitations/accept").map((c) => c.body)).toEqual([{ invitation_id: "inv-1" }]);
    expect(host.querySelector('[data-testid="where"]')?.textContent).toBe("/");
  });

  it("move focus to the next one's Accept once one is declined", async () => {
    let items = [invitation({ invitation_id: "a" }), invitation({ invitation_id: "b", tenant: { slug: "b", name: "Beta" } })];
    state.answer = (_m, path, body) => {
      if (path === "/api/v1/me/invitations") return { items };
      items = items.filter((i) => i.invitation_id !== (body as { invitation_id: string }).invitation_id);
      return { declined: true, ...invitation() };
    };
    const host = await show(<InvitationsBanner />);
    const decline = button(host, /^Decline the invitation to "Acme Labs"$/);
    decline!.focus();
    await press(decline);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(host.querySelectorAll("li")).toHaveLength(1);
    expect(document.activeElement?.getAttribute("aria-label")).toBe('Accept the invitation to "Beta"');
  });

  it("show three, with the rest a press away", async () => {
    state.answer = list(Array.from({ length: 5 }, (_, n) => invitation({ invitation_id: `i${n}`, tenant: { slug: `s${n}`, name: `Org ${n}` } })));
    const host = await show(<InvitationsBanner />);
    expect(host.querySelectorAll("li")).toHaveLength(3);
    await press(button(host, /^Show 2 more invitations$/));
    expect(host.querySelectorAll("li")).toHaveLength(5);
  });

  it("say so when they can't be loaded, and offer to try again", async () => {
    let up = false;
    state.answer = (_m, path) => {
      if (path !== "/api/v1/me/invitations") return {};
      if (!up) throw new ApiError(0, "network", "WhatBuild couldn’t be reached.");
      return { items: [invitation()] };
    };
    const host = await show(<InvitationsBanner />);
    expect(host.textContent).toContain("Your invitations couldn’t be loaded");
    up = true;
    await press(button(host, /^Try again$/));
    expect(host.querySelectorAll("li")).toHaveLength(1);
  });
});
