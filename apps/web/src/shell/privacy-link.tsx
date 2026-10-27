import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";

/**
 * The link to the privacy page, which is a page of the public site and not a screen of the app
 * ([decision](okf/decisions/the-privacy-page-is-a-page-of-the-public-site.md)). Its address is the
 * deployment's (`privacy_url` in `/api/v1/meta`), and it opens in a new tab, leaving the app where it was.
 */
export function PrivacyLink() {
  const url = useQuery({ queryKey: ["meta"], queryFn: () => api<{ privacy_url?: string }>("GET", "/api/v1/meta"), staleTime: Infinity }).data?.privacy_url;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      Privacy
    </a>
  );
}
