import { Link, Navigate, useSearchParams } from "react-router";
import { plural, relativeTime } from "../lib/format.ts";
import { useProducts, type ProductsResponse, type ProductSummary } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { L1 } from "../shell/panel.tsx";
import { Button, EmptyState, ErrorCallout, Glyph, Loading, Sheet, SheetHeader, StatusBadge, type GlyphName } from "../ui/index.tsx";
import { CreateProductDialog } from "./new-product.tsx";
import "../styles/screens/overview.css";

type Counts = ProductSummary["counts"];

/** The discovery loop in the order the panel tells it, with what each stage holds. */
const LOOP: { id: string; label: string; icon: GlyphName; figures: [keyof Counts, string, string][] }[] = [
  { id: "idea", label: "Idea", icon: "lightbulb", figures: [["outcomes", "outcome", "outcomes"]] },
  { id: "evidence", label: "Evidence", icon: "library", figures: [["sources", "source", "sources"]] },
  {
    id: "synthesis",
    label: "Synthesis",
    icon: "blend",
    figures: [["insights", "insight", "insights"], ["assumptions", "assumption", "assumptions"], ["decisions", "decision", "decisions"]],
  },
  { id: "story", label: "Story", icon: "book-open", figures: [["story_pages", "page", "pages"]] },
];

const UNIT: Record<string, [string, string]> = { idea: ["outcome", "outcomes"], evidence: ["source", "sources"], synthesis: ["insight", "insights"], story: ["page", "pages"] };

/**
 * The overview at `/`: what WhatBuild is for, what the person's products hold between them, and every
 * product with a direct link to each of its four sections. It is the one list of products: New
 * product (`?create=1`) and archived products (`?archived=1`) open here.
 */
export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const products = useProducts(true);
  const setParam = (key: string, on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (on) next.set(key, "1");
        else next.delete(key);
        return next;
      },
      { replace: !on },
    );
  if (products.data && !products.data.tenants.length) return <Navigate to="/welcome" replace />;
  const all = products.data?.items ?? [];
  const items = all.filter((p) => !p.archived_at);
  const showArchived = params.get("archived") === "1";
  return (
    <div className="overview">
      <Sheet className="overview-intro" labelledBy="overview-title">
        <div className="overview-head">
          <h1 id="overview-title" className="overview-lockup">
            <BrandMark size={34} />
            <span>WhatBuild</span>
          </h1>
        </div>
        <div className="overview-pitch">
          <p className="overview-question">What to build?</p>
          <p className="overview-pressure">The speed of AI Engineering forces product discovery to move impossibly fast.</p>
          <p className="overview-about">
            WhatBuild accelerates collaborative agentic discovery, facilitates alignment, and tells the story of your build. At the
            finish line, WhatBuild provides context to your ticket-creation agent so that your team can hit the ground running.
          </p>
          <Link to="/connect" className="overview-agent-link">
            <Glyph name="bot" size="sm" />
            Connect an agent
          </Link>
        </div>
        <Totals items={items} pending={products.isPending} />
      </Sheet>

      {products.isPending ? (
        <Sheet label="Loading products">
          <Loading label="Loading your products…" lines={3} />
        </Sheet>
      ) : products.isError ? (
        <Sheet label="Products">
          <div className="sheet-body">
            <ErrorCallout inset title="Your products could not be loaded" error={products.error} onRetry={() => products.refetch()} />
          </div>
        </Sheet>
      ) : (
        products.data.tenants.map((t) => (
          <Organization
            key={t.tenant_id}
            tenant={t}
            products={all.filter((p) => p.tenant.tenant_id === t.tenant_id)}
            showArchived={showArchived}
            onShowArchived={(on) => setParam("archived", on)}
            onCreate={() => setParam("create", true)}
          />
        ))
      )}
      {params.get("create") === "1" && products.data ? <CreateProductDialog tenants={products.data.tenants} onClose={() => setParam("create", false)} /> : null}
    </div>
  );
}

/** The six counts across every active product, laid out as the loop they belong to. */
function Totals({ items, pending }: { items: ProductSummary[]; pending: boolean }) {
  const total = (k: keyof Counts) => items.reduce((n, p) => n + p.counts[k], 0);
  return (
    <aside className="overview-loop" aria-labelledby="overview-loop-title" aria-busy={pending || undefined}>
      <h2 id="overview-loop-title" className="overview-loop-title">
        {pending ? "Across your products" : `Across ${plural(items.length, "product")}`}
      </h2>
      <ol className="overview-loop-steps">
        {LOOP.map((step) => (
          <li key={step.id} className="overview-loop-step">
            <span className="overview-loop-node">
              <Glyph name={step.icon} />
            </span>
            <span className="overview-loop-name">{step.label}</span>
            <Figure count={pending ? null : total(step.figures[0]![0])} one={step.figures[0]![1]} many={step.figures[0]![2]} />
            {step.figures.length > 1 ? (
              <span className="overview-loop-more">
                {step.figures.slice(1).map(([key, one, many]) => (
                  <Figure key={key} count={pending ? null : total(key)} one={one} many={many} />
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Figure({ count, one, many }: { count: number | null; one: string; many: string }) {
  return (
    <span className="overview-loop-figure">
      <b className="num">{count ?? "–"}</b> {count === 1 ? one : many}
    </span>
  );
}

function Organization({ tenant, products, showArchived, onShowArchived, onCreate }: {
  tenant: ProductsResponse["tenants"][number];
  products: ProductSummary[];
  showArchived: boolean;
  onShowArchived: (on: boolean) => void;
  onCreate: () => void;
}) {
  const canCreate = tenant.teams.some((tm) => tm.your_role === "admin");
  const active = products.filter((p) => !p.archived_at);
  const archived = products.filter((p) => p.archived_at);
  const shown = showArchived ? [...active, ...archived] : active;
  // With one team the team's name says nothing the organization's doesn't.
  const showTeam = tenant.teams.length > 1;
  const headId = `overview-org-${tenant.tenant_id}`;
  return (
    <Sheet className="overview-org" labelledBy={headId}>
      <SheetHeader
        id={headId}
        title={
          <>
            <Glyph name="building" size="sm" />
            {tenant.name}
          </>
        }
        end={
          canCreate ? (
            <Button icon="plus" onClick={onCreate}>
              New product
            </Button>
          ) : null
        }
      />
      {shown.length ? (
        <ul className="overview-products">
          {shown.map((p) => (
            <ProductEntry key={p.product_id} product={p} showTeam={showTeam} />
          ))}
        </ul>
      ) : !tenant.teams.length ? (
        <EmptyState size="inline" title="Nothing here to open yet.">
          You&rsquo;re a member of {tenant.name}, but you have no role on any of its teams or products. Ask one of its admins to give you one.
        </EmptyState>
      ) : (
        <EmptyState size="inline" title="No active products you can see.">
          {canCreate ? "Create one to start a discovery." : "Ask a team admin to create one or give you a role."}
        </EmptyState>
      )}
      {archived.length ? (
        <div className="overview-org-foot">
          <button type="button" className="quiet-link" aria-expanded={showArchived} onClick={() => onShowArchived(!showArchived)}>
            {showArchived ? "Hide archived products" : `Show ${plural(archived.length, "archived product")}`}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

function ProductEntry({ product: p, showTeam }: { product: ProductSummary; showTeam: boolean }) {
  const nameId = `overview-product-${p.product_id}`;
  return (
    <li className="overview-product" aria-labelledby={nameId}>
      <div className="overview-product-main">
        <h3 id={nameId} className="overview-product-name">
          <Link to={`/t/${p.path}/idea`}>{p.name}</Link>
        </h3>
        {p.concept.trim() ? <p className="overview-product-concept">{p.concept}</p> : <p className="overview-product-concept faint">No product concept written yet</p>}
        <p className="overview-product-meta">
          {p.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
          {showTeam ? `${p.team.name} · ` : null}Updated <span className="num">{relativeTime(p.updated_at)}</span>
        </p>
      </div>
      <nav className="overview-product-go" aria-label={`${p.name}: sections`}>
        {L1.map((d) => {
          const n = p.counts[d.count];
          const [one, many] = UNIT[d.id]!;
          return (
            <Link key={d.id} to={`/t/${p.path}/${d.id}`} className="overview-go">
              <Glyph name={d.icon} />
              <span className="overview-go-label">{d.label}</span>
              <span className="overview-go-count num">
                {n}
                <span className="visually-hidden"> {n === 1 ? one : many}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </li>
  );
}
