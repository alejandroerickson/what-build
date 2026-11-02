import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

/**
 * The person's connected agents are account-wide, and three places ask about them: Connect an
 * agent lists them, and the first-use states and the panel's empty seat ask only whether there are
 * any. One query, one key, so a visit to Connect an agent that connects one is seen everywhere.
 */
export const AGENTS_KEY = ["agents"] as const;

/**
 * How many agents the person has connected, or undefined until the list has loaded.
 *
 * An agent is connected from its own client, outside this tab, so nothing here hears of it. While the
 * list is empty it is read again when the person comes back to the tab. Nothing polls, and coming back
 * reads nothing once there is an agent.
 */
export function useConnectedAgentCount(enabled = true): number | undefined {
  const q = useQuery({
    queryKey: AGENTS_KEY,
    enabled,
    queryFn: () => api<{ items: unknown[] }>("GET", "/api/v1/me/agents"),
    refetchOnWindowFocus: (query) => query.state.data?.items.length === 0,
  });
  return q.data?.items.length;
}

/** True once the list has loaded and holds no agent: the state the empty seat shows in. */
export function useHasNoAgent(enabled = true): boolean {
  return useConnectedAgentCount(enabled) === 0;
}
