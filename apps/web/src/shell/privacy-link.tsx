import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";

/** What only the deployment knows of itself and the app links to (`GET /api/v1/meta`). */
export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<{ privacy_url?: string; site_url?: string | null }>("GET", "/api/v1/meta"), staleTime: Infinity });
}

/**
 * The public site's own address (WHATBUILD_SITE_URL), where its waitlist form is, or null on a
 * deployment without one.
 */
export function useSiteUrl(): string | null {
  return useMeta().data?.site_url ?? null;
}

/**
 * The link to the privacy page, which is a page of the public site and not a screen of the app
 * ([decision](okf/decisions/the-privacy-page-is-a-page-of-the-public-site.md)). Its address is the
 * deployment's (`privacy_url` in `/api/v1/meta`), and it opens in a new tab, leaving the app where it was.
 */
export function PrivacyLink() {
  const url = useMeta().data?.privacy_url;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      Privacy
    </a>
  );
}
