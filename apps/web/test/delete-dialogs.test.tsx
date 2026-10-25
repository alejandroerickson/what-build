import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Every permanent delete asks the same question in its title, and every one can be cancelled; where
// the thing can be archived, Archive instead sits beside Cancel.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "01K8A2B3C4D5E6F7G8H9J0K1M2";
const BASE = "/api/v1/p/acme/core/crew";
const by = { account_id: "a1", display_name: "Riley Chen", surface: "web", client: null };
/** Whether the source the page shows is archived. */
const source = { archived_at: null as string | null };
/** The product its Settings show, to an admin. */
const product = {
  product_id: "p1", name: "Crewboard", slug: "crew", concept: "", archived_at: null as string | null, etag: "product-etag", path: "acme/core/crew",
  tenant: { tenant_id: "t1", slug: "acme", name: "Acme" }, team: { team_id: "tm1", slug: "core", name: "Core" }, your_role: "admin",
};

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return {
    ...real,
    api: vi.fn(async (method: string, path: string) => {
      if (path === `${BASE}/delete-impact`)
        return { etag: "product-impact-etag", contents: { sources: 2, stored_files: 0, bytes: 0, comments: 0, outcomes: 0, assumptions: 0, story_pages: 0, mockups: 0, exports: 0, people: 0 } };
      if (method === "POST" && path === `${BASE}/archive`) return { product_id: product.product_id, archived_at: "2026-10-02T09:00:00.000Z" };
      if (path === `${BASE}/exports`) return { items: [] };
      if (path === "/api/v1/me/products") return { items: [], tenants: [] };
      if (path.startsWith("/api/v1/tenants/acme/members")) return { product: { product_id: product.product_id, name: product.name, team_id: "tm1", team: "Core" }, members: [], invitations: [] };
      if (path === `${BASE}/sources/${ID}?detail=full`)
        return {
          record_id: ID, title: "Crew lead interview — Example Co", date: null, tags: [], uploaded_by: by, uploaded_at: "2026-10-01T09:00:00.000Z",
          updated_at: "2026-10-01T09:00:00.000Z", updated_by: by, archived_at: source.archived_at, derived_status: "awaiting_file", text_chars: 0, attachment_count: 0,
          etag: "source-etag", duration_ms: null, status_detail: null, warnings: [], annotation_count: 0, pending_upload_path: null, attachments: [],
          annotations: [], text: null, agent_notes: [],
        };
      if (path.endsWith("/delete-impact"))
        return { etag: "impact-etag", file_versions: 0, bytes: 0, derivations: 0, annotations: 0, review_count: 0, linked_from: [], archived: false, version_count: 1, sub_pages_promoted: [] };
      return { sources: 0, tags: [], added_by: [] };
    }),
  };
});
vi.mock("../src/lib/session.tsx", async (original) => ({
  ...(await original<typeof import("../src/lib/session.tsx")>()),
  useProduct: () => ({ api: BASE, app: "/t/acme/core/crew", canWrite: true, canDelete: true, isAdmin: true, product }),
}));

// The theme module reads the system's scheme as it loads, and the Idea screen brings it in.
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

const { api } = await import("../src/lib/api.ts");
const { DeleteDialog } = await import("../src/routes/delete-dialog.tsx");
const { ProductSettingsPage } = await import("../src/routes/product-misc.tsx");
const { entryImpactWords } = await import("../src/routes/registers.tsx");
const { DeletePage } = await import("../src/routes/story-actions.tsx");
const { servedBy } = await import("../src/routes/idea.tsx");
const { SourceDetailPage, sourceImpactWords } = await import("../src/routes/source-detail.tsx");
const { organizationImpactWords } = await import("../src/routes/org.tsx");
const { mockupImpactWords } = await import("../src/routes/mockups.tsx");

beforeAll(() => {
  // jsdom draws no modal layer; a dialog that opens is enough here.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  // Menus ask whether to animate.
  window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
});

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  source.archived_at = null;
  product.archived_at = null;
  vi.mocked(api).mockClear();
});

/** Lets the queries and the dialog a click opened settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function render(node: ReactNode, at = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

/** The buttons along the dialog's foot, in order. */
function footer(): string[] {
  return [...document.querySelectorAll("dialog[open] .dialog-foot button")].map((b) => b.textContent?.trim() ?? "");
}

function button(label: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`No button “${label}”: ${[...document.querySelectorAll("button")].map((x) => x.textContent?.trim()).join(" | ")}`);
  return b;
}

describe("a permanent delete's dialog", () => {
  it("offers Cancel beside Archive instead, and Cancel closes it without archiving", async () => {
    const onClose = vi.fn();
    const onArchive = vi.fn();
    await render(
      <DeleteDialog
        title="Delete this assumption permanently?"
        impactPath={`${BASE}/assumptions/a1/delete-impact`}
        deletePath={`${BASE}/assumptions/a1`}
        alternative={{ label: "Archive instead", onSelect: onArchive }}
        renderImpact={() => <p>This deletes the assumption.</p>}
        onDeleted={() => {}}
        onClose={onClose}
      />,
    );
    expect(footer()).toEqual(["Cancel", "Archive instead", "Delete permanently"]);
    await act(async () => button("Cancel").click());
    expect(onClose).toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("offers Cancel alone where nothing can be archived instead", async () => {
    await render(<DeleteDialog title="Delete Crewboard permanently?" etag="e1" deletePath={BASE} renderImpact={() => <p>Everything goes.</p>} onDeleted={() => {}} onClose={() => {}} />);
    expect(footer()).toEqual(["Cancel", "Delete permanently"]);
  });
});

describe("deleting a source", () => {
  it("asks, as every delete does, whether to delete this source permanently, and can be cancelled", async () => {
    await render(
      <Routes>
        <Route path="/t/acme/core/crew/evidence/:recordId" element={<SourceDetailPage />} />
      </Routes>,
      `/t/acme/core/crew/evidence/${ID}`,
    );
    await act(async () => (document.querySelector('[aria-label="Source actions"]') as HTMLButtonElement).click());
    await act(async () => button("Delete permanently…").click());
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(document.querySelector("dialog[open] .dialog-title")?.textContent).toBe("Delete this source permanently?");
    expect(document.querySelector("dialog[open] .dialog-description")?.textContent).toBe("This can’t be undone. Archiving takes it out of lists and search and erases nothing.");
    // It has no attachments and no comments, and counts neither.
    expect(document.querySelector("dialog[open] .source-impact p")?.textContent).toBe("This deletes its text, summary and notes.");
    expect(footer()).toEqual(["Cancel", "Archive instead", "Delete permanently"]);
    await act(async () => button("Cancel").click());
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
});

describe("what a delete dialog counts", () => {
  it("leaves a source's count of none out, and says the rest as before", () => {
    expect(sourceImpactWords({ file_versions: 4, bytes: 218 * 1024 * 1024, annotations: 1 })).toBe(
      "This deletes its attachments (4 stored versions, 218.0 MB), its text, summary and notes, and 1 comment.",
    );
    expect(sourceImpactWords({ file_versions: 1, bytes: 2048, annotations: 0 })).toBe("This deletes its attachments (1 stored version, 2.0 KB), its text, summary and notes.");
    expect(sourceImpactWords({ file_versions: 0, bytes: 0, annotations: 3 })).toBe("This deletes its text, summary and notes, and 3 comments.");
    expect(sourceImpactWords({ file_versions: 0, bytes: 0, annotations: 0 })).toBe("This deletes its text, summary and notes.");
  });

  it("leaves an organization's counts of none out", () => {
    const products = (n: number) => Array.from({ length: n }, (_, i) => ({ product_id: `p${i}`, name: `Product ${i}`, archived: false }));
    const none = { teams: 0, products: [], sources: 0, stored_files: 0, bytes: 0, people: 0, pending_invitations: 0 };
    expect(organizationImpactWords("Acme", { ...none, teams: 2, products: products(3), sources: 5, stored_files: 1, bytes: 2048, people: 4, pending_invitations: 2 })).toEqual({
      goes: "Everything in Acme goes at once: its 2 teams and all 3 of its products, with 5 sources and 1 stored file (2.0 KB).",
      people: "4 people lose their roles here, and 2 invitations stop working. Their accounts, and their roles in other organizations, stay.",
    });
    // A new organization: one team, one product, nothing in it yet, and its owner.
    expect(organizationImpactWords("Acme", { ...none, teams: 1, products: products(1), people: 1 })).toEqual({
      goes: "Everything in Acme goes at once: its team and its product.",
      people: "1 person loses their roles here. Their accounts, and their roles in other organizations, stay.",
    });
    expect(organizationImpactWords("Acme", { ...none, teams: 1, sources: 2, people: 1, pending_invitations: 1 })).toEqual({
      goes: "Everything in Acme goes at once: its team, with 2 sources.",
      people: "1 person loses their roles here, and 1 invitation stops working. Their accounts, and their roles in other organizations, stay.",
    });
    expect(organizationImpactWords("Acme", none)).toEqual({ goes: "Everything in Acme goes at once.", people: null });
    expect(organizationImpactWords("Acme", { ...none, pending_invitations: 3 }).people).toBe("3 invitations stop working.");
  });
});

describe("deleting an assumption", () => {
  const link = (id: string) => ({ id, statement: "Crews share vans.", type: "assumption" });
  it("says what it deletes as the other dialogs do, the links to it from other assumptions among it", () => {
    expect(entryImpactWords("assumption", { review_count: 0, linked_from: [] })).toBe("This deletes the assumption.");
    expect(entryImpactWords("assumption", { review_count: 2, linked_from: [link("a1")] })).toBe(
      "This deletes the assumption, its 2 reviews and the links to it from 1 other assumption.",
    );
    expect(entryImpactWords("assumption", { review_count: 0, linked_from: [link("a1"), link("a2")] })).toBe(
      "This deletes the assumption and the links to it from 2 other assumptions.",
    );
    expect(entryImpactWords("assumption", { review_count: 1, linked_from: [link("a1")] })).not.toMatch(/remove/i);
  });
});

describe("deleting what is already archived", () => {
  it("offers Cancel alone for an archived source, with nothing to archive instead, and says nothing of archiving it", async () => {
    source.archived_at = "2026-10-02T09:00:00.000Z";
    await render(
      <Routes>
        <Route path="/t/acme/core/crew/evidence/:recordId" element={<SourceDetailPage />} />
      </Routes>,
      `/t/acme/core/crew/evidence/${ID}`,
    );
    await act(async () => (document.querySelector('[aria-label="Source actions"]') as HTMLButtonElement).click());
    await act(async () => button("Delete permanently…").click());
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(footer()).toEqual(["Cancel", "Delete permanently"]);
    expect(document.querySelector("dialog[open] .dialog-description")?.textContent).toBe("This can’t be undone.");
    expect(document.querySelector("dialog[open]")?.textContent).not.toMatch(/archiving/i);
  });

  it("offers Archive instead for a live Story page and leaves it out for an archived one", async () => {
    const page = { page_id: "p1", title: "Where the plan stands", etag: "p-1", archived_at: null as string | null };
    await render(<DeletePage page={page} onArchive={() => {}} onDeleted={() => {}} onClose={() => {}} />);
    expect(footer()).toEqual(["Cancel", "Archive instead", "Delete permanently"]);
    unmount?.();
    await render(<DeletePage page={{ ...page, archived_at: "2026-10-02T09:00:00.000Z" }} onArchive={() => {}} onDeleted={() => {}} onClose={() => {}} />);
    expect(footer()).toEqual(["Cancel", "Delete permanently"]);
  });
});

describe("deleting a product", () => {
  it("offers Archive instead while the product is live, as the dialogs of everything else that can be archived do, and it archives the product", async () => {
    await render(<ProductSettingsPage />);
    await act(async () => button("Delete Crewboard permanently…").click());
    await settle();
    expect(document.querySelector("dialog[open] .dialog-title")?.textContent).toBe("Delete Crewboard permanently?");
    expect(footer()).toEqual(["Cancel", "Archive instead", "Delete permanently"]);
    await act(async () => button("Archive instead").click());
    await settle();
    expect(vi.mocked(api).mock.calls).toContainEqual(["POST", `${BASE}/archive`, { expected_etag: "product-etag" }]);
    expect(vi.mocked(api).mock.calls.some(([m]) => m === "DELETE")).toBe(false);
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("leaves Archive instead out once the product is archived", async () => {
    product.archived_at = "2026-10-02T09:00:00.000Z";
    await render(<ProductSettingsPage />);
    await act(async () => button("Delete Crewboard permanently…").click());
    await settle();
    expect(footer()).toEqual(["Cancel", "Delete permanently"]);
  });
});

describe("deleting a mockup", () => {
  it("says what goes with its versions in good grammar, one or several", () => {
    expect(mockupImpactWords("Week board", 1)).toBe("This deletes “Week board” with its only version: its pages, notes, files and brief.");
    expect(mockupImpactWords("Week board", 3)).toBe("This deletes “Week board” with all 3 of its versions: their pages, notes, files and briefs.");
  });
});

describe("deleting an outcome", () => {
  it("counts the assumptions that serve it in good grammar, one or more", () => {
    expect(servedBy(1)).toBe("1 assumption serves it, and will no longer be linked to it.");
    expect(servedBy(3)).toBe("3 assumptions serve it, and will no longer be linked to it.");
  });
});
