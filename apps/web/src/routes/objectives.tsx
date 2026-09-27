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
import "../styles/screens/objectives.css";

interface Objective {
  objective_id: string;
  title: string;
  description: string;
  status: "active" | "achieved" | "archived";
  position: number;
  etag: string;
  counts: { insights: number; assumptions: number; decisions: number };
}

const STATUS_WORD: Record<Objective["status"], string> = { active: "Active", achieved: "Achieved", archived: "Archived" };

const VIEWS = [
  // Active and achieved: archived objectives have their own view.
  { id: "", label: "Current" },
  { id: "active", label: "Active" },
  { id: "achieved", label: "Achieved" },
  { id: "archived", label: "Archived" },
];

function ObjectiveForm({ initial, onDone, onCancel }: { initial?: Objective; onDone: () => void; onCancel: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<Objective["status"]>(initial?.status ?? "active");
  // After a 409 the latest version is loaded here; saving again writes over it, with the person's text kept.
  const [theirs, setTheirs] = useState<Objective | null>(null);
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api("PATCH", `${base}/objectives/${initial.objective_id}`, { expected_etag: theirs?.etag ?? initial.etag, title, description, status })
        : api("POST", `${base}/objectives`, { title, description, status }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["objectives", base] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      onDone();
    },
    onError: async (e) => {
      if (initial && e instanceof ApiError && e.code === "stale_etag") setTheirs(await api<Objective>("GET", `${base}/objectives/${initial.objective_id}`).catch(() => null));
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  const headingId = `objective-form-${initial?.objective_id ?? "new"}`;
  return (
    <form
      className="objective-form"
      aria-labelledby={headingId}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 className="objective-form-title" id={headingId}>
        {initial ? "Edit objective" : "New objective"}
      </h2>
      <FormGrid>
        <TextField label="Objective" hint="The outcome, not a task." required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <TextArea label="What success means" optional hint="Markdown: bold, lists and links." maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as Objective["status"])}>
          <option value="active">Active</option>
          <option value="achieved">Achieved</option>
          {initial?.status === "archived" ? <option value="archived">Archived</option> : null}
        </SelectField>
      </FormGrid>
      {stale ? (
        <Callout tone="attention" inset title="Someone changed this objective while you were editing">
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
      <div className="objective-form-actions">
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
          {stale && theirs ? "Save mine over theirs" : initial ? "Save changes" : "Add objective"}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function IdeaSheet() {
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
  const canEdit = isAdmin && !product.archived_at;
  return (
    <Sheet labelledBy="idea-h" className="objectives-idea">
      <SheetHeader
        id="idea-h"
        title="The idea"
        end={
          canEdit && !editing ? (
            <Button
              size="sm"
              icon="pencil"
              onClick={() => {
                setIdea(product.idea);
                setEditing(true);
              }}
            >
              {product.idea ? "Edit" : "Write the idea"}
            </Button>
          ) : null
        }
      />
      {editing ? (
        <form
          className="objective-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormGrid>
            <TextArea label="The idea" hint="What you think this product could be. Markdown." maxLength={2000} rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} autoFocus />
          </FormGrid>
          {save.isError ? <ErrorCallout error={save.error} inset onRetry={() => void qc.invalidateQueries({ queryKey: ["product"] })} /> : null}
          <div className="objective-form-actions">
            <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
              Save the idea
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <SheetBody>
          {product.idea ? (
            <Markdown source={product.idea} className="prose objectives-idea-text" headingShift={2} />
          ) : (
            <p className="faint">No idea written yet.{canEdit ? " Say what you think this product could be." : " An admin of this product can write it."}</p>
          )}
        </SheetBody>
      )}
    </Sheet>
  );
}

function LinkedChips({ o }: { o: Objective }) {
  const { app } = useProduct();
  const { insights, assumptions, decisions } = o.counts;
  if (!insights && !assumptions && !decisions) return <p className="objective-none">Nothing points here yet.</p>;
  return (
    <div className="chips objective-chips">
      {insights ? (
        <Chip to={`${app}/synthesis/insights?objective_id=${o.objective_id}`} icon="lightbulb">
          {plural(insights, "insight")}
        </Chip>
      ) : null}
      {assumptions ? (
        <Chip to={`${app}/synthesis/assumptions?objective_id=${o.objective_id}`} icon="scale">
          {plural(assumptions, "assumption")}
        </Chip>
      ) : null}
      {decisions ? (
        <Chip to={`${app}/synthesis/decisions?objective_id=${o.objective_id}`} icon="signpost">
          {plural(decisions, "decision")}
        </Chip>
      ) : null}
    </div>
  );
}

export function ObjectivesPage() {
  const { product, api: base, app, canWrite } = useProduct();
  const [params] = useSearchParams();
  const status = params.get("status") ?? "";
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [history, setHistory] = useState<Objective | null>(null);
  const q = useQuery({ queryKey: ["objectives", base, status], queryFn: () => api<{ items: Objective[] }>("GET", `${base}/objectives${qs({ status })}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["objectives", base] });
    void qc.invalidateQueries({ queryKey: ["product"] });
  };
  const patch = useMutation({
    mutationFn: ({ o, body }: { o: Objective; body: Record<string, unknown>; undo?: Objective["status"] }) =>
      api<Objective>("PATCH", `${base}/objectives/${o.objective_id}`, { expected_etag: o.etag, ...body }),
    onSuccess: (next, { o, undo }) => {
      refresh();
      if (undo)
        toast(next.status === "archived" ? `Archived “${o.title}”.` : next.status === "achieved" ? `Marked “${o.title}” achieved.` : `“${o.title}” is active again.`, {
          action: { label: "Undo", onClick: () => patch.mutate({ o: next, body: { status: undo } }) },
        });
    },
    onError: (e) => {
      refresh();
      toast(e instanceof ApiError && e.code === "stale_etag" ? "Someone changed that objective just now. The list is reloaded; try again." : (e as Error).message, { tone: "negative" });
    },
  });
  const items = q.data?.items ?? [];
  const reorderable = canWrite && !status;
  const moveTo = (o: Objective, i: number, dir: -1 | 1) => {
    const j = i + dir;
    const beyond = items[j + dir];
    const position = beyond ? (items[j]!.position + beyond.position) / 2 : items[j]!.position + dir;
    patch.mutate({ o, body: { position } });
  };

  return (
    <>
      <IdeaSheet />
      <Sheet labelledBy="objectives-h" className="objectives-sheet">
        <SheetHeader
          level={1}
          id="objectives-h"
          title="Objectives"
          count={q.data ? items.length : undefined}
          filter={<Segmented label="Show" value={status} items={VIEWS.map((v) => ({ ...v, to: `${app}/objectives${v.id ? `?status=${v.id}` : ""}` }))} />}
          end={
            canWrite && editing !== "new" ? (
              <Button icon="plus" onClick={() => setEditing("new")}>
                New objective
              </Button>
            ) : null
          }
        />
        {editing === "new" ? <ObjectiveForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)} /> : null}
        {q.isPending ? (
          <Loading lines={3} />
        ) : q.isError ? (
          <SheetBody>
            <ErrorCallout error={q.error} onRetry={() => q.refetch()} inset />
          </SheetBody>
        ) : !items.length ? (
          editing === "new" ? null : status ? (
            <EmptyState size="inline" title={`No ${STATUS_WORD[status as Objective["status"]]?.toLowerCase() ?? ""} objectives.`} action={<ButtonLink to={`${app}/objectives`} size="sm">Show current objectives</ButtonLink>} />
          ) : (
            <EmptyState
              size="inline"
              title="What are we working toward?"
              action={canWrite ? <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Add the first objective</Button> : null}
            >
              Write two or three outcomes this discovery should serve. Then add sources, and ask your agent to develop insights against them.
            </EmptyState>
          )
        ) : (
          <ol className="objective-list">
            {items.map((o, i) =>
              editing === o.objective_id ? (
                <li key={o.objective_id} className="objective-editing">
                  <ObjectiveForm initial={o} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={o.objective_id} className="list-row objective-row">
                  <div className="list-main">
                    <h2 className="objective-title">{o.title}</h2>
                    {o.description ? <Markdown source={o.description} className="objective-description" headingShift={3} /> : null}
                    <LinkedChips o={o} />
                  </div>
                  <div className="objective-side">
                    <StatusBadge tone={toneFor("objective", o.status)}>{STATUS_WORD[o.status]}</StatusBadge>
                    <Menu label={`Actions for ${o.title}`} triggerClassName="icon-btn icon-btn-sm" trigger={<Glyph name="ellipsis" />} align="end">
                      {canWrite && o.status !== "archived" ? (
                        <MenuItem icon="pencil" onSelect={() => setEditing(o.objective_id)}>
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
          tool="objectives"
          id={history.objective_id}
          etag={items.find((o) => o.objective_id === history.objective_id)?.etag ?? history.etag}
          onClose={() => setHistory(null)}
          render={(c) => (c["description"] ? <Markdown source={String(c["description"])} /> : <p className="faint">No description.</p>)}
        />
      ) : null}
    </>
  );
}
