import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api } from "../lib/api.ts";
import { pageView, startAnalytics, useCookieChoice } from "../lib/analytics.ts";
import { ButtonLink } from "../ui/index.tsx";
import { CookieChoice } from "./CookieChoice.tsx";

/** The deployment's Google Analytics measurement ID, null when it has none, undefined until known. */
export function useAnalyticsId(): string | null | undefined {
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ analytics_id?: string | null }>("GET", "/auth/methods"), staleTime: Infinity });
  return methods.isPending ? undefined : (methods.data?.analytics_id ?? null);
}

/**
 * The app's cookie choice, on every screen until the person accepts or declines, and analytics
 * behind it: loaded once they accept, with a page view for each screen they open. The app works
 * the same either way. A deployment without analytics has nothing to ask, so it shows nothing.
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
    if (on) pageView(pathname);
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
