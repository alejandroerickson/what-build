import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useRouteError } from "react-router";
import { ApiError, setUnauthenticatedHandler } from "./lib/api.ts";
import { ProductProvider, RequireSession } from "./lib/session.tsx";
import { AccountPage, ConnectPage } from "./routes/connect.tsx";
import { AcceptInvite, Home, SignIn } from "./routes/auth.tsx";
import { InsightEditPage, InsightPage, InsightsPage } from "./routes/insights.tsx";
import { ObjectivesPage } from "./routes/objectives.tsx";
import { MembersPage, ProductsPage, Welcome } from "./routes/org.tsx";
import { ActivityPage, ProductSettingsPage } from "./routes/product-misc.tsx";
import { RegisterEntryPage, RegisterListPage } from "./routes/registers.tsx";
import { SearchPage } from "./routes/search.tsx";
import { SourceDetailPage } from "./routes/source-detail.tsx";
import { SourceNewPage } from "./routes/source-new.tsx";
import { SourcesPage } from "./routes/sources.tsx";
import { StoryPage } from "./routes/story.tsx";
import { PlainShell, ProductShell } from "./shell/Shell.tsx";
import { ButtonLink, EmptyState, ToastProvider } from "./ui/index.tsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/screens.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status < 500 && e.status !== 0), staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

setUnauthenticatedHandler(() => {
  if (!location.pathname.startsWith("/signin")) location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
});

function RouteError() {
  const e = useRouteError() as Error;
  return (
    <div className="center-page stack">
      <h1>Something went wrong</h1>
      <p className="muted">{e?.message ?? "An unexpected error."}</p>
      <ButtonLink to="/">Go home</ButtonLink>
    </div>
  );
}

function ProductNotFound({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0;
  return (
    <PlainShell>
      <EmptyState title={status === 404 ? "This product does not exist, or you cannot see it" : "This product could not be loaded"} action={<ButtonLink to="/products">Your products</ButtonLink>}>
        {status === 404 ? "If you expected to see it, ask one of its admins to give you a role." : error instanceof Error ? error.message : null}
      </EmptyState>
    </PlainShell>
  );
}

const router = createBrowserRouter([
  { path: "/signin", element: <SignIn />, errorElement: <RouteError /> },
  {
    element: (
      <RequireSession>
        <Outlet />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/welcome", element: <Welcome /> },
      { path: "/invite/:token", element: <AcceptInvite /> },
      { element: <PlainShell><Outlet /></PlainShell>, children: [
        { path: "/products", element: <ProductsPage /> },
        { path: "/connect", element: <ConnectPage /> },
        { path: "/account", element: <AccountPage /> },
        { path: "/t/:tenant/members", element: <MembersPage /> },
      ] },
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
          { index: true, element: <Navigate to="objectives" replace /> },
          { path: "objectives", element: <ObjectivesPage /> },
          { path: "sources", element: <SourcesPage /> },
          { path: "sources/new", element: <SourceNewPage /> },
          { path: "sources/:recordId", element: <SourceDetailPage /> },
          { path: "search", element: <SearchPage /> },
          { path: "insights", element: <InsightsPage /> },
          { path: "insights/new", element: <InsightEditPage /> },
          { path: "insights/assumptions", element: <RegisterListPage kind="assumptions" /> },
          { path: "insights/assumptions/:id", element: <RegisterEntryPage kind="assumptions" /> },
          { path: "insights/decisions", element: <RegisterListPage kind="decisions" /> },
          { path: "insights/decisions/:id", element: <RegisterEntryPage kind="decisions" /> },
          { path: "insights/:insightId", element: <InsightPage /> },
          { path: "insights/:insightId/edit", element: <InsightEditPage /> },
          { path: "story", element: <StoryPage /> },
          { path: "story/:pageId", element: <StoryPage /> },
          { path: "activity", element: <ActivityPage /> },
          { path: "settings", element: <ProductSettingsPage /> },
        ],
      },
      { path: "*", element: <PlainShell><EmptyState title="Nothing lives here" action={<ButtonLink to="/">Go home</ButtonLink>} /></PlainShell> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
