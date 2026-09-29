import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { plural } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { toneFor } from "../lib/status.ts";
import {
  Button, ButtonLink, Callout, Chip, EmptyState, ErrorCallout, FormGrid, Glyph, Loading, Menu, MenuItem, MenuSeparator, Segmented, SelectField, Sheet,
  SheetBody, SheetHeader, StatusBadge, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import { HistoryDialog } from "./insights-common.tsx";
import "../styles/screens/idea.css";

interface Outcome {
  outcome_id: string;
  title: string;
  description: string;
  status: "active" | "achieved" | "archived";
  position: number;
  etag: string;
  counts: { insights: number; assumptions: number; decisions: number };
}

const STATUS_WORD: Record<Outcome["status"], string> = { active: "Active", achieved: "Achieved", archived: "Archived" };

const VIEWS = [
  // Active and achieved: archived outcomes have their own view.
  { id: "", label: "Current" },
  { id: "active", label: "Active" },
  { id: "achieved", label: "Achieved" },
  { id: "archived", label: "Archived" },
];

function OutcomeForm({ initial, onDone, onCancel }: { initial?: Outcome; onDone: () => void; onCancel: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<Outcome["status"]>(initial?.status ?? "active");
  // After a 409 the latest version is loaded here; saving again writes over it, with the person's text kept.
  const [theirs, setTheirs] = useState<Outcome | null>(null);
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api("PATCH", `${base}/outcomes/${initial.outcome_id}`, { expected_etag: theirs?.etag ?? initial.etag, title, description, status })
        : api("POST", `${base}/outcomes`, { title, description, status }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["outcomes", base] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      onDone();
    },
    onError: async (e) => {
      if (initial && e instanceof ApiError && e.code === "stale_etag") setTheirs(await api<Outcome>("GET", `${base}/outcomes/${initial.outcome_id}`).catch(() => null));
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  const headingId = `outcome-form-${initial?.outcome_id ?? "new"}`;
  return (
    <form
      className="outcome-form"
      aria-labelledby={headingId}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 className="outcome-form-title" id={headingId}>
        {initial ? "Edit outcome" : "New outcome"}
      </h2>
      <FormGrid>
        <TextField label="Outcome" hint="What the user achieves with the product, not a feature." required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <TextArea label="What success means" optional hint="Markdown: bold, lists and links." maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as Outcome["status"])}>
          <option value="active">Active</option>
          <option value="achieved">Achieved</option>
          {initial?.status === "archived" ? <option value="archived">Archived</option> : null}
        </SelectField>
      </FormGrid>
      {stale ? (
        <Callout tone="attention" inset title="Someone changed this outcome while you were editing">
          {theirs ? (
            <>
              Their version: <strong>{theirs.title}</strong> ({STATUS_WORD[theirs.status]}). Your text is still here. Save again to replace theirs; their text is kept
              in Earlier versions.
            </>
          ) : (
            "Your text is still here. Cancel to see their version, then make your change again."
          )}
        </Callout>
      ) : save.isError ? (
        <ErrorCallout error={save.error} inset />
      ) : null}
      <div className="outcome-form-actions">
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
          {stale && theirs ? "Save mine over theirs" : initial ? "Save changes" : "Add outcome"}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ConceptSheet() {
  const { product, api: base, isAdmin } = useProduct();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [concept, setConcept] = useState(product.concept);
  const save = useMutation({
    mutationFn: () => api("PATCH", base, { expected_etag: product.etag, concept }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["product"] });
      setEditing(false);
    },
  });
  const canEdit = isAdmin && !product.archived_at;
  return (
    <Sheet labelledBy="concept-h" className="idea-concept">
      <SheetHeader
        id="concept-h"
        title="Product concept"
        end={
          canEdit && !editing ? (
            <Button
              size="sm"
              icon="pencil"
              onClick={() => {
                setConcept(product.concept);
                setEditing(true);
              }}
            >
              {product.concept ? "Edit" : "Write the product concept"}
            </Button>
          ) : null
        }
      />
      {editing ? (
        <form
          className="outcome-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormGrid>
            <TextArea label="Product concept" hint="Who it is for, the problem they have, and how the product solves it. Markdown." maxLength={2000} rows={4} value={concept} onChange={(e) => setConcept(e.target.value)} autoFocus />
          </FormGrid>
          {save.isError ? <ErrorCallout error={save.error} inset onRetry={() => void qc.invalidateQueries({ queryKey: ["product"] })} /> : null}
          <div className="outcome-form-actions">
            <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
              Save the product concept
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <SheetBody>
          {product.concept ? (
            <Markdown source={product.concept} className="prose idea-concept-text" headingShift={2} />
          ) : (
            <p className="faint">No product concept written yet.{canEdit ? " Say who the product is for and the problem it solves." : " An admin of this product can write it."}</p>
          )}
        </SheetBody>
      )}
    </Sheet>
  );
}

function LinkedChips({ o }: { o: Outcome }) {
  const { app } = useProduct();
  const { insights, assumptions, decisions } = o.counts;
  if (!insights && !assumptions && !decisions) return <p className="outcome-none">Nothing points here yet.</p>;
  return (
    <div className="chips outcome-chips">
      {insights ? (
        <Chip to={`${app}/synthesis/insights?outcome_id=${o.outcome_id}`} icon="blend">
          {plural(insights, "insight")}
        </Chip>
      ) : null}
      {assumptions ? (
        <Chip to={`${app}/synthesis/assumptions?outcome_id=${o.outcome_id}`} icon="scale">
          {plural(assumptions, "assumption")}
        </Chip>
      ) : null}
      {decisions ? (
        <Chip to={`${app}/synthesis/decisions?outcome_id=${o.outcome_id}`} icon="signpost">
          {plural(decisions, "decision")}
        </Chip>
      ) : null}
    </div>
  );
}

export function IdeaPage() {
  const { product, api: base, app, canWrite } = useProduct();
  const [params] = useSearchParams();
  const status = params.get("status") ?? "";
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [history, setHistory] = useState<Outcome | null>(null);
  const q = useQuery({ queryKey: ["outcomes", base, status], queryFn: () => api<{ items: Outcome[] }>("GET", `${base}/outcomes${qs({ status })}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["outcomes", base] });
    void qc.invalidateQueries({ queryKey: ["product"] });
  };
  const patch = useMutation({
    mutationFn: ({ o, body }: { o: Outcome; body: Record<string, unknown>; undo?: Outcome["status"] }) =>
      api<Outcome>("PATCH", `${base}/outcomes/${o.outcome_id}`, { expected_etag: o.etag, ...body }),
    onSuccess: (next, { o, undo }) => {
      refresh();
      if (undo)
        toast(next.status === "archived" ? `Archived “${o.title}”.` : next.status === "achieved" ? `Marked “${o.title}” achieved.` : `“${o.title}” is active again.`, {
          action: { label: "Undo", onClick: () => patch.mutate({ o: next, body: { status: undo } }) },
        });
    },
    onError: (e) => {
      refresh();
      toast(e instanceof ApiError && e.code === "stale_etag" ? "Someone changed that outcome just now. The list is reloaded; try again." : (e as Error).message, { tone: "negative" });
    },
  });
  const items = q.data?.items ?? [];
  const reorderable = canWrite && !status;
  const moveTo = (o: Outcome, i: number, dir: -1 | 1) => {
    const j = i + dir;
    const beyond = items[j + dir];
    const position = beyond ? (items[j]!.position + beyond.position) / 2 : items[j]!.position + dir;
    patch.mutate({ o, body: { position } });
  };

  return (
    <>
      <ConceptSheet />
      <Sheet labelledBy="outcomes-h" className="outcomes-sheet">
        <SheetHeader
          level={1}
          id="outcomes-h"
          title="Outcomes"
          count={q.data ? items.length : undefined}
          filter={<Segmented label="Show" value={status} items={VIEWS.map((v) => ({ ...v, to: `${app}/idea${v.id ? `?status=${v.id}` : ""}` }))} />}
          end={
            canWrite && editing !== "new" ? (
              <Button icon="plus" onClick={() => setEditing("new")}>
                New outcome
              </Button>
            ) : null
          }
        />
        {editing === "new" ? <OutcomeForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)} /> : null}
        {q.isPending ? (
          <Loading lines={3} />
        ) : q.isError ? (
          <SheetBody>
            <ErrorCallout error={q.error} onRetry={() => q.refetch()} inset />
          </SheetBody>
        ) : !items.length ? (
          editing === "new" ? null : status ? (
            <EmptyState size="inline" title={`No ${STATUS_WORD[status as Outcome["status"]]?.toLowerCase() ?? ""} outcomes.`} action={<ButtonLink to={`${app}/idea`} size="sm">Show current outcomes</ButtonLink>} />
          ) : (
            <EmptyState
              size="inline"
              title="What should your users achieve?"
              action={canWrite ? <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Add the first outcome</Button> : null}
            >
              Write two or three outcomes: what the people this product serves should be able to achieve with it. Then add sources, and ask your agent to develop insights against them.
            </EmptyState>
          )
        ) : (
          <ol className="outcome-list">
            {items.map((o, i) =>
              editing === o.outcome_id ? (
                <li key={o.outcome_id} className="outcome-editing">
                  <OutcomeForm initial={o} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={o.outcome_id} className="list-row outcome-row">
                  <div className="list-main">
                    <h2 className="outcome-title">{o.title}</h2>
                    {o.description ? <Markdown source={o.description} className="outcome-description" headingShift={3} /> : null}
                    <LinkedChips o={o} />
                  </div>
                  <div className="outcome-side">
                    <StatusBadge tone={toneFor("outcome", o.status)}>{STATUS_WORD[o.status]}</StatusBadge>
                    <Menu label={`Actions for ${o.title}`} triggerClassName="icon-btn icon-btn-sm" trigger={<Glyph name="ellipsis" />} align="end">
                      {canWrite && o.status !== "archived" ? (
                        <MenuItem icon="pencil" onSelect={() => setEditing(o.outcome_id)}>
                          Edit
                        </MenuItem>
                      ) : null}
                      {reorderable ? (
                        <>
                          <MenuItem icon="chevron-up" disabled={i === 0} onSelect={() => moveTo(o, i, -1)}>
                            Move up
                          </MenuItem>
                          <MenuItem icon="chevron-down" disabled={i === items.length - 1} onSelect={() => moveTo(o, i, 1)}>
                            Move down
                          </MenuItem>
                        </>
                      ) : null}
                      {canWrite && o.status === "active" ? (
                        <MenuItem icon="circle-check" onSelect={() => patch.mutate({ o, body: { status: "achieved" }, undo: "active" })}>
                          Mark achieved
                        </MenuItem>
                      ) : null}
                      {canWrite && o.status === "achieved" ? (
                        <MenuItem icon="target" onSelect={() => patch.mutate({ o, body: { status: "active" }, undo: "achieved" })}>
                          Mark active again
                        </MenuItem>
                      ) : null}
                      <MenuItem icon="clock" onSelect={() => setHistory(o)}>
                        Earlier versions
                      </MenuItem>
                      {canWrite ? <MenuSeparator /> : null}
                      {canWrite && o.status !== "archived" ? (
                        <MenuItem icon="archive" onSelect={() => patch.mutate({ o, body: { status: "archived" }, undo: o.status })}>
                          Archive
                        </MenuItem>
                      ) : null}
                      {canWrite && o.status === "archived" ? (
                        <MenuItem icon="archive-restore" onSelect={() => patch.mutate({ o, body: { status: "active" }, undo: "archived" })}>
                          Restore
                        </MenuItem>
                      ) : null}
                    </Menu>
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
      </Sheet>
      {product.counts.sources === 0 && canWrite ? (
        <Callout tone="info" title="Next: add material" action={<ButtonLink to={`${app}/evidence/new`} size="sm">Add a source</ButtonLink>}>
          Interviews, calls, research exports, documents. Or connect an agent and let it do the uploading.
        </Callout>
      ) : null}
      {history ? (
        <HistoryDialog
          tool="outcomes"
          id={history.outcome_id}
          etag={items.find((o) => o.outcome_id === history.outcome_id)?.etag ?? history.etag}
          onClose={() => setHistory(null)}
          render={(c) => (c["description"] ? <Markdown source={String(c["description"])} /> : <p className="faint">No description.</p>)}
        />
      ) : null}
    </>
  );
}
