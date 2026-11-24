import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Instance admin → Guests: each switch is named by the setting it turns on, and whether it is on is
// the checkbox's own state, so assistive technology reads "Anyone can sign up as a guest, checkbox,
// not checked" rather than "Off, checkbox".

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/api/v1/guests")
      return {
        settings: { self_serve: false, organizations_per_day: 0, at_once: 10 },
        defaults: { self_serve: false, organizations_per_day: 0, at_once: 10 },
        fields: [
          { key: "self_serve", label: "Anyone can sign up as a guest", unit: "switch", help: "" },
          { key: "organizations_per_day", label: "New organizations a day", unit: "calls", help: "" },
          { key: "at_once", label: "Guests at once", unit: "guests", help: "" },
        ],
        etag: null,
        updated_at: null,
        updated_by: null,
        now: { in_now: 0, waiting: 0, new_today: 0, ever: 0 },
        open_without_allowlist: false,
      };
    return {};
  }),
}));

const { InstanceGuestsSheet } = await import("../src/routes/limits.tsx");
const { ToastProvider } = await import("../src/ui/index.tsx");

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function page() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter>
            <InstanceGuestsSheet />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && !host.querySelector('input[type="checkbox"]'); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

/** A control's accessible name as a screen reader computes it here: its aria-label, else its label's text. */
const nameOf = (input: HTMLInputElement) => input.getAttribute("aria-label") ?? input.closest("label")?.textContent?.trim() ?? "";

describe("the guests' switches", () => {
  it("are named by the setting, with on or off as the checkbox's state", async () => {
    const host = await page();
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(nameOf(box)).toBe("Anyone can sign up as a guest");
    expect(box.checked).toBe(false);
    expect(box.closest("label")?.querySelector('[aria-hidden="true"]')?.textContent).toBe("Off");
    await act(async () => box.click());
    expect(box.checked).toBe(true);
    expect(nameOf(box)).toBe("Anyone can sign up as a guest");
  });
});
