import { Link, Navigate } from "react-router";
import { plural, relativeTime } from "../lib/format.ts";
import { useProducts, type ProductsResponse, type ProductSummary } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { L1 } from "../shell/panel.tsx";
import { ButtonLink, EmptyState, ErrorCallout, Glyph, Loading, Sheet, SheetHeader, Tag, type GlyphName } from "../ui/index.tsx";
import "../styles/screens/overview.css";

const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", editor: "Editor", viewer: "Viewer" };

type Counts = ProductSummary["counts"];

/** The discovery loop in the order the panel tells it, with what each stage holds. */
const LOOP: { id: string; label: string; icon: GlyphName; figures: [keyof Counts, string, string][] }[] = [
  { id: "idea", label: "Idea", icon: "target", figures: [["outcomes", "outcome", "outcomes"]] },
  { id: "evidence", label: "Evidence", icon: "library", figures: [["sources", "source", "sources"]] },
  {
    id: "synthesis",
    label: "Synthesis",
    icon: "lightbulb",
    figures: [["insights", "insight", "insights"], ["assumptions", "assumption", "assumptions"], ["decisions", "decision", "decisions"]],
  },
  { id: "story", label: "Story", icon: "book-open", figures: [["story_pages", "page", "pages"]] },
];

const UNIT: Record<string, [string, string]> = { idea: ["outcome", "outcomes"], evidence: ["source", "sources"], synthesis: ["insight", "insights"], story: ["page", "pages"] };

/**
 * The overview at `/`: what WhatBuild is for, what the person's products hold between them, and every
 * product with a direct link to each of its four sections.
 */
export function OverviewPage() {
  const products = useProducts();
  if (products.data && !products.data.tenants.length) return <Navigate to="/welcome" replace />;
  const items = products.data?.items ?? [];
  return (
    <div className="overview">
      <Sheet className="overview-intro" labelledBy="overview-title">
        <div className="overview-head">
          <h1 id="overview-title" className="overview-lockup">
            <BrandMark size={34} />
            <span>WhatBuild</span>
          </h1>
          <p className="overview-origin">It all starts with an idea: someone you could help, and a problem worth solving.</p>
        </div>
        <div className="overview-pitch">
          <p className="overview-question">What to build?</p>
          <p className="overview-pressure">
            AI made building fast. Deciding what to build did not get any faster. Teams are expected to keep up anyway: to agree, stay
            aligned, and understand what they are building well enough to ship it, while every interview, call and document pulls a
            different way.
          </p>
          <p className="overview-about">
            WhatBuild is where your team and your agents work it out. Bring in the evidence, reach decisions a person has reviewed, and
            share a Story in which every claim points to the passage it came from.
          </p>
          <Link to="/connect" className="overview-agent-link">
            <Glyph name="plug" size="sm" />
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
        products.data.tenants.map((t) => <Organization key={t.tenant_id} tenant={t} products={items.filter((p) => p.tenant.tenant_id === t.tenant_id)} />)
      )}
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

function Organization({ tenant, products }: { tenant: ProductsResponse["tenants"][number]; products: ProductSummary[] }) {
  const canCreate = tenant.teams.some((tm) => tm.your_role === "admin");
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
        count={products.length}
        end={
          <>
            {tenant.your_role ? <Tag>{ROLE_WORD[tenant.your_role] ?? tenant.your_role}</Tag> : null}
            <Link to={`/t/${tenant.slug}/members`} className="quiet-link">
              Members
            </Link>
            <Link to="/products" className="quiet-link">
              All products
            </Link>
            {canCreate ? (
              <ButtonLink to="/products?create=1" icon="plus">
                New product
              </ButtonLink>
            ) : null}
          </>
        }
      />
      {products.length ? (
        <ul className="overview-products">
          {products.map((p) => (
            <ProductEntry key={p.product_id} product={p} />
          ))}
        </ul>
      ) : (
        <EmptyState size="inline" title="No active products you can see.">
          {canCreate ? "Create one to start a discovery." : "Ask a team admin to create one or give you a role."}
        </EmptyState>
      )}
    </Sheet>
  );
}

function ProductEntry({ product: p }: { product: ProductSummary }) {
  const nameId = `overview-product-${p.product_id}`;
  return (
    <li className="overview-product" aria-labelledby={nameId}>
      <div className="overview-product-main">
        <h3 id={nameId} className="overview-product-name">
          <Link to={`/t/${p.path}/idea`}>{p.name}</Link>
        </h3>
        {p.concept.trim() ? <p className="overview-product-concept">{p.concept}</p> : <p className="overview-product-concept faint">No product concept written yet</p>}
        <p className="overview-product-meta">
          {p.team.name} · {ROLE_WORD[p.your_role]} · Updated <span className="num">{relativeTime(p.updated_at)}</span>
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
