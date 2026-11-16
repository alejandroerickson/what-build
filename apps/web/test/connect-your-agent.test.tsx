import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Connect your agent: someone who can write in a product and has no agent connected finds the steps
// to connect one at the top of Idea, for the agent they choose, and the empty screens under it say
// where to ask once one is connected. It goes, saying so, when an agent connects.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

const ORIGIN = "https://app.example.com";
const BASE = "/api/v1/p/acme/harvest";
const APP = "/t/acme/harvest";
let agents: unknown[] = [];
let canWrite = true;
const product = { name: "Harvest", path: "acme/harvest", your_role: "editor", concept: "Crews log the day's harvest.", card_chars: 0, etag: "p1", counts: {} };

vi.mock("../src/lib/api.ts", async (original) => ({
  ...(await original<typeof import("../src/lib/api.ts")>()),
  api: vi.fn(async (_method: string, path: string) => {
    if (path === "/api/v1/me/agents") return { items: agents };
    if (path === "/api/v1/connect") return { mcp_url: `${ORIGIN}/mcp`, tenant_url_template: `${ORIGIN}/mcp/t/{tenant}`, bound_url_template: `${ORIGIN}/mcp/t/{tenant}/{product}` };
    if (path.startsWith(`${BASE}/outcomes`)) return { items: [], archived_hidden: 0 };
    if (path.startsWith(`${BASE}/sources`)) return { records: [], next_cursor: null };
    throw new Error(`unexpected ${path}`);
  }),
}));
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: APP, product, canWrite, canDelete: false }),
}));

const { api } = await import("../src/lib/api.ts");
const { IdeaPage } = await import("../src/routes/idea.tsx");
const { FirstUse } = await import("../src/routes/first-use.tsx");
const { ShellContext } = await import("../src/shell/slots.tsx");
const { ToastProvider } = await import("../src/ui/index.tsx");

const panel = document.createElement("div");
const slots = {
  panelContextEl: panel, inspectorEl: null, inspectorId: "inspector", registerPanelContext: () => () => {}, registerInspector: () => () => {},
  inspectorOpen: false, setInspectorOpen: () => {}, inspectorHideLabel: "Hide details", setPageTitle: () => {}, focus: false, setFocus: () => {},
};

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  localStorage.clear();
  agents = [];
  canWrite = true;
});

const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
};

async function mount(ui: React.ReactNode, at = `${APP}/idea`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host, panel);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ShellContext.Provider value={slots as never}>
            <MemoryRouter initialEntries={[at]}>
              <Routes>
                <Route path="*" element={ui} />
              </Routes>
            </MemoryRouter>
          </ShellContext.Provider>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return host;
}

const sheet = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-connect-sheet]");
const agent = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLButtonElement>(".connect-choice button")].find((b) => b.textContent === label)!;
const steps = (host: HTMLElement) => [...host.querySelectorAll(".agents-step-text")].map((p) => p.textContent?.replace(/^Step \d: /, ""));
const copied = (host: HTMLElement) => host.querySelector(".agents-step .copy-field code")?.textContent;
const lead = (host: HTMLElement) => host.querySelector(".first-use-lead")?.textContent;

describe("Connect your agent, on Idea", () => {
  it("sits above the product concept for a writer with no agent, with Claude's steps first", async () => {
    const host = await mount(<IdeaPage />);
    const s = sheet(host)!;
    expect(s).not.toBeNull();
    expect(s.nextElementSibling?.classList.contains("idea-card-concept")).toBe(true);
    expect(s.querySelector(".sheet-title")?.textContent).toBe("Connect your agent");
    expect(s.querySelector(".status")?.textContent).toBe("Not connected yet");
    expect(s.textContent).toContain("Your agent does the writing here: it reads your material and drafts outcomes, mockups and the Story.");
    // The statement about where an agent sends what it reads is Settings', not repeated here.
    expect(s.textContent).not.toContain("under their terms");
    expect([...s.querySelectorAll(".connect-choice button")].map((b) => b.textContent)).toEqual(["Claude", "Claude Code", "Another agent"]);
    expect(agent(host, "Claude").getAttribute("aria-pressed")).toBe("true");
    expect(steps(host)).toEqual([
      "Copy WhatBuild’s address:",
      "In Claude, open Customize, then Connectors. Choose Add, then Add custom connector, name it WhatBuild and paste the address.",
      "Claude opens a WhatBuild page in your browser. Sign in there and choose what Claude may do.",
      "Come back to this page. It says Connected once Claude is in.",
    ]);
    expect(copied(host)).toBe(`${ORIGIN}/mcp`);
    // Nothing dismisses it.
    expect(s.querySelector("button[aria-label*='Close'], button[aria-label*='Dismiss']")).toBeNull();
  });

  it("gives each agent its own steps, and remembers the choice on this device", async () => {
    const host = await mount(<IdeaPage />);
    await act(async () => agent(host, "Claude Code").click());
    expect(copied(host)).toBe(`claude mcp add --scope user --transport http whatbuild ${ORIGIN}/mcp`);
    expect(steps(host)).toEqual([
      "Copy this command:",
      "Run it in a terminal, then start Claude Code, type /mcp, choose whatbuild and choose Authenticate.",
      "Claude Code opens a WhatBuild page in your browser. Sign in there and choose what Claude Code may do.",
      "Come back to this page. It says Connected once Claude Code is in.",
    ]);
    await act(async () => agent(host, "Another agent").click());
    expect(copied(host)).toBe(`${ORIGIN}/mcp`);
    expect(steps(host)).toEqual([
      "Copy WhatBuild’s address:",
      "In your agent’s settings, add it as a remote MCP server. Some call this a custom connector or an integration.",
      "Your agent opens a WhatBuild page in your browser. Sign in there and choose what your agent may do.",
      "Come back to this page. It says Connected once your agent is in.",
    ]);
    expect(localStorage.getItem("whatbuild.agent")).toBe("other");
    unmount?.();
    const again = await mount(<IdeaPage />);
    expect(agent(again, "Another agent").getAttribute("aria-pressed")).toBe("true");
  });

  it("is not there for someone who cannot write, nor for someone with an agent", async () => {
    canWrite = false;
    expect(sheet(await mount(<IdeaPage />))).toBeNull();
    unmount?.();
    canWrite = true;
    agents = [{ family_id: "f1" }];
    expect(sheet(await mount(<IdeaPage />))).toBeNull();
  });

  it("goes when the person comes back having connected an agent, says so, and the screen says where to ask", async () => {
    const host = await mount(<IdeaPage />);
    expect(sheet(host)).not.toBeNull();
    expect(lead(host)).toBe("Then, in your agent, ask:");
    expect(host.querySelector(".first-use")?.textContent).toContain("An outcome is what the product’s users should be able to achieve.");
    expect(host.querySelector(".first-use")?.textContent).not.toContain("compass");
    expect([...host.querySelectorAll(".first-use a, .first-use button")].map((b) => b.textContent)).toEqual(["Copy"]);
    // No picture yet waits for an agent: the request on the card is for one.
    expect(host.querySelector(".idea-no-front")).toBeNull();

    agents = [{ family_id: "f1" }];
    // Back from an app beside the browser: the window's focus, however recently the list was read.
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await settle();
    expect(sheet(host)).toBeNull();
    expect(document.querySelector(".toasts")?.textContent).toContain("Connected. Ask your agent to start.");
    expect(lead(host)).toBe("In your agent, ask:");
    const noFront = host.querySelector(".idea-no-front")!;
    expect(noFront.textContent).toContain("No picture yet");
    // Shown as the outcomes' request is: the same lead, in quotation marks in its well, Copy under it.
    expect(noFront.querySelector(".first-use-lead")?.textContent).toBe("In your agent, ask:");
    expect(noFront.querySelector(".first-use-request q")?.textContent).toBe("Draw the picture on Harvest’s product concept card in WhatBuild.");
    expect(noFront.querySelector(".first-use-request + .empty-action button")?.textContent).toBe("Copy");

    // With an agent connected, coming back reads nothing, and the sheet stays away.
    vi.mocked(api).mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle(5);
    expect(vi.mocked(api).mock.calls.filter(([, path]) => path === "/api/v1/me/agents")).toHaveLength(0);
    expect(sheet(host)).toBeNull();
    focusManager.setFocused(undefined);
  });

  it("asks for the product concept before its picture while there is none", async () => {
    agents = [{ family_id: "f1" }];
    product.concept = "";
    try {
      const host = await mount(<IdeaPage />);
      const noFront = host.querySelector(".idea-card-concept .idea-no-front")!;
      expect(noFront.querySelector(".first-use-request q")?.textContent).toBe("Interview me about Harvest, then write its product concept in WhatBuild, as a card with its picture and text.");
      expect(host.textContent).not.toContain("Draw the picture on Harvest’s product concept card");
    } finally {
      product.concept = "Crews log the day's harvest.";
    }
  });

  it("shows a viewer no picture yet without the request, agent or not", async () => {
    canWrite = false;
    const host = await mount(<IdeaPage />);
    expect(host.querySelector(".idea-no-front")?.textContent).toBe("No picture yet");
  });
});

describe("an empty screen without Connect your agent above it", () => {
  const evidence = <FirstUse title="No sources yet" ask="Add the notes and documents I give you to Harvest in WhatBuild, one source each.">Sources are what you collected.</FirstUse>;

  it("links Connect an agent to Settings at Agents before the request, with no button for it", async () => {
    const host = await mount(evidence, `${APP}/evidence`);
    expect(lead(host)).toBe("Connect an agent, then ask it:");
    expect(host.querySelector(".first-use-lead a")?.getAttribute("href")).toBe(`${APP}/evidence?settings=agents`);
    expect([...host.querySelectorAll(".first-use button")].map((b) => b.textContent)).toEqual(["Copy"]);
  });

  it("says where to ask once an agent is connected", async () => {
    agents = [{ family_id: "f1" }];
    const host = await mount(evidence, `${APP}/evidence`);
    expect(lead(host)).toBe("In your agent, ask:");
    expect(host.querySelector(".first-use-lead a")).toBeNull();
  });
});
