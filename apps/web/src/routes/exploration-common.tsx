import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api.ts";
import { attribution, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import type { Actor } from "../lib/types.ts";
import { AgentFace, Avatar, Button, Dialog, EmptyState, ErrorCallout, Loading, useToast } from "../ui/index.tsx";
import "../styles/screens/exploration.css";

/** `path` with the current params, some keys set or removed (an empty value removes it). */
export function searchWith(path: string, params: URLSearchParams, changes: Record<string, string | null | undefined>): string {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(changes)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  const s = next.toString();
  return s ? `${path}?${s}` : path;
}

/** A face (avatar, or the agent mark when it acted through an agent) and the name with its surface. */
export function Byline({ actor, agent }: { actor: Actor | null | undefined; agent?: boolean }) {
  const viaAgent = agent ?? actor?.surface === "mcp";
  return (
    <span className="entry-byline">
      {viaAgent ? <AgentFace /> : <Avatar name={actor?.display_name ?? "?"} />}
      <span>{attribution(actor)}</span>
    </span>
  );
}

/** Copies this page's address and says so. */
export function useCopyLink() {
  const toast = useToast();
  return () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast("Link copied."))
      .catch(() => toast("Couldn’t copy. Copy the link from the address bar.", { tone: "negative" }));
  };
}

interface RevisionRow {
  n: number;
  written_at: string;
  written_by: Actor;
  replaced_at: string;
  replaced_by: Actor;
}

/** The revision control for authored text that can be overwritten (an outcome's). */
export function HistoryDialog({ tool, id, etag, onClose, render }: {
  tool: "outcomes";
  id: string;
  etag: string;
  onClose: () => void;
  render: (content: Record<string, unknown>) => ReactNode;
}) {
  const { api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [n, setN] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["revisions", base, tool, id], queryFn: () => api<{ items: RevisionRow[] }>("GET", `${base}/${tool}/${id}/revisions`) });
  const one = useQuery({ queryKey: ["revision", base, tool, id, n], enabled: n !== null, queryFn: () => api<{ content: Record<string, unknown> }>("GET", `${base}/${tool}/${id}/revisions/${n}`) });
  const restore = useMutation({
    mutationFn: () => api("POST", `${base}/${tool}/${id}/revisions/${n}/restore`, { outcome_id: id, n, expected_etag: etag }),
    onSuccess: () => {
      toast("Version restored.");
      void qc.invalidateQueries();
      onClose();
    },
  });
  const items = list.data?.items ?? [];
  return (
    <Dialog
      open
      onClose={onClose}
      title="Earlier versions"
      description="Restoring one keeps the current text as an earlier version."
      wide
    >
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorCallout error={list.error} onRetry={() => list.refetch()} inset />
      ) : !items.length ? (
        <EmptyState size="inline">No earlier versions yet.</EmptyState>
      ) : (
        <div className="history">
          <ul className="history-list" aria-label="Versions">
            {items.map((r) => (
              <li key={r.n}>
                <button type="button" className="history-item" aria-pressed={n === r.n} onClick={() => setN(r.n)}>
                  <span className="history-item-title">Written by {attribution(r.written_by)}</span>
                  <span className="history-item-meta">
                    {relativeTime(r.written_at)} · replaced by {attribution(r.replaced_by)}, {relativeTime(r.replaced_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="history-view" aria-live="polite">
            {n === null ? (
              <p className="faint">Choose a version to read it.</p>
            ) : one.isPending ? (
              <Loading variant="lines" />
            ) : one.isError ? (
              <ErrorCallout error={one.error} inset />
            ) : (
              <div className="history-content">
                {one.data.content["title"] ? <h3 className="history-title">{String(one.data.content["title"])}</h3> : null}
                {render(one.data.content)}
                {canWrite ? (
                  <div className="history-actions">
                    <Button variant="primary" busy={restore.isPending} busyLabel="Restoring…" onClick={() => restore.mutate()}>
                      Restore this version
                    </Button>
                  </div>
                ) : null}
                {restore.isError ? <ErrorCallout error={restore.error} inset onRetry={() => void qc.invalidateQueries()} /> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
