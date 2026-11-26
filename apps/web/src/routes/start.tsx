import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import type { Me } from "../lib/session.tsx";
import { Button, ErrorCallout, Loading } from "../ui/index.tsx";

/**
 * Start using WhatBuild, the public site's button, once signed in. Someone already in an organization goes to
 * the overview; someone who may start one, or for whom one of the day's places is open, goes to
 * start it, and uses the place only by starting it; anyone else is on the waitlist and goes to the
 * overview, which says their organization is on its way, with the demo to explore meanwhile.
 */
export function StartFree() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const asked = useRef(false);
  const start = useMutation({
    mutationFn: () => api<Me & { next: "in" | "start" | "waitlist" }>("POST", "/api/v1/me/start", {}),
    onSuccess: async ({ next, ...me }) => {
      qc.setQueryData(["me"], me);
      await qc.invalidateQueries({ queryKey: ["products"] });
      navigate(next === "start" ? "/welcome" : "/", { replace: true });
    },
  });
  // Once, even where React runs an effect twice.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    start.mutate();
  }, [start]);
  return (
    <div className="center-page">
      {start.isError ? (
        <div className="start-error">
          <ErrorCallout error={start.error} />
          <Button variant="primary" onClick={() => start.mutate()}>
            Try again
          </Button>
        </div>
      ) : (
        <Loading label="Getting your organization ready…" />
      )}
    </div>
  );
}
