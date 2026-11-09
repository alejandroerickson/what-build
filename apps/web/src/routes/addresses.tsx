import { useState } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { currentProductPath, lastProductIn, mayCreateProducts, productHome, useMe, useProduct, useProducts, type ProductsResponse } from "../lib/session.tsx";
import { useGuestPass } from "../shell/guest-gate.tsx";
import { SETTINGS_PARAM, type SettingsKey } from "../shell/settings-link.ts";
import { OrganizationShell, PlainShell } from "../shell/Shell.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, EmptyState, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader } from "../ui/index.tsx";
import { EntryPage, NotFound, NotVisible } from "./auth.tsx";
import { CreateProductDialog } from "./new-product.tsx";
import { SettingsPage } from "./settings.tsx";

/**
 * A product's addresses in the app, and the older forms that lead to them. A product is
 * `/t/<organization>/<product>`, beside its organization's own addresses (`/t/<organization>/members`,
 * …, which open Settings), whose names no product may have. React Router ranks a route's static parts above its
 * dynamic ones, so a product's own screens (`/t/:tenant/:product/evidence/:recordId`, …) and the
 * organization's pages win over the older forms below, which answer only what none of them does.
 */
export const PRODUCT_ROUTE = "/t/:tenant/:product";
/** An address from before teams were removed: `/t/<organization>/<team>/<product>/…`. */
export const FORMER_PRODUCT_ROUTE = "/t/:tenant/:former/:product/*";
/** A product's path typed or pasted without /t/: `<organization>/<product>/…`, or the older three-part form. */
export const BARE_PRODUCT_ROUTE = "/:tenant/:product/*";

/** The part of a product's address after the product, the query and the hash, kept when an address moves. */
function useAddressRest(rest: string | undefined) {
  const { search, hash } = useLocation();
  return `${rest ? `/${rest}` : ""}${search}${hash}`;
}

/**
 * A product's address from before teams were removed, `/t/<organization>/<team>/<product>/…`, leads
 * to the product's address now, the rest of it, its query and its hash kept: to the product that
 * lists it among its former paths, or else to the same address without its middle part. A screen the
 * app doesn't have in a product the person has is not found (`currentProductPath`).
 */
export function FormerProductAddress() {
  const { tenant = "", former = "", product = "", "*": rest } = useParams();
  const products = useProducts();
  const after = useAddressRest(rest);
  // A former path is rare, so the address is read once the person's products are known, never guessed at before.
  if (products.isPending) return <div className="center-page"><Loading /></div>;
  const path = currentProductPath(products.data?.items, tenant, former, product);
  if (!path)
    return (
      <PlainShell>
        <NotFound />
      </PlainShell>
    );
  return <Navigate replace to={`/t/${path}${after}`} />;
}

/**
 * A product's path typed or pasted without the /t/ prefix (organization/product, or the
 * organization/team/product of an address from before teams were removed) opens the product rather
 * than a dead end. A path that starts with t/ is not a product.
 */
export function BareProductPath() {
  const { tenant = "", product = "", "*": rest } = useParams();
  const after = useAddressRest(rest);
  if (tenant === "t")
    return (
      <PlainShell>
        <NotFound />
      </PlainShell>
    );
  // `/t/<organization>/<product>/<rest>` opens it; an older three-part path is taken on from there.
  return <Navigate replace to={`/t/${tenant}/${product}${after}`} />;
}


/** An address with Settings open at `key` on `pathname`, whatever else the old address's query held kept. */
function withSettings(pathname: string, search: string, key: SettingsKey): string {
  const next = new URLSearchParams(search);
  next.set(SETTINGS_PARAM, key);
  return `${pathname}?${next.toString().replace(/%2F/gi, "/")}`;
}

/**
 * The person's own pages from before Settings was a dialog, `/connect` and `/settings`, open it at
 * Agents or Account over the overview, their query kept (`?reach=…` for an agent's reach,
 * `?delete=account`). Someone with no organization to open it over (a guest still waiting for a
 * place, or someone in none on a WhatBuild without an example organization) has `/settings` as a page
 * of its own.
 */
export function YourSettingsAddress({ section }: { section: "account" | "agents" }) {
  const { search } = useLocation();
  const me = useMe();
  const pass = useGuestPass();
  const products = useProducts();
  const waiting = Boolean(me.data?.guest && pass && pass.status !== "in");
  if (section === "account" && !waiting && products.isPending) return <div className="center-page"><Loading /></div>;
  if (section === "account" && (waiting || !products.data?.tenants.length))
    return (
      <EntryPage title="Settings · WhatBuild">
        <SettingsPage />
      </EntryPage>
    );
  return <Navigate replace to={withSettings("/", search, section)} />;
}

/**
 * An organization's pages from before Settings was a dialog, `/t/<organization>/members`, `…/plan` and
 * `…/limits`, open it at the organization's People or Plan over the product the person last had open
 * there (`OrganizationHome`). Members' Delete this organization (`#delete-org-title`) is under General.
 */
export function OrganizationSettingsAddress({ section }: { section: "organization/people" | "organization/plan" }) {
  const { tenant = "" } = useParams();
  const { search, hash } = useLocation();
  const key: SettingsKey = hash === "#delete-org-title" ? "organization" : section;
  return <Navigate replace to={withSettings(`/t/${tenant}`, search, key)} />;
}

/**
 * A product's Settings and Connect an agent from before Settings was a dialog, `…/settings` (with
 * `#people` or `#organization`) and `…/connect`, open it over the product's first screen.
 */
export function ProductSettingsAddress({ section }: { section: "product" | "agents" }) {
  const { app, product } = useProduct();
  const { search, hash } = useLocation();
  const key: SettingsKey = section === "agents" ? "agents" : hash === "#people" ? "product/people" : hash === "#organization" ? "organization/people" : "product";
  return <Navigate replace to={withSettings(`${app}/${productHome(product.your_role)}`, search, key)} />;
}

/**
 * `/t/<organization>`: the product the person last had open in the organization, or else its first,
 * with the address's query kept (Settings, say); where they can open none, the organization's own
 * screen, whose panel and page offer Create a product to whoever may create one.
 */
export function OrganizationHome() {
  const { tenant = "" } = useParams();
  const products = useProducts();
  const { search, hash } = useLocation();
  if (products.isPending) return <div className="center-page"><Loading /></div>;
  if (products.isError)
    return (
      <PlainShell>
        <Sheet label="Organization">
          <SheetBody>
            <ErrorCallout inset title="Your products couldn’t be loaded" error={products.error} onRetry={() => products.refetch()} />
          </SheetBody>
        </Sheet>
      </PlainShell>
    );
  const t = products.data.tenants.find((x) => x.slug === tenant);
  // Settings asked for over an organization the person can't see opens nothing: the screen says it isn't there.
  if (!t && new URLSearchParams(search).has(SETTINGS_PARAM)) return <Navigate replace to={`/t/${tenant}`} />;
  if (!t)
    return (
      <PlainShell>
        <NotVisible what="organization" />
      </PlainShell>
    );
  const items = products.data.items.filter((p) => p.tenant.tenant_id === t.tenant_id);
  const last = lastProductIn(t.tenant_id);
  const go = items.find((p) => p.path === last) ?? items[0];
  if (go) return <Navigate replace to={`/t/${go.path}/${productHome(go.your_role)}${search}${hash}`} />;
  return (
    <OrganizationShell tenant={t}>
      <EmptyOrganization tenant={t} />
    </OrganizationShell>
  );
}

function EmptyOrganization({ tenant }: { tenant: ProductsResponse["tenants"][number] }) {
  const products = useProducts();
  const [creating, setCreating] = useState(false);
  const mayCreate = mayCreateProducts(tenant);
  usePageTitle(tenant.name);
  return (
    <Sheet labelledBy="organization-empty-title">
      <SheetHeader
        level={1}
        id="organization-empty-title"
        title={tenant.name}
        end={
          mayCreate ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              Create a product
            </Button>
          ) : null
        }
      />
      <EmptyState size="inline" title={mayCreate ? "No products yet" : "Nothing to open yet"}>
        {mayCreate
          ? "A product holds one discovery: its Idea, Evidence, Exploration and Story. Create one to start."
          : `Ask an admin of ${tenant.name} for a role on a product.`}
      </EmptyState>
      {creating && products.data ? <CreateProductDialog tenants={products.data.tenants} tenant={tenant.slug} onClose={() => setCreating(false)} /> : null}
    </Sheet>
  );
}
