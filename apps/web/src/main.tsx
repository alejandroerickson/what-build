import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/shell.css";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate, useParams, useRouteError } from "react-router";
import { ApiError, isMinuteRefusal, readDefaults, setUnauthenticatedHandler } from "./lib/api.ts";
import { LiveUpdates } from "./lib/live.tsx";
import { loadNewRelease, releasedSinceLoad } from "./lib/new-release.ts";
import { CurrentTenantAddress, productHome, ProductProvider, RequireSession, useProduct, useProductParams, type Product } from "./lib/session.tsx";
import {
  BARE_PRODUCT_ROUTE, BareProductPath, FORMER_PRODUCT_ROUTE, FormerProductAddress, OrganizationHome, OrganizationSettingsAddress, PRODUCT_ROUTE, ProductSettingsAddress, YourSettingsAddress,
} from "./routes/addresses.tsx";
import { AdminGate, AdminGuests, AdminOrganizations, AdminPlans } from "./routes/admin.tsx";
import { CookiesPage } from "./routes/cookies.tsx";
import { AcceptInvite, NotFound, NotVisible, SignIn } from "./routes/auth.tsx";
import { IdeaPage } from "./routes/idea.tsx";
import { Welcome } from "./routes/org.tsx";
import { OverviewPage } from "./routes/overview.tsx";
import { ActivityPage } from "./routes/product-misc.tsx";
import { PlansPage } from "./routes/plans.tsx";
import { GuestGate } from "./shell/guest-gate.tsx";
import { PeoplePage } from "./routes/people.tsx";
import { SearchPage } from "./routes/search.tsx";
import { AdminStarting } from "./routes/instance.tsx";
import { AccountDeletedPage } from "./routes/delete-account.tsx";
import { SourceDetailPage } from "./routes/source-detail.tsx";
import { SourceNewPage } from "./routes/source-new.tsx";
import { EvidencePage } from "./routes/evidence.tsx";
import { StoryPage } from "./routes/story.tsx";
import { ExplorationSection } from "./routes/exploration-panel.tsx";
import { MockupPage, MockupsIndex } from "./routes/mockups.tsx";
import { CookieNotice } from "./shell/CookieNotice.tsx";
import { PlainShell, ProductShell } from "./shell/Shell.tsx";
import { usePageTitle } from "./shell/slots.tsx";
import { Button, ButtonLink, EmptyState, MinuteAnnouncer, Sheet, SheetHeader, ToastProvider, useToast } from "./ui/index.tsx";

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: { ...readDefaults, staleTime: 10_000, refetchOnWindowFocus: false },
  },
  // Every write counts toward the day's allowances, so what the organization's limits say used is read again after one.
  mutationCache: new MutationCache({ onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["limits"] }) }),
});

setUnauthenticatedHandler(() => {
  if (!location.pathname.startsWith("/signin")) location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
});

function RouteError() {
  const e = useRouteError() as Error;
  // Most likely this page's app reading what a newer release answered: load that release.
  const outdated = releasedSinceLoad();
  useEffect(() => {
    if (outdated) loadNewRelease();
  }, [outdated]);
  // Outside the shell, so it names itself rather than keep the title of the screen that failed.
  useEffect(() => {
    document.title = outdated ? "WhatBuild was updated" : "Something went wrong · WhatBuild";
  }, [outdated]);
  if (outdated)
    return (
      <div className="center-page stack">
        <h1>WhatBuild was updated while this page was open</h1>
        <p className="muted">Reload the page to use the new version.</p>
        <Button variant="primary" onClick={() => location.reload()}>
          Reload
        </Button>
      </div>
    );
  return (
    <div className="center-page stack">
      <h1>Something went wrong</h1>
      <p className="muted">{e?.message ?? "An unexpected error."} Reload the page to try again.</p>
      <ButtonLink to="/" variant="primary">Go to your products</ButtonLink>
    </div>
  );
}

/** The design system specimen: development builds only, so production bundles never include it. */
const devRoutes = import.meta.env.DEV
  ? [{ element: <PlainShell><Outlet /></PlainShell>, children: [{ path: "/_system", lazy: async () => ({ Component: (await import("./system/SystemPage.tsx")).SystemPage }) }] }]
  : [];

function ProductNotFound({ error, retry }: { error: unknown; retry: () => void }) {
  return <PlainShell>{error instanceof ApiError && error.status === 404 ? <NotVisible what="product" /> : <ProductNotLoaded error={error} retry={retry} />}</PlainShell>;
}

function ProductNotLoaded({ error, retry }: { error: unknown; retry: () => void }) {
  usePageTitle("Product not loaded");
  return (
    <Sheet labelledBy="product-missing-title">
      <SheetHeader level={1} id="product-missing-title" title="This product couldn’t be loaded" />
      <EmptyState
        size="inline"
        action={
          <>
            {/* Refused for the minute's calls past what the app asks by itself: nothing is wrong that asking again won't mend. */}
            {isMinuteRefusal(error) ? <Button variant="primary" onClick={retry}>Try again</Button> : null}
            <ButtonLink to="/">Your products</ButtonLink>
          </>
        }
      >
        {error instanceof Error ? error.message : "Reload the page to try again."}
      </EmptyState>
    </Sheet>
  );
}

/** The old list of products: the overview is the one list now, with New product and archived ones. */
function ProductsRedirect() {
  const { search } = useLocation();
  return <Navigate replace to={`/${search}`} />;
}

/** The instance's pages from before Instance admin: `/instance` (with `?org=` for a plan to change) and `/people`. */
function InstanceRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate replace to={`${to}${search}`} />;
}

/** Synthesis was renamed Exploration: an old link keeps working, with the rest of its path and its query. */
function SynthesisLink() {
  const { app } = useProduct();
  const { "*": rest } = useParams();
  const { search, hash } = useLocation();
  return <Navigate replace to={`${app}/exploration${rest ? `/${rest}` : ""}${search}${hash}`} />;
}

/**
 * Insights and decisions are now sources in Evidence with the same ids, so an old link to one
 * (in a Story page, say) opens its source; a link to either list opens Exploration.
 */
function MovedToEvidence() {
  const { app } = useProduct();
  const id = (useParams()["*"] ?? "").split("/")[0];
  return <Navigate replace to={id && id !== "new" ? `${app}/evidence/${id}` : `${app}/exploration`} />;
}

/**
 * WhatBuild no longer keeps assumptions, so an old link to one or to their list (in a Story page,
 * say) opens the mockups, with a toast saying why.
 */
function NoAssumptions() {
  const { app } = useProduct();
  return <Redirected to={`${app}/exploration/mockups`} because="WhatBuild no longer keeps assumptions." />;
}

/** A product opens on Idea, or on the Story for a Story reader, with what its address asked (Settings, say) kept. */
function ProductHome() {
  const { product } = useProduct();
  const { search, hash } = useLocation();
  return <Navigate to={`${productHome(product.your_role)}${search}${hash}`} replace />;
}

/** Every screen of a product but the Story: a Story reader, who has only the Story, is taken there, with a toast saying why. */
function NotForStoryReaders() {
  const { app, storyOnly } = useProduct();
  return storyOnly ? <Redirected to={`${app}/story`} because="You can only read this product’s Story." /> : <Outlet />;
}

/** Goes to another screen in place of this one, and says why in a toast, once. */
function Redirected({ to, because }: { to: string; because: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const told = useRef(false);
  useEffect(() => {
    if (!told.current) toast(because);
    told.current = true;
    navigate(to, { replace: true });
  }, [navigate, to, toast, because]);
  return null;
}

/** A product's screens, in its shell, hearing of changes to it. */
function ProductScreens({ product, api, app }: { product: Product; api: string; app: string }) {
  const { path } = useProductParams();
  return (
    <LiveUpdates api={api} path={path} guest={product.your_role === "guest"}>
      <ProductShell product={product} app={app}>
        <Outlet />
      </ProductShell>
    </LiveUpdates>
  );
}

/** Every screen, signed in or not, with the cookie notice in its corner until it is dismissed. */
function Root() {
  return (
    <>
      <Outlet />
      <CookieNotice />
      <MinuteAnnouncer />
    </>
  );
}

const router = createBrowserRouter([{ element: <Root />, errorElement: <RouteError />, children: [
  { path: "/signin", element: <SignIn />, errorElement: <RouteError /> },
  { path: "/cookies", element: <CookiesPage />, errorElement: <RouteError /> },
  { path: "/account-deleted", element: <AccountDeletedPage />, errorElement: <RouteError /> },
  { path: "/plans", element: <PlansPage />, errorElement: <RouteError /> },
  // The public sandbox's invitation links are retired: one opens the app, where the example organization is.
  { path: "/join/:code", element: <Navigate to="/" replace />, errorElement: <RouteError /> },
  // An invitation's link is answered from outside the guests' gate: someone invited who isn't in yet takes no guest's place to read it.
  { path: "/invite/:token", element: <RequireSession><AcceptInvite /></RequireSession>, errorElement: <RouteError /> },
  {
    element: (
      <RequireSession>
        <GuestGate>
          <Outlet />
        </GuestGate>
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: [
      { path: "/welcome", element: <Welcome /> },
      { element: <PlainShell><Outlet /></PlainShell>, children: [
        { path: "/", element: <OverviewPage /> },
      ] },
      { path: "/products", element: <ProductsRedirect /> },
      { path: "/connect", element: <YourSettingsAddress section="agents" /> },
      { path: "/settings", element: <YourSettingsAddress section="account" /> },
      { path: "/instance", element: <InstanceRedirect to="/admin/organizations" /> },
      { path: "/people", element: <InstanceRedirect to="/admin/people" /> },
      {
        path: "/admin",
        element: <AdminGate />,
        children: [
          { index: true, element: <Navigate to="organizations" replace /> },
          { path: "organizations", element: <AdminOrganizations /> },
          { path: "people", element: <PeoplePage /> },
          { path: "plans", element: <AdminPlans /> },
          { path: "guests", element: <AdminGuests /> },
          { path: "starting", element: <AdminStarting /> },
          { path: "*", element: <NotFound /> },
        ],
      },
      { path: "/t/:tenant", element: <CurrentTenantAddress><OrganizationHome /></CurrentTenantAddress> },
      { path: "/t/:tenant/members", element: <CurrentTenantAddress><OrganizationSettingsAddress section="organization/people" /></CurrentTenantAddress> },
      { path: "/t/:tenant/plan", element: <CurrentTenantAddress><OrganizationSettingsAddress section="organization/plan" /></CurrentTenantAddress> },
      { path: "/t/:tenant/limits", element: <CurrentTenantAddress><OrganizationSettingsAddress section="organization/plan" /></CurrentTenantAddress> },
      ...devRoutes,
      {
        path: PRODUCT_ROUTE,
        element: (
          <CurrentTenantAddress>
            <ProductProvider fallback={(e, retry) => <ProductNotFound error={e} retry={retry} />}>
              {(ctx) => <ProductScreens product={ctx.product} api={ctx.api} app={ctx.app} />}
            </ProductProvider>
          </CurrentTenantAddress>
        ),
        children: [
          { index: true, element: <ProductHome /> },
          { path: "story", element: <StoryPage /> },
          { path: "story/:pageId", element: <StoryPage /> },
          { path: "search", element: <SearchPage /> },
          // Settings' addresses from before it was a dialog: a Story reader, who has Settings too, follows them as well.
          { path: "connect", element: <ProductSettingsAddress section="agents" /> },
          { path: "settings", element: <ProductSettingsAddress section="product" /> },
          {
            element: <NotForStoryReaders />,
            children: [
              { path: "idea", element: <IdeaPage /> },
              { path: "evidence", element: <EvidencePage /> },
              { path: "evidence/new", element: <SourceNewPage /> },
              { path: "evidence/:recordId", element: <SourceDetailPage /> },
              { path: "synthesis/*", element: <SynthesisLink /> },
              {
                path: "exploration",
                element: <ExplorationSection />,
                children: [
                  { index: true, element: <Navigate to="mockups" replace /> },
                  { path: "mockups", element: <MockupsIndex /> },
                  { path: "mockups/:mockupId", element: <MockupPage /> },
                  { path: "assumptions/*", element: <NoAssumptions /> },
                  { path: "insights/*", element: <MovedToEvidence /> },
                  { path: "decisions/*", element: <MovedToEvidence /> },
                ],
              },
              { path: "activity", element: <ActivityPage /> },
            ],
          },
        ],
      },
      // An address from before teams were removed: a product's own screens above rank first.
      { path: FORMER_PRODUCT_ROUTE, element: <CurrentTenantAddress><FormerProductAddress /></CurrentTenantAddress> },
      { path: BARE_PRODUCT_ROUTE, element: <BareProductPath /> },
      { path: "*", element: <PlainShell><NotFound /></PlainShell> },
    ],
  },
] }]);

// A release that came while this page was open is loaded at the next screen, so this page's app does
// not go on reading a newer release's answers. A screen's query string changing is not a next screen.
let shownPath = router.state.location.pathname;
router.subscribe(({ location: { pathname } }) => {
  if (pathname !== shownPath) loadNewRelease();
  shownPath = pathname;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
