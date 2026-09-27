import { useQueries } from "@tanstack/react-query";
import { api } from "./api.ts";

/**
 * Titles for the sources a page cites, by id: one brief read per source, cached across pages. A
 * source that no longer resolves is left out, and its chip reads "Source".
 */
export function useSourceTitles(base: string, ids: string[]): Record<string, string | undefined> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["source-title", base, id],
      queryFn: () => api<{ title: string }>("GET", `${base}/sources/${id}`),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const out: Record<string, string | undefined> = {};
  ids.forEach((id, i) => (out[id] = results[i]?.data?.title));
  return out;
}
