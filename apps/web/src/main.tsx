import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/shell.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate, useParams, useRouteError } from "react-router";
import { ApiError, retryRead, setUnauthenticatedHandler } from "./lib/api.ts";
import { loadNewRelease, releasedSinceLoad } from "./lib/new-release.ts";
import { CurrentTenantAddress, productHome, ProductProvider, RequireSession, useProduct } from "./lib/session.tsx";
import { ConnectPage } from "./routes/connect.tsx";
import { CookiesPage } from "./routes/cookies.tsx";
import { PrivacyPage } from "./routes/privacy.tsx";
import { AcceptInvite, NotFound, NotVisible, SignIn } from "./routes/auth.tsx";
import { IdeaPage } from "./routes/idea.tsx";
import { MembersPage, Welcome } from "./routes/org.tsx";
import { OverviewPage } from "./routes/overview.tsx";
import { ActivityPage, ProductSettingsPage } from "./routes/product-misc.tsx";
import { EntryEditPage, RegisterEntryPage, RegisterListPage } from "./routes/registers.tsx";
import { LimitsPage } from "./routes/limits.tsx";
import { PeoplePage } from "./routes/people.tsx";
import { SearchPage } from "./routes/search.tsx";
import { InstancePage } from "./routes/instance.tsx";
import { AccountDeletedPage, DeleteAccountPage } from "./routes/delete-account.tsx";
import { SettingsPage } from "./routes/settings.tsx";
import { SourceDetailPage } from "./routes/source-detail.tsx";
import { SourceNewPage } from "./routes/source-new.tsx";
import { EvidencePage } from "./routes/evidence.tsx";
import { StoryPage } from "./routes/story.tsx";
import { ExplorationSection } from "./routes/exploration-panel.tsx";
import { MockupPage, MockupsIndex } from "./routes/mockups.tsx";
import { CookieNotice } from "./shell/CookieNotice.tsx";
import { PlainShell, ProductShell } from "./shell/Shell.tsx";
import { usePageTitle } from "./shell/slots.tsx";
import { Button, ButtonLink, EmptyState, Sheet, SheetHeader, ToastProvider, useToast } from "./ui/index.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: retryRead, staleTime: 10_000, refetchOnWindowFocus: false },
  },
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

function ProductNotFound({ error }: { error: unknown }) {
  return <PlainShell>{error instanceof ApiError && error.status === 404 ? <NotVisible what="product" /> : <ProductNotLoaded error={error} />}</PlainShell>;
}

function ProductNotLoaded({ error }: { error: unknown }) {
  usePageTitle("Product not loaded");
  return (
    <Sheet labelledBy="product-missing-title">
      <SheetHeader level={1} id="product-missing-title" title="This product couldn’t be loaded" />
      <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>}>
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

/**
 * A product's path typed or pasted without the /t/ prefix (organization/team/product) opens the
 * product rather than a dead end. A three-part path that starts with t/ is not a product.
 */
function BareProductPath() {
  const { tenant, team, product, "*": rest } = useParams();
  const { search, hash } = useLocation();
  if (tenant === "t")
    return (
      <PlainShell>
        <NotFound />
      </PlainShell>
    );
  return <Navigate replace to={`/t/${tenant}/${team}/${product}${rest ? `/${rest}` : ""}${search}${hash}`} />;
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

/** A product opens on Idea, or on the Story for a reader. */
function ProductHome() {
  const { product } = useProduct();
  return <Navigate to={productHome(product.your_role)} replace />;
}

/** Every screen of a product but the Story: a reader, who has only the Story, is taken there, with a toast saying why. */
function NotForStoryReaders() {
  const { app, storyOnly } = useProduct();
  return storyOnly ? <BackToStory to={`${app}/story`} /> : <Outlet />;
}

function BackToStory({ to }: { to: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const told = useRef(false);
  useEffect(() => {
    if (!told.current) toast("You can only read this product’s Story.");
    told.current = true;
    navigate(to, { replace: true });
  }, [navigate, to, toast]);
  return null;
}

/** Every screen, signed in or not, with the cookie notice in its corner until it is dismissed. */
function Root() {
  return (
    <>
      <Outlet />
      <CookieNotice />
    </>
  );
}

const router = createBrowserRouter([{ element: <Root />, errorElement: <RouteError />, children: [
  { path: "/signin", element: <SignIn />, errorElement: <RouteError /> },
  { path: "/cookies", element: <CookiesPage />, errorElement: <RouteError /> },
  { path: "/privacy", element: <PrivacyPage />, errorElement: <RouteError /> },
  { path: "/account-deleted", element: <AccountDeletedPage />, errorElement: <RouteError /> },
  // The public sandbox's invitation links are retired: one opens the app, where the example organization is.
  { path: "/join/:code", element: <Navigate to="/" replace />, errorElement: <RouteError /> },
  {
    element: (
      <RequireSession>
        <Outlet />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: [
      { path: "/welcome", element: <Welcome /> },
      { path: "/invite/:token", element: <AcceptInvite /> },
      { element: <PlainShell><Outlet /></PlainShell>, children: [
        { path: "/", element: <OverviewPage /> },
        { path: "/products", element: <ProductsRedirect /> },
        { path: "/connect", element: <ConnectPage /> },
        { path: "/settings", element: <SettingsPage /> },
        { path: "/settings/delete-account", element: <DeleteAccountPage /> },
        { path: "/instance", element: <InstancePage /> },
        { path: "/people", element: <PeoplePage /> },
        { path: "/t/:tenant/members", element: <CurrentTenantAddress><MembersPage /></CurrentTenantAddress> },
        { path: "/t/:tenant/limits", element: <CurrentTenantAddress><LimitsPage /></CurrentTenantAddress> },
      ] },
      ...devRoutes,
      {
        path: "/t/:tenant/:team/:product",
        element: (
          <CurrentTenantAddress>
            <ProductProvider fallback={(e) => <ProductNotFound error={e} />}>
              {(ctx) => (
                <ProductShell product={ctx.product} app={ctx.app}>
                  <Outlet />
                </ProductShell>
              )}
            </ProductProvider>
          </CurrentTenantAddress>
        ),
        children: [
          { index: true, element: <ProductHome /> },
          { path: "story", element: <StoryPage /> },
          { path: "story/:pageId", element: <StoryPage /> },
          {
            element: <NotForStoryReaders />,
            children: [
              { path: "idea", element: <IdeaPage /> },
              { path: "evidence", element: <EvidencePage /> },
              { path: "evidence/new", element: <SourceNewPage /> },
              { path: "evidence/:recordId", element: <SourceDetailPage /> },
              { path: "search", element: <SearchPage /> },
              { path: "synthesis/*", element: <SynthesisLink /> },
              {
                path: "exploration",
                element: <ExplorationSection />,
                children: [
                  { index: true, element: <Navigate to="mockups" replace /> },
                  { path: "mockups", element: <MockupsIndex /> },
                  { path: "mockups/:mockupId", element: <MockupPage /> },
                  { path: "assumptions", element: <RegisterListPage kind="assumptions" /> },
                  { path: "assumptions/new", element: <EntryEditPage kind="assumptions" /> },
                  { path: "assumptions/:id", element: <RegisterEntryPage kind="assumptions" /> },
                  { path: "assumptions/:id/edit", element: <EntryEditPage kind="assumptions" /> },
                  { path: "insights/*", element: <MovedToEvidence /> },
                  { path: "decisions/*", element: <MovedToEvidence /> },
                ],
              },
              { path: "connect", element: <ConnectPage /> },
              { path: "activity", element: <ActivityPage /> },
              { path: "settings", element: <ProductSettingsPage /> },
            ],
          },
        ],
      },
      { path: "/:tenant/:team/:product/*", element: <BareProductPath /> },
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
