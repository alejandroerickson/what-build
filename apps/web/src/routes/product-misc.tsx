import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import { formatBytes, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { ActivityFeed } from "../shell/ActivityFeed.tsx";
import { Button, Callout, Card, ErrorCallout, PageHeader, SelectField, TextField, useToast } from "../ui/index.tsx";

export function ActivityPage() {
  const [type, setType] = useState("");
  return (
    <div className="stack-lg">
      <PageHeader title="Activity" description="What changed in this product, who changed it, and whether an agent did the work." />
      <SelectField label="Show" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">All changes</option>
        <option value="source">Sources</option>
        <option value="objective">Objectives</option>
        <option value="insight">Insights</option>
        <option value="assumption">Assumptions</option>
        <option value="decision">Decisions</option>
        <option value="story_page">Story pages</option>
      </SelectField>
      <ActivityFeed entityType={type || undefined} />
    </div>
  );
}

export function ProductSettingsPage() {
  const { product, api: base, isAdmin } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(product.name);
  const [slug, setSlug] = useState(product.slug);
  const save = useMutation({
    mutationFn: () => api<{ path: string }>("PATCH", base, { expected_etag: product.etag, name, slug }),
    onSuccess: (p) => {
      toast("Saved.");
      void qc.invalidateQueries({ queryKey: ["products"] });
      if (slug !== product.slug) navigate(`/t/${p.path}/settings`, { replace: true });
      else void qc.invalidateQueries({ queryKey: ["product"] });
    },
  });
  const archive = useMutation({
    mutationFn: (restore: boolean) => api("POST", `${base}/${restore ? "restore" : "archive"}`, { expected_etag: product.etag }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["product"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
  return (
    <div className="stack-lg">
      <PageHeader title="Product settings" description={`${product.tenant.name} / ${product.team.name}`} />
      {!isAdmin ? <Callout tone="info">Only admins of this product can change its settings. You can read them.</Callout> : null}
      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} maxLength={100} />
          <TextField label="Short name in links" hint="Lower-case letters, digits and hyphens. Changing it changes this product's links." value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!isAdmin} pattern="[a-z0-9-]{3,50}" />
          {save.isError ? <ErrorCallout error={save.error} /> : null}
          {isAdmin ? (
            <div>
              <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
                Save
              </Button>
            </div>
          ) : null}
        </form>
      </Card>
      <ExportCard />
      {isAdmin ? (
        <Card>
          <div className="stack">
            <h2 style={{ fontSize: "var(--text-lg)" }}>{product.archived_at ? "Restore" : "Archive"} this product</h2>
            <p className="muted">
              {product.archived_at
                ? "Restoring puts it back in lists and makes it writable again."
                : "Archiving hides it from the product list and makes it read-only. Nothing inside it changes, and it still counts toward storage."}
            </p>
            {archive.isError ? <ErrorCallout error={archive.error} /> : null}
            <div>
              <Button onClick={() => archive.mutate(Boolean(product.archived_at))} busy={archive.isPending} busyLabel="Saving…">
                {product.archived_at ? "Restore product" : "Archive product"}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ExportCard() {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["exports", base],
    queryFn: () => api<{ items: { export_id: string; status: string; size: number | null; file_count: number | null; created_at: string; error: string | null }[] }>("GET", `${base}/exports`),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "pending") ? 1500 : false),
  });
  const start = useMutation({ mutationFn: () => api("POST", `${base}/exports`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ["exports", base] }) });
  return (
    <Card>
      <div className="stack">
        <h2 style={{ fontSize: "var(--text-lg)" }}>Export</h2>
        <p className="muted">
          Everything in this product as one ZIP: every source file and version, the parsed passages, notes, insights with their earlier versions, assumptions and decisions with their reviews, every Story version, and the activity log. Plain JSON, Markdown and HTML — readable without WhatBuild. Anyone with access can export, always.
        </p>
        {start.isError ? <ErrorCallout error={start.error} /> : null}
        <div>
          <Button onClick={() => start.mutate()} busy={start.isPending} busyLabel="Starting…">
            Export this product
          </Button>
        </div>
        {list.data?.items.length ? (
          <ul className="plain-list">
            {list.data.items.map((e) => (
              <li key={e.export_id} className="row small">
                <span>{relativeTime(e.created_at)}</span>
                {e.status === "ready" ? (
                  <a href={`${base}/exports/${e.export_id}/file`}>
                    Download ({formatBytes(e.size)}, {e.file_count} files)
                  </a>
                ) : e.status === "pending" ? (
                  <span className="muted">Building…</span>
                ) : (
                  <span style={{ color: "var(--danger)" }}>Failed: {e.error}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
