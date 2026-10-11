import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api } from "../lib/api.ts";
import { pageView, placePage, startAnalytics, useCookieChoice } from "../lib/analytics.ts";
import { ButtonLink } from "../ui/index.tsx";
import { CookieChoice } from "./CookieChoice.tsx";

/** How long a screen stays before its page view is sent. */
const SETTLED_MS = 700;

/** The deployment's Google Analytics measurement ID, null when it has none, undefined until known. */
export function useAnalyticsId(): string | null | undefined {
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ analytics_id?: string | null }>("GET", "/auth/methods"), staleTime: Infinity });
  return methods.isPending ? undefined : (methods.data?.analytics_id ?? null);
}

/**
 * The app's cookie choice, on every screen until the person accepts or declines, and analytics
 * behind it: loaded once they accept, with a page view for each screen they open. The app works
 * the same either way. A deployment without analytics has nothing to ask, so it shows nothing; nor
 * does the server give the ID to the instance's owners, or on another address for the service.
 * `/cookies` explains, and changes the choice later.
 */
export function CookieNotice() {
  const id = useAnalyticsId();
  const choice = useCookieChoice();
  const { pathname } = useLocation();
  const on = Boolean(id) && choice === "accepted";
  useEffect(() => {
    if (on && id) startAnalytics(id);
  }, [on, id]);
  useEffect(() => {
    if (!on) return;
    // The masked address goes on every event at once; the page view waits until the screen has
    // stayed a moment, so an old address that only sends the person on (a renamed screen, a product
    // path without /t/) is never counted as a screen of its own.
    placePage(pathname);
    const counting = setTimeout(() => pageView(pathname), SETTLED_MS);
    return () => clearTimeout(counting);
  }, [on, pathname]);
  if (!id) return null;
  return (
    <CookieChoice
      lead="Cookies keep you signed in."
      ask="Can we also use analytics cookies to see how WhatBuild is used?"
      link={
        pathname === "/cookies" ? null : (
          <ButtonLink to="/cookies" size="sm" variant="quiet">
            Cookies
          </ButtonLink>
        )
      }
    />
  );
}
