import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Connect an agent leads with the one address every agent can use, `/mcp`, and keeps limiting an
// agent to one organization or product behind a quiet button that gives the scoped address.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

const BASE = "https://app.example.com";
const acme = { tenant_id: "t1", slug: "acme", name: "Acme", example: false };
const example = { tenant_id: "t2", slug: "exemplar", name: "Exemplar", example: true };
const product = (id: string, name: string, path: string, tenant: typeof acme) => ({ product_id: id, name, path, tenant, team: { slug: path.split("/")[1] } });

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/api/v1/connect")
      return { mcp_url: `${BASE}/mcp`, tenant_url_template: `${BASE}/mcp/t/{tenant}`, bound_url_template: `${BASE}/mcp/t/{tenant}/{team}/{product}` };
    if (path === "/api/v1/me/agents") return { items: [] };
    if (path.startsWith("/api/v1/me/products"))
      return { items: [product("p1", "Harvest", "acme/core/harvest", acme), product("p2", "Showcase", "exemplar/core/showcase", example)], tenants: [acme, example] };
    throw new Error(`unexpected ${path}`);
  }),
}));

const { ConnectPage } = await import("../src/routes/connect.tsx");
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
});

async function page(at = "/connect") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ShellContext.Provider value={slots as never}>
          <MemoryRouter initialEntries={[at]}>
            <Routes>
              <Route path="/connect" element={<ConnectPage />} />
              <Route path="/t/:tenant/:team/:product/connect" element={<ConnectPage />} />
            </Routes>
          </MemoryRouter>
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20 && host.textContent?.includes("Loading"); i++) await act(() => new Promise((r) => setTimeout(r, 5)));
  return host;
}

const address = (host: HTMLElement) => host.querySelector(".copy-field code")?.textContent;
const limit = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Limit this agent"))!;
const choice = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((r) => r.closest("label")?.textContent?.includes(label))!;

describe("Connect an agent", () => {
  it("leads with the one address, every product the person can open, and keeps the limits closed", async () => {
    const host = await page();
    expect(address(host)).toBe(`${BASE}/mcp`);
    expect(host.textContent).toContain("Your agent can open every product you can, and reads the example organization without changing it.");
    expect(limit(host).getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll("input[type=radio]")).toHaveLength(0);
    // The three levels, in full, with Edit the default.
    const levels = [...host.querySelectorAll(".agents-level")].map((l) => l.textContent);
    expect(levels).toEqual([
      "Read onlyReads what you can. Changes nothing.",
      "Edit (default)Reads, writes and archives. Never deletes.",
      "AdminAlso deletes permanently, and manages products, organizations and people.",
    ]);
  });

  it("opens on the same address inside a product, and offers that product once the person limits the agent", async () => {
    const host = await page("/t/acme/core/harvest/connect");
    expect(address(host)).toBe(`${BASE}/mcp`);
    await act(async () => limit(host).click());
    expect(limit(host).getAttribute("aria-expanded")).toBe("true");
    expect(choice(host, "Everything you can reach").checked).toBe(true);
    await act(async () => choice(host, "One product").click());
    expect(address(host)).toBe(`${BASE}/mcp/t/acme/core/harvest`);
    expect(host.textContent).toContain("Name the connector after Harvest, so you can tell your connectors apart and turn one off.");
    await act(async () => choice(host, "One organization").click());
    expect(address(host)).toBe(`${BASE}/mcp/t/acme`);
    // Closing the limits goes back to the one address.
    await act(async () => limit(host).click());
    expect(address(host)).toBe(`${BASE}/mcp`);
    expect(host.querySelectorAll("input[type=radio]")).toHaveLength(0);
  });

  it("opens with the limits shown when the address asks for one organization", async () => {
    const host = await page("/connect?reach=organization&org=acme");
    expect(limit(host).getAttribute("aria-expanded")).toBe("true");
    expect(choice(host, "One organization").checked).toBe(true);
    expect(address(host)).toBe(`${BASE}/mcp/t/acme`);
  });
});
