import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/shell.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate, useParams, useRouteError } from "react-router";
import { ApiError, setUnauthenticatedHandler } from "./lib/api.ts";
import { productHome, ProductProvider, RequireSession, useProduct } from "./lib/session.tsx";
import { ConnectPage } from "./routes/connect.tsx";
import { CookiesPage } from "./routes/cookies.tsx";
import { AcceptInvite, NotFound, SignIn } from "./routes/auth.tsx";
import { IdeaPage } from "./routes/idea.tsx";
import { MembersPage, Welcome } from "./routes/org.tsx";
import { OverviewPage } from "./routes/overview.tsx";
import { ActivityPage, ProductSettingsPage } from "./routes/product-misc.tsx";
import { EntryEditPage, RegisterEntryPage, RegisterListPage } from "./routes/registers.tsx";
import { JoinSandbox, SandboxPage } from "./routes/public-sandbox.tsx";
import { SearchPage } from "./routes/search.tsx";
import { InstancePage } from "./routes/instance.tsx";
import { SettingsPage } from "./routes/settings.tsx";
import { SourceDetailPage } from "./routes/source-detail.tsx";
import { SourceNewPage } from "./routes/source-new.tsx";
import { EvidencePage } from "./routes/evidence.tsx";
import { StoryPage } from "./routes/story.tsx";
import { ExplorationSection } from "./routes/exploration-panel.tsx";
import { MockupPage, MockupsIndex } from "./routes/mockups.tsx";
import { CookieNotice } from "./shell/CookieNotice.tsx";
import { PlainShell, ProductShell } from "./shell/Shell.tsx";
import { ButtonLink, EmptyState, Sheet, SheetHeader, ToastProvider, useToast } from "./ui/index.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status < 500 && e.status !== 0), staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

setUnauthenticatedHandler(() => {
  // The page behind a sandbox invitation says what it is before it asks anyone to sign in.
  if (!location.pathname.startsWith("/signin") && !location.pathname.startsWith("/join/")) location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
});

function RouteError() {
  const e = useRouteError() as Error;
  return (
    <div className="center-page stack">
      <h1>Something went wrong</h1>
      <p className="muted">{e?.message ?? "An unexpected error."} Reload the page, or go back to your products.</p>
      <ButtonLink to="/" variant="primary">Go to your products</ButtonLink>
    </div>
  );
}

/** The design system specimen: development builds only, so production bundles never include it. */
const devRoutes = import.meta.env.DEV
  ? [{ element: <PlainShell><Outlet /></PlainShell>, children: [{ path: "/_system", lazy: async () => ({ Component: (await import("./system/SystemPage.tsx")).SystemPage }) }] }]
  : [];

function ProductNotFound({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0;
  return (
    <PlainShell>
      <Sheet labelledBy="product-missing-title">
        <SheetHeader level={1} id="product-missing-title" title={status === 404 ? "This product does not exist, or you cannot see it" : "This product could not be loaded"} />
        <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>}>
          {status === 404 ? "If you expected to see it, ask one of its admins to give you a role." : error instanceof Error ? error.message : "Reload the page to try again."}
        </EmptyState>
      </Sheet>
    </PlainShell>
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
    if (!told.current) toast("You can read only this product’s Story, so it opened instead.");
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
  { path: "/join/:code", element: <JoinSandbox />, errorElement: <RouteError /> },
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
        { path: "/instance", element: <InstancePage /> },
        { path: "/t/:tenant/members", element: <MembersPage /> },
        { path: "/t/:tenant/sandbox", element: <SandboxPage /> },
      ] },
      ...devRoutes,
      {
        path: "/t/:tenant/:team/:product",
        element: (
          <ProductProvider fallback={(e) => <ProductNotFound error={e} />}>
            {(ctx) => (
              <ProductShell product={ctx.product} app={ctx.app}>
                <Outlet />
              </ProductShell>
            )}
          </ProductProvider>
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
