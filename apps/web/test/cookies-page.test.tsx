import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The cookie notice is the one place the analytics choice is made. The Cookies page says where the
// choice stands, and once there is one, Change brings the notice back to make it again there.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => (path === "/auth/methods" ? { analytics_id: "G-TEST000" } : {})),
}));

const { CookiesPage } = await import("../src/routes/cookies.tsx");
const { CookieNotice } = await import("../src/shell/CookieNotice.tsx");

const setChoice = (v: string | null) => {
  document.cookie = v ? `wb_cookies=${v}; path=/` : "wb_cookies=; path=/; max-age=0";
};

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  setChoice(null);
});

const settle = (ms = 20) => act(() => new Promise((r) => setTimeout(r, ms)));

async function show() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/cookies"]}>
          <CookiesPage />
          <CookieNotice />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const analytics = (host: HTMLElement) => host.querySelector('[aria-labelledby="cookies-analytics"]')!;
const notice = (host: HTMLElement) => host.querySelector<HTMLElement>("aside.cookie-notice");
const named = (root: Element, name: string) => [...root.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name);

describe("the Cookies page", () => {
  it("says who sees the server's counts as the rest of the page speaks: as us", async () => {
    const counting = (await show()).querySelector('[aria-labelledby="cookies-counting"]')!.textContent ?? "";
    expect(counting).toContain("and we see only totals.");
    expect(counting).not.toContain("whoever runs");
  });

  it("before a choice: says so, and leaves the choice to the notice", async () => {
    const host = await show();
    expect(analytics(host).querySelector(".entry-caption")?.textContent).toBe("Not chosen yet");
    expect(named(analytics(host), "Change the analytics choice")).toBeUndefined();
    // Decline and Accept are the notice's, not the page's.
    expect([...analytics(host).querySelectorAll("button")]).toEqual([]);
    expect(named(notice(host)!, "Decline")).toBeTruthy();
    expect(named(notice(host)!, "Accept")).toBeTruthy();
  });

  it.each([
    ["declined", "Declined"],
    ["accepted", "Accepted"],
  ])("once %s: says so, and Change brings the notice back to choose again", async (choice, word) => {
    setChoice(choice);
    const host = await show();
    expect(analytics(host).querySelector(".entry-caption")?.textContent).toBe(word);
    expect(notice(host)).toBeNull();
    const change = named(analytics(host), "Change the analytics choice")!;
    change.focus();
    await act(async () => change.click());
    await settle();
    expect(notice(host)).toBeTruthy();
    expect(document.activeElement).toBe(notice(host));
    const other = choice === "declined" ? "Accept" : "Decline";
    await act(async () => named(notice(host)!, other)!.click());
    await settle(50);
    expect(analytics(host).querySelector(".entry-caption")?.textContent).toBe(other === "Accept" ? "Accepted" : "Declined");
    expect(notice(host)).toBeNull();
    expect(document.activeElement).toBe(named(analytics(host), "Change the analytics choice"));
  });
});
