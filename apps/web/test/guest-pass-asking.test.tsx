import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/lib/api.ts";
import { GuestGate } from "../src/shell/guest-gate.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IN = { guest: true, status: "in", minutes_left: 90, resets_at: "2026-10-29T00:00:00.000Z" };
const FULL = { status: "waiting", reason: "full", position: 2, in_now: 3, retry_after_seconds: 20, resets_at: "2026-10-29T00:00:00.000Z" };

/** What the server answers: the guest's place, as `answer` says it now, and a refusal for any other call while they are not in. */
let answer: Record<string, unknown> = IN;
const asked: string[] = [];

beforeEach(() => {
  answer = IN;
  asked.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    if (url === "/api/v1/me/guest-pass") return Response.json(answer);
    if (answer["status"] !== "in") return Response.json({ error: { code: "guest_waiting", status: 429, message: "Not in.", details: { ...answer } } }, { status: 429 });
    return Response.json({});
  });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let go: (path: string) => void = () => {};
function Screen() {
  go = useNavigate();
  return <p>the example organization</p>;
}

/** Lets answers arrive and the screen follow: React Query tells its observers on a timer of its own. */
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

async function open(): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], { account_id: "a", email: "guest@example.com", display_name: "Guest", guest: true, tenant_allowance: { instance_owner: false, allowed: 0, created: 0, remaining: 0, source: "default" }, asked_for_organization_at: null });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/t/example/discovery"]}>
          <GuestGate>
            <Screen />
          </GuestGate>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const passAsks = () => asked.filter((u) => u === "/api/v1/me/guest-pass").length;

describe("a guest's place in the web app", () => {
  it("is asked about when the app opens and never again on a timer, however long the tab stays open", async () => {
    const host = await open();
    expect(host.textContent).toContain("the example organization");
    expect(passAsks()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    });
    expect(passAsks()).toBe(1);
  });

  it("is asked about again when the guest moves to another screen, once it is a minute old", async () => {
    await open();
    await act(async () => go("/t/example/discovery/evidence"));
    await settle();
    expect(passAsks()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await act(async () => go("/t/example/discovery/story"));
    await settle();
    expect(passAsks()).toBe(2);
  });

  it("gives way to the waiting page when a call is refused, and lets the guest in when they try again and there is room", async () => {
    const host = await open();
    answer = FULL;
    await act(async () => {
      await expect(api("GET", "products")).rejects.toBeInstanceOf(ApiError);
    });
    await settle();
    expect(host.textContent).toContain("WhatBuild is full right now");
    expect(host.textContent).toContain("Number 2 in line");
    expect(passAsks()).toBe(1);

    answer = IN;
    const again = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Try again"))!;
    await act(async () => again.click());
    await settle();
    expect(passAsks()).toBe(2);
    expect(host.textContent).toContain("the example organization");
  });
});
