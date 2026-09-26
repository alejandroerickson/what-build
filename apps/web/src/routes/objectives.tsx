import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { plural } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { Badge, Button, ButtonLink, Callout, EmptyState, ErrorCallout, Loading, PageHeader, SelectField, TextArea, TextField, useToast } from "../ui/index.tsx";

interface Objective {
  objective_id: string;
  title: string;
  description: string;
  status: "active" | "achieved" | "archived";
  position: number;
  etag: string;
  counts: { insights: number; assumptions: number; decisions: number };
}

function ObjectiveForm({ initial, onDone, onCancel }: { initial?: Objective; onDone: () => void; onCancel: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<Objective["status"]>(initial?.status ?? "active");
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api("PATCH", `${base}/objectives/${initial.objective_id}`, { expected_etag: initial.etag, title, description, status })
        : api("POST", `${base}/objectives`, { title, description, status }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["objectives", base] });
      onDone();
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 style={{ fontSize: "var(--text-lg)" }}>{initial ? "Edit objective" : "Add an objective"}</h2>
      <TextField label="Objective" hint="The outcome, not a task." required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <TextArea label="What success means" optional hint="Markdown: headings, bold, lists and links." maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as Objective["status"])}>
        <option value="active">Active</option>
        <option value="achieved">Achieved</option>
        <option value="archived">Archived</option>
      </SelectField>
      {stale ? (
        <Callout tone="warning" title="Someone changed this objective since you opened it" action={<Button size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ["objectives", base] }).then(onCancel)}>Reload it</Button>}>
          Your text is still here. Reload to see their version, then make your change again.
        </Callout>
      ) : save.isError ? (
        <ErrorCallout error={save.error} />
      ) : null}
      <div className="row">
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
          Save
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function IdeaBlock() {
  const { product, api: base, isAdmin } = useProduct();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [idea, setIdea] = useState(product.idea);
  const save = useMutation({
    mutationFn: () => api("PATCH", base, { expected_etag: product.etag, idea }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["product"] });
      setEditing(false);
    },
  });
  if (editing)
    return (
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextArea label="The idea" hint="What you think the product could be. Markdown." maxLength={2000} value={idea} onChange={(e) => setIdea(e.target.value)} autoFocus />
        {save.isError ? <ErrorCallout error={save.error} /> : null}
        <div className="row">
          <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
            Save the idea
          </Button>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form>
    );
  return (
    <section className="idea" aria-label="The idea">
      {product.idea ? <Markdown source={product.idea} className="prose idea-text" /> : <p className="muted">No idea written yet. Say what you think this product could be.</p>}
      {isAdmin && !product.archived_at ? (
        <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
          {product.idea ? "Edit the idea" : "Write the idea"}
        </Button>
      ) : null}
    </section>
  );
}

export function ObjectivesPage() {
  const { product, api: base, app, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const q = useQuery({ queryKey: ["objectives", base, status], queryFn: () => api<{ items: Objective[] }>("GET", `${base}/objectives${qs({ status })}`) });
  const move = useMutation({
    mutationFn: ({ o, position }: { o: Objective; position: number }) => api("PATCH", `${base}/objectives/${o.objective_id}`, { expected_etag: o.etag, position }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["objectives", base] }),
    onError: (e) => toast((e as Error).message, { tone: "danger" }),
  });
  const items = q.data?.items ?? [];
  return (
    <div className="stack-lg">
      <PageHeader
        title={product.name}
        description="The outcomes this discovery is working toward. Insights and agreements point back at them."
        actions={canWrite ? <Button variant="primary" onClick={() => setEditing("new")}>Add an objective</Button> : null}
      />
      <IdeaBlock />
      <div className="row-between">
        <h2>Objectives</h2>
        <SelectField label="Show" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">Active and achieved</option>
          <option value="active">Active</option>
          <option value="achieved">Achieved</option>
          <option value="archived">Archived</option>
        </SelectField>
      </div>
      {editing === "new" ? <ObjectiveForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)} /> : null}
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
      ) : !items.length ? (
        status ? (
          <EmptyState title="No objectives in this view" action={<Button onClick={() => setParams({})}>Show active objectives</Button>} />
        ) : (
          <EmptyState title="What are we working toward?" action={canWrite && editing !== "new" ? <Button variant="primary" onClick={() => setEditing("new")}>Add the first objective</Button> : null}>
            Write two or three outcomes this discovery should serve. Then add sources, and ask your agent to develop insights against them.
          </EmptyState>
        )
      ) : (
        <ol className="objective-list">
          {items.map((o, i) =>
            editing === o.objective_id ? (
              <li key={o.objective_id}>
                <ObjectiveForm initial={o} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={o.objective_id} className="card objective">
                <div className="row-between">
                  <h3>{o.title}</h3>
                  {o.status !== "active" ? <Badge tone={o.status === "achieved" ? "success" : "neutral"}>{o.status === "achieved" ? "Achieved" : "Archived"}</Badge> : null}
                </div>
                {o.description ? <Markdown source={o.description} className="prose small-prose" headingShift={3} /> : null}
                <div className="row-between">
                  <div className="row small">
                    <Link to={`${app}/insights?objective_id=${o.objective_id}`}>{plural(o.counts.insights, "insight")}</Link>
                    <span className="faint">·</span>
                    <Link to={`${app}/insights/assumptions?objective_id=${o.objective_id}`}>{plural(o.counts.assumptions, "assumption")}</Link>
                    <span className="faint">·</span>
                    <Link to={`${app}/insights/decisions?objective_id=${o.objective_id}`}>{plural(o.counts.decisions, "decision")}</Link>
                  </div>
                  {canWrite ? (
                    <div className="row">
                      <Button size="sm" variant="quiet" disabled={i === 0} onClick={() => move.mutate({ o, position: i === 1 ? items[0]!.position - 1 : (items[i - 1]!.position + items[i - 2]!.position) / 2 })} aria-label={`Move ${o.title} up`}>
                        Up
                      </Button>
                      <Button size="sm" variant="quiet" disabled={i === items.length - 1} onClick={() => move.mutate({ o, position: i === items.length - 2 ? items[items.length - 1]!.position + 1 : (items[i + 1]!.position + items[i + 2]!.position) / 2 })} aria-label={`Move ${o.title} down`}>
                        Down
                      </Button>
                      <Button size="sm" onClick={() => setEditing(o.objective_id)} aria-label={`Edit ${o.title}`}>
                        Edit
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ),
          )}
        </ol>
      )}
      {product.counts.sources === 0 && canWrite ? (
        <Callout tone="info" title="Next: add material" action={<ButtonLink to={`${app}/sources/new`}>Add a source</ButtonLink>}>
          Interviews, calls, research exports, documents. Or connect an agent and let it do the uploading.
        </Callout>
      ) : null}
    </div>
  );
}
