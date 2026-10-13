import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { plural } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { PanelContext, PanelFilter, PanelSection } from "../shell/slots.tsx";
import {
  Button, ButtonLink, Callout, EmptyState, ErrorCallout, FormGrid, Glyph, IconButton, Loading, Menu, MenuItem, MenuSeparator, Sheet,
  SheetBody, SheetHeader, StatusBadge, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import { DeleteDialog, Referring, type VersionReferring } from "./delete-dialog.tsx";
import { FirstUse } from "./first-use.tsx";
import { HistoryDialog } from "./exploration-common.tsx";
import "../styles/screens/idea.css";

/**
 * An outcome is current or archived, and points at nothing: assumptions, mockups and Story pages
 * point at it, and are read against it.
 */
interface Outcome {
  outcome_id: string;
  title: string;
  description: string;
  position: number;
  archived_at: string | null;
  etag: string;
}

function OutcomeForm({ initial, onDone, onCancel }: { initial?: Outcome; onDone: () => void; onCancel: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // After a 409 the latest version is loaded here; saving again writes over it, with the person's text kept.
  const [theirs, setTheirs] = useState<Outcome | null>(null);
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api("PATCH", `${base}/outcomes/${initial.outcome_id}`, { expected_etag: theirs?.etag ?? initial.etag, title, description })
        : api("POST", `${base}/outcomes`, { title, description }),
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
        <TextField label="Outcome" hint="What the product’s users should be able to achieve." required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <TextArea label="What success means" optional hint="What changes for the users when it’s achieved. The evidence belongs in sources and assumptions." maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormGrid>
      {stale ? (
        <Callout tone="attention" inset title="Someone changed this outcome while you were editing">
          {theirs ? (
            <>
              Their version: <strong>{theirs.title}</strong>. Your text is still here. Save again to replace theirs; their text is kept
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
  const [concept, setConcept] = useState(product.concept ?? "");
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
                setConcept(product.concept ?? "");
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
            <TextArea label="Product concept" hint="Who it’s for, their problem, and how the product solves it. Markdown." maxLength={2000} rows={4} value={concept} onChange={(e) => setConcept(e.target.value)} autoFocus />
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
            <p className="faint">No product concept yet.{canEdit ? null : " An admin of this product can write it."}</p>
          )}
        </SheetBody>
      )}
    </Sheet>
  );
}

/** Whether archived outcomes are listed too, as Evidence offers for sources. */
function IdeaPanel({ includeArchived }: { includeArchived: boolean }) {
  const { app } = useProduct();
  return (
    <PanelContext label="Filter outcomes">
      <PanelSection title="Archived">
        <PanelFilter to={`${app}/idea`} current={!includeArchived}>
          Hide archived
        </PanelFilter>
        <PanelFilter to={`${app}/idea?include_archived=1`} current={includeArchived}>
          Include archived
        </PanelFilter>
      </PanelSection>
    </PanelContext>
  );
}

/** What deleting an outcome destroys, as outcomes.delete_impact reports it. */
interface OutcomeImpact {
  etag: string;
  assumptions: { id: string; statement: string }[];
  story_versions_referring: (VersionReferring & { page_id: string })[];
  mockup_versions_referring: (VersionReferring & { mockup_id: string })[];
}

export function IdeaPage() {
  const { product, api: base, app, canWrite, canDelete } = useProduct();
  const [deleting, setDeleting] = useState<Outcome | null>(null);
  const [params] = useSearchParams();
  const includeArchived = params.get("include_archived") === "1";
  // An outcome a search result opened (?outcome=<id>), scrolled to and marked.
  const found = params.get("outcome");
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [history, setHistory] = useState<Outcome | null>(null);
  const q = useQuery({
    queryKey: ["outcomes", base, includeArchived],
    queryFn: () => api<{ items: Outcome[]; archived_hidden: number }>("GET", `${base}/outcomes${qs({ include_archived: includeArchived ? "true" : "" })}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["outcomes", base] });
    void qc.invalidateQueries({ queryKey: ["product"] });
  };
  const failed = (e: Error) => {
    refresh();
    toast(e instanceof ApiError && e.code === "stale_etag" ? "Someone changed that outcome just now. The list is reloaded; try again." : e.message, { tone: "negative" });
  };
  const patch = useMutation({
    mutationFn: ({ o, body }: { o: Outcome; body: Record<string, unknown> }) => api<Outcome>("PATCH", `${base}/outcomes/${o.outcome_id}`, { expected_etag: o.etag, ...body }),
    onSuccess: refresh,
    onError: failed,
  });
  const setArchived = useMutation({
    mutationFn: ({ o, archived }: { o: Outcome; archived: boolean; undo?: boolean }) =>
      api<Outcome>("POST", `${base}/outcomes/${o.outcome_id}/${archived ? "archive" : "restore"}`, { expected_etag: o.etag }),
    onSuccess: (next, { o, archived, undo }) => {
      refresh();
      if (undo) toast(archived ? `Archived “${o.title}”.` : `Restored “${o.title}”.`, { action: { label: "Undo", onClick: () => setArchived.mutate({ o: next, archived: !archived }) } });
    },
    onError: failed,
  });
  const items = q.data?.items ?? [];
  useEffect(() => {
    if (found && q.data) document.getElementById(`outcome-${found}`)?.scrollIntoView({ block: "center" });
  }, [found, q.data]);
  const reorderable = canWrite && !includeArchived;
  const moveTo = (o: Outcome, i: number, dir: -1 | 1) => {
    const j = i + dir;
    const beyond = items[j + dir];
    const position = beyond ? (items[j]!.position + beyond.position) / 2 : items[j]!.position + dir;
    patch.mutate({ o, body: { position } });
  };

  return (
    <>
      <ConceptSheet />
      <IdeaPanel includeArchived={includeArchived} />
      <Sheet labelledBy="outcomes-h" className="outcomes-sheet">
        <SheetHeader
          level={1}
          id="outcomes-h"
          title="Outcomes"
          count={q.data ? items.length : undefined}
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
          editing === "new" ? null : q.data.archived_hidden ? (
            <EmptyState
              size="inline"
              title="No current outcomes"
              action={<ButtonLink to={`${app}/idea?include_archived=1`} size="sm">Include {plural(q.data.archived_hidden, "archived outcome")}</ButtonLink>}
            />
          ) : (
            <FirstUse
              title="No outcomes yet"
              ask={
                product.concept?.trim()
                  ? `Propose outcomes for ${product.name} in WhatBuild from its product concept, and add the ones I agree to.`
                  : `Interview me about ${product.name}, then write its product concept and outcomes in WhatBuild.`
              }
            >
              An outcome is what the product&rsquo;s users should be able to achieve. Outcomes are the compass: the evidence, assumptions, mockups and Story are read against them.
            </FirstUse>
          )
        ) : (
          <ol className="outcome-list">
            {items.map((o, i) =>
              editing === o.outcome_id ? (
                <li key={o.outcome_id} className="outcome-editing">
                  <OutcomeForm initial={o} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li
                  key={o.outcome_id}
                  id={`outcome-${o.outcome_id}`}
                  className={`list-row outcome-row${o.archived_at ? " is-archived" : ""}${found === o.outcome_id ? " outcome-found" : ""}`}
                >
                  <div className="list-main">
                    <h2 className="outcome-title">{o.title}</h2>
                    {o.description ? <Markdown source={o.description} className="outcome-description" headingShift={3} /> : null}
                  </div>
                  <div className="outcome-side">
                    {o.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
                    {/* Someone who cannot change outcomes here (a viewer, or anyone on an archived product) gets the one thing they can do, not a menu of nothing. */}
                    {!canWrite ? (
                      <IconButton size="sm" icon="clock" label={`Earlier versions of ${o.title}`} onClick={() => setHistory(o)} />
                    ) : (
                    <Menu label={`Actions for ${o.title}`} triggerClassName="icon-btn icon-btn-sm" trigger={<Glyph name="ellipsis" />} align="end">
                      {canWrite && !o.archived_at ? (
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
                      <MenuItem icon="clock" onSelect={() => setHistory(o)}>
                        Earlier versions
                      </MenuItem>
                      {canWrite ? <MenuSeparator /> : null}
                      {canWrite && !o.archived_at ? (
                        <MenuItem icon="archive" onSelect={() => setArchived.mutate({ o, archived: true, undo: true })}>
                          Archive
                        </MenuItem>
                      ) : null}
                      {canWrite && o.archived_at ? (
                        <MenuItem icon="archive-restore" onSelect={() => setArchived.mutate({ o, archived: false, undo: true })}>
                          Restore
                        </MenuItem>
                      ) : null}
                      {canDelete ? (
                        <MenuItem icon="trash" tone="danger" onSelect={() => setDeleting(o)}>
                          Delete permanently…
                        </MenuItem>
                      ) : null}
                    </Menu>
                    )}
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
      </Sheet>
      {deleting ? (
        <DeleteDialog<OutcomeImpact>
          title="Delete this outcome permanently?"
          impactPath={`${base}/outcomes/${deleting.outcome_id}/delete-impact`}
          deletePath={`${base}/outcomes/${deleting.outcome_id}`}
          alternative={deleting.archived_at ? undefined : { label: "Archive instead", onSelect: () => setArchived.mutate({ o: deleting, archived: true, undo: true }) }}
          renderImpact={(i) => (
            <>
              <p>This deletes “{deleting.title}”.</p>
              {i.assumptions.length ? <p>{plural(i.assumptions.length, "assumption")} serve it, and will no longer be linked to it.</p> : null}
              <Referring story={i.story_versions_referring} mockups={i.mockup_versions_referring} />
            </>
          )}
          onDeleted={() => {
            refresh();
            toast(`Deleted “${deleting.title}”. The activity log records who, when and why.`);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
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
