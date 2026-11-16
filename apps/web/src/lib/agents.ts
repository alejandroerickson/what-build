import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api.ts";

/**
 * The person's connected agents are account-wide, and several places ask about them: Connect an
 * agent lists them, and Connect your agent on Idea, the first-use states, the cards with no picture
 * and the panel's empty seat ask only whether there are any. One query, one key, so a visit to
 * Connect an agent that connects one is seen everywhere.
 */
export const AGENTS_KEY = ["agents"] as const;

/**
 * How many agents the person has connected, or undefined until the list has loaded.
 *
 * An agent is connected from its own client, outside this tab, so nothing here hears of it. While the
 * list is empty it is read again whenever the person comes back: to the tab (which the query's own
 * focus handling hears) or to the window, from an app beside the browser (which it does not), however
 * recently it was read. Nothing polls, and coming back reads nothing once there is an agent.
 */
export function useConnectedAgentCount(enabled = true): number | undefined {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: AGENTS_KEY,
    enabled,
    queryFn: () => api<{ items: unknown[] }>("GET", "/api/v1/me/agents"),
    refetchOnWindowFocus: (query) => (query.state.data?.items.length === 0 ? "always" : false),
  });
  const count = q.data?.items.length;
  useEffect(() => {
    if (!enabled || count !== 0) return;
    // Every place that asks listens; a read already under way is joined, not started again.
    const comeBack = () => void qc.refetchQueries({ queryKey: AGENTS_KEY, type: "active" }, { cancelRefetch: false });
    window.addEventListener("focus", comeBack);
    return () => window.removeEventListener("focus", comeBack);
  }, [enabled, count, qc]);
  return count;
}

/** True once the list has loaded and holds no agent: the state the empty seat shows in. */
export function useHasNoAgent(enabled = true): boolean {
  return useConnectedAgentCount(enabled) === 0;
}
