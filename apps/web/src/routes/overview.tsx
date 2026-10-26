import { Link, Navigate, useSearchParams } from "react-router";
import { plural, relativeTime } from "../lib/format.ts";
import { markdownText } from "../lib/markdown.tsx";
import { ownFirst, productHome, useHideExample, useMe, useProducts, type ProductsResponse, type ProductSummary } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { Journey } from "../shell/journey.tsx";
import { L1 } from "../shell/panel.tsx";
import { Button, ButtonLink, EmptyState, ErrorCallout, Glyph, Loading, Sheet, SheetBody, SheetHeader, StatusBadge, Tag } from "../ui/index.tsx";
import { CreateProductDialog } from "./new-product.tsx";
import "../styles/screens/overview.css";

const UNIT: Record<string, [string, string]> = { idea: ["outcome", "outcomes"], evidence: ["source", "sources"], exploration: ["item", "items"], story: ["page", "pages"] };

/**
 * The overview at `/`: what WhatBuild is for, the loop a discovery moves through, and every product with a direct link to each of its four sections. It is the one list of products: New
 * product (`?create=1`) and an organization's archived products (`?archived=<organization slug>`, one
 * parameter per organization shown) open here. The person's own organizations come first and the
 * example organization last; someone with none of their own is offered to start one.
 */
export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const products = useProducts(true);
  const me = useMe();
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
  const tenants = ownFirst(products.data?.tenants ?? []);
  const ownOrgs = tenants.filter((t) => !t.example).length;
  const all = products.data?.items ?? [];
  const items = all.filter((p) => !p.archived_at);
  // Each organization shows its own archived products: the parameter names the ones that do.
  const archivedIn = new Set(params.getAll("archived"));
  const setArchived = (slug: string, on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        const slugs = next.getAll("archived").filter((s) => s !== slug);
        next.delete("archived");
        for (const s of on ? [...slugs, slug] : slugs) next.append("archived", s);
        return next;
      },
      { replace: !on },
    );
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
          <p className="overview-tagline">Product discovery at the speed of AI Engineering.</p>
          <p className="overview-about">
            WhatBuild accelerates collaborative agentic discovery, facilitates alignment, and tells the story of your build. At the
            finish line, WhatBuild provides context to your ticket-creation agent so that your team can hit the ground running.
          </p>
          <Link to="/connect" className="overview-agent-link">
            <Glyph name="bot" size="sm" />
            Connect an agent
          </Link>
        </div>
        <Journey />
      </Sheet>

      {products.isPending ? (
        <Sheet label="Loading products">
          <Loading label="Loading your products…" lines={3} />
        </Sheet>
      ) : products.isError ? (
        <Sheet label="Products">
          <div className="sheet-body">
            <ErrorCallout inset title="Your products couldn’t be loaded" error={products.error} onRetry={() => products.refetch()} />
          </div>
        </Sheet>
      ) : (
        <>
          {!ownOrgs ? <StartYourOwn mayStart={me.data?.tenant_allowance.remaining !== 0} /> : null}
          {tenants.map((t) => (
          <Organization
            key={t.tenant_id}
            tenant={t}
            products={all.filter((p) => p.tenant.tenant_id === t.tenant_id)}
            showArchived={archivedIn.has(t.slug)}
            onShowArchived={(on) => setArchived(t.slug, on)}
            onCreate={() => setParam("create", true)}
          />
          ))}
        </>
      )}
      {params.get("create") === "1" && products.data ? <CreateProductDialog tenants={products.data.tenants} onClose={() => setParam("create", false)} /> : null}
    </div>
  );
}

/** The four stages every product moves through, with what each holds; the counts are on each product. */
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
  const me = useMe();
  const hide = useHideExample();
  const guest = tenant.your_role === "guest";
  const hidden = guest && Boolean(me.data?.hide_example);
  return (
    <Sheet className={`overview-org${tenant.example ? " overview-example" : ""}`} labelledBy={headId}>
      <SheetHeader
        id={headId}
        title={
          tenant.example ? (
            <>
              <Glyph name="library" size="sm" />
              Example organization
              <span className="overview-example-name">{tenant.name}</span>
              {guest ? <Tag>Read only</Tag> : null}
            </>
          ) : (
            <>
              <Glyph name="building" size="sm" />
              {tenant.name}
            </>
          )
        }
        end={
          canCreate ? (
            <Button icon="plus" onClick={onCreate}>
              New product
            </Button>
          ) : guest ? (
            <Button size="sm" variant="quiet" disabled={hide.isPending} onClick={() => hide.mutate(!hidden)}>
              {hidden ? "Show in the panel" : "Hide from the panel"}
            </Button>
          ) : null
        }
      />
      {tenant.example ? (
        <div className="overview-example-intro">
          <p>
          {guest
            ? "A worked discovery to learn from. Open its product and read Idea, Evidence, Exploration and Story in order."
            : "Everyone who signs in can read this organization. You’re one of its authors."}
          </p>
        </div>
      ) : null}
      {shown.length ? (
        <ul className="overview-products">
          {shown.map((p) => (
            <ProductEntry key={p.product_id} product={p} showTeam={showTeam} />
          ))}
        </ul>
      ) : !tenant.teams.length ? (
        <EmptyState size="inline" title="Nothing to open yet">
          Ask an admin of {tenant.name} for a role on a team or product.
        </EmptyState>
      ) : (
        <EmptyState size="inline" title="No products yet">
          {canCreate ? null : "Ask a team admin to add you to one."}
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

/** For someone with no organization of their own: where their work goes. */
function StartYourOwn({ mayStart }: { mayStart: boolean }) {
  return (
    <Sheet className="overview-start" labelledBy="overview-start-title">
      <SheetHeader
        id="overview-start-title"
        title="Your own organization"
        end={
          mayStart ? (
            <ButtonLink to="/welcome" variant="primary" icon="plus">
              Start your organization
            </ButtonLink>
          ) : null
        }
      />
      <SheetBody>
        <p className="muted">
          {mayStart
            ? "Your team’s work goes in an organization of your own. Start one when you’re ready."
            : "Your team’s work goes in an organization of your own. Ask whoever runs this WhatBuild for one, or someone who uses it to invite you."}
        </p>
      </SheetBody>
    </Sheet>
  );
}

function ProductEntry({ product: p, showTeam }: { product: ProductSummary; showTeam: boolean }) {
  const nameId = `overview-product-${p.product_id}`;
  // A reader has only the Story, so the other stages are neither linked nor counted.
  const reader = p.your_role === "reader";
  const stages = reader ? L1.filter((d) => d.id === "story") : L1;
  return (
    <li className="overview-product" aria-labelledby={nameId}>
      <div className="overview-product-main">
        <h3 id={nameId} className="overview-product-name">
          <Link to={`/t/${p.path}/${productHome(p.your_role)}`}>{p.name}</Link>
        </h3>
        {reader ? (
          <p className="overview-product-concept faint">You can read its Story.</p>
        ) : p.concept?.trim() ? (
          <p className="overview-product-concept">{markdownText(p.concept)}</p>
        ) : (
          <p className="overview-product-concept faint">No product concept yet</p>
        )}
        <p className="overview-product-meta">
          {p.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
          {showTeam ? `${p.team.name} · ` : null}Updated <span className="num">{relativeTime(p.updated_at)}</span>
        </p>
      </div>
      <nav className="overview-product-go" aria-label={`${p.name}: sections`}>
        {stages.map((d) => {
          const n = p.stage_counts[d.id] ?? 0;
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
