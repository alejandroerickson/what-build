import { Navigate, useLocation, useParams } from "react-router";
import { currentProductPath, useProducts } from "../lib/session.tsx";
import { PlainShell } from "../shell/Shell.tsx";
import { Loading } from "../ui/index.tsx";
import { NotFound } from "./auth.tsx";

/**
 * A product's addresses in the app, and the older forms that lead to them. A product is
 * `/t/<organization>/<product>`, beside its organization's own pages (`/t/<organization>/members`,
 * …), whose names no product may have. React Router ranks a route's static parts above its
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

