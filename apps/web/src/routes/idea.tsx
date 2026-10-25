import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IDEA_CARD_SANDBOX } from "@whatbuild/core/page-sandbox";
import { useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { attribution, plural, quotedAtEnd, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { PanelContext, PanelFilter, PanelSection } from "../shell/slots.tsx";
import { useScheme } from "../shell/theme.ts";
import { Button, ButtonLink, EmptyState, ErrorCallout, Glyph, Loading, Menu, MenuItem, MenuSeparator, StatusBadge, useToast } from "../ui/index.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import { FirstUse } from "./first-use.tsx";
import { PHONE_QUERY, useMediaQuery } from "../ui/media.ts";
import { useReorder } from "./idea-reorder.ts";
import "../styles/screens/idea.css";

/**
 * An outcome is current or archived, and points at nothing: assumptions, mockups and Story pages
 * point at it, and are read against it. Like the product concept, it is a card: a picture of it
 * (card_html, which the list gives only the length of) and, under More info, its text, the
 * description agents read. Agents write both, together; people read them, drag the outcomes into
 * order and retire them.
 */
interface Outcome {
  outcome_id: string;
  title: string;
  description: string;
  card_chars: number;
  position: number;
  archived_at: string | null;
  etag: string;
  updated_at: string;
  updated_by: { display_name?: string; surface?: string | null; client?: string | null } | null;
}

/**
 * How tall a card's picture shows: what it holds, between these. A taller picture scrolls inside
 * its card, except on a phone, where the kit's parts stack and a card is as tall as its picture: a
 * scroller inside the page's would trap a thumb.
 */
const ROOM = {
  concept: { min: 200, max: 560, start: 340 },
  outcome: { min: 160, max: 560, start: 260 },
} as const;

/**
 * The picture in its sandbox, as tall as what it holds (the card's own script says), within the
 * card's room. Until the frame has its document, skeleton lines stand in for it.
 */
function CardFront({ src, title, onHeight }: { src: string; title: string; onHeight: (h: number) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const report = useRef(onHeight);
  report.current = onHeight;
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { whatbuild?: unknown; height?: unknown } | null;
      if (data?.whatbuild === "card-height" && typeof data.height === "number" && Number.isFinite(data.height)) report.current(data.height);
    };
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, []);
  return (
    <>
      <iframe
        ref={frame}
        className="idea-card-frame"
        title={`Picture: ${title}`}
        sandbox={IDEA_CARD_SANDBOX}
        referrerPolicy="no-referrer"
        src={src}
        onLoad={() => setLoaded(true)}
      />
      {loaded ? null : (
        <div className="idea-card-status">
          <Loading variant="lines" lines={4} label="Loading the card…" />
        </div>
      )}
    </>
  );
}

/** A card with no picture yet: one line, and the request that gets one drawn. */
function NoFront({ ask }: { ask: string }) {
  const { canWrite } = useProduct();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      .writeText(ask)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
        toast("Copied. Paste it to your agent.");
      })
      .catch(() => toast("Couldn’t copy. Select the text and copy it.", { tone: "negative" }));
  return (
    <div className="idea-no-front">
      <p className="idea-no-front-title">No picture yet</p>
      {canWrite ? (
        <div className="idea-no-front-ask">
          <q className="idea-no-front-request">{ask}</q>
          <Button size="sm" icon={copied ? "check" : "copy"} onClick={copy} aria-label="Copy the request for your agent">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One card: its head (the title, More info and any tools), then, while More info is open, its text
 * in a well that scrolls within a set height, then its picture, always in view. The text unfolds
 * and folds back; a card with no picture yet opens on its text, shown at once.
 */
function IdeaCard({
  kind,
  title,
  heading,
  lead,
  status,
  tools,
  front,
  ask,
  back,
  meta,
  className = "",
  id,
  cardRef,
  headProps,
}: {
  kind: "concept" | "outcome";
  /** The card's name, for its controls and frame. */
  title: string;
  /** The heading in the head. */
  heading: (hid: string) => ReactNode;
  lead?: ReactNode;
  status?: ReactNode;
  tools?: ReactNode;
  /** The picture's address, or null when the card has none yet. */
  front: string | null;
  /** The request for an agent, on a card with no picture. */
  ask: string;
  /** The text, under More info. */
  back: ReactNode;
  meta?: ReactNode;
  className?: string;
  id?: string;
  cardRef?: Ref<HTMLElement>;
  /** What the head does besides holding the title and tools: an outcome's is where a drag starts. */
  headProps?: HTMLAttributes<HTMLElement>;
}) {
  const room = ROOM[kind];
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(!front);
  const [height, setHeight] = useState<number>(room.start);
  const hid = useId();
  const textId = useId();
  // A card that gains its first picture closes its text on it, once, unless someone opened or closed it.
  const touched = useRef(false);
  const hadFront = useRef(Boolean(front));
  useEffect(() => {
    if (front && !hadFront.current && !touched.current) setOpen(false);
    hadFront.current = Boolean(front);
  }, [front]);
  // The fold's height moves from wherever it is (a reversal mid-way included) to where the text
  // ends up, opening slower than it closes. A fold that opens or closes by itself just shows.
  const fold = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);
  const folding = useRef<Animation | null>(null);
  const toggle = () => {
    touched.current = true;
    from.current = fold.current?.getBoundingClientRect().height ?? null;
    folding.current?.cancel();
    setOpen((o) => !o);
  };
  useLayoutEffect(() => {
    const el = fold.current;
    const start = from.current;
    from.current = null;
    if (!el || start === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = el.getBoundingClientRect().height;
    const tokens = getComputedStyle(el);
    folding.current = el.animate([{ height: `${start}px` }, { height: `${end}px` }], {
      duration: parseFloat(tokens.getPropertyValue(open ? "--dur-4" : "--dur-3")) || 0,
      easing: tokens.getPropertyValue("--ease-fold").trim() || "ease-out",
    });
  }, [open]);
  const body = Math.min(phone ? Infinity : room.max, Math.max(room.min, height));
  return (
    <article ref={cardRef} id={id} className={`idea-card idea-card-${kind} ${className}`} aria-labelledby={hid}>
      <header className="idea-card-head" {...headProps}>
        {lead}
        <div className="idea-card-heading">{heading(hid)}</div>
        <div className="idea-card-tools">
          {status}
          <button type="button" className="btn btn-quiet btn-sm idea-more" aria-expanded={open} aria-controls={textId} onClick={toggle}>
            More info
            <Glyph name="chevron-down" size="sm" />
          </button>
          {tools}
        </div>
      </header>
      {/* The text unfolds from under the head and folds back into it, moving the picture with it. */}
      <div ref={fold} className="idea-card-more" data-open={open ? "" : undefined} inert={!open}>
        <div className="idea-card-text" id={textId} tabIndex={0} role="region" aria-label={`More about ${title}`}>
          {back}
          {meta ? <p className="idea-card-meta">{meta}</p> : null}
        </div>
      </div>
      {front ? (
        <div className="idea-card-body" style={{ height: body }}>
          <CardFront src={front} title={title} onHeight={setHeight} />
        </div>
      ) : (
        <NoFront ask={ask} />
      )}
    </article>
  );
}

function ConceptCard() {
  const { product, api: base } = useProduct();
  const scheme = useScheme();
  const front = product.card_chars ? `${base}/idea/concept/card${qs({ theme: scheme, v: product.etag })}` : null;
  return (
    <IdeaCard
      kind="concept"
      title="Product concept"
      heading={(hid) => (
        <h2 className="idea-card-title" id={hid}>
          Product concept
        </h2>
      )}
      front={front}
      ask={`Draw the picture on ${product.name}’s product concept card in WhatBuild.`}
      back={
        product.concept?.trim() ? (
          <Markdown source={product.concept} className="prose idea-card-prose" headingShift={2} />
        ) : (
          <p className="faint">No product concept yet.</p>
        )
      }
    />
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

/** What a deleted outcome's dialog says of the assumptions that serve it, which stay, unlinked from it. */
export function servedBy(n: number): string {
  return `${plural(n, "assumption")} ${n === 1 ? "serves" : "serve"} it, and will no longer be linked to it.`;
}

/** What deleting an outcome destroys, as outcomes.delete_impact reports it. */
interface OutcomeImpact {
  etag: string;
  assumptions: { id: string; statement: string }[];
}

export function IdeaPage() {
  const { product, api: base, app, canWrite, canDelete } = useProduct();
  const scheme = useScheme();
  const [deleting, setDeleting] = useState<Outcome | null>(null);
  const [params] = useSearchParams();
  const includeArchived = params.get("include_archived") === "1";
  // An outcome a search result opened (?outcome=<id>), scrolled to and marked.
  const found = params.get("outcome");
  const qc = useQueryClient();
  const toast = useToast();
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
      if (undo) toast(archived ? `Archived ${quotedAtEnd(o.title)}` : `Restored ${quotedAtEnd(o.title)}`, { action: { label: "Undo", onClick: () => setArchived.mutate({ o: next, archived: !archived }) } });
    },
    onError: failed,
  });
  const items = q.data?.items ?? [];
  useEffect(() => {
    if (found && q.data) document.getElementById(`outcome-${found}`)?.scrollIntoView({ block: "center" });
  }, [found, q.data]);
  // Outcomes are dragged into order, archived ones aside: with them listed, their places would mix in.
  const reorderable = canWrite && !includeArchived && items.length > 1;
  const byId = new Map(items.map((o) => [o.outcome_id, o]));
  const reorder = useReorder({
    ids: items.map((o) => o.outcome_id),
    version: q.dataUpdatedAt,
    enabled: reorderable,
    titleOf: (id) => byId.get(id)?.title ?? "",
    // A placed card takes a position between its new neighbours'.
    onPlace: (id, index, order) => {
      const o = byId.get(id);
      if (!o) return;
      const others = order.filter((x) => x !== id).map((x) => byId.get(x)!);
      const before = others[index - 1];
      const after = others[index];
      const position = before && after ? (before.position + after.position) / 2 : before ? before.position + 1 : after ? after.position - 1 : o.position;
      patch.mutate({ o, body: { position } });
    },
  });
  const shown = reorder.order.map((id) => byId.get(id)).filter((o): o is Outcome => Boolean(o));
  const hintId = useId();

  return (
    <div className="idea">
      <h1 className="visually-hidden">Idea</h1>
      <ConceptCard />
      <IdeaPanel includeArchived={includeArchived} />
      <section className="idea-outcomes" aria-labelledby="outcomes-h">
        <h2 className="idea-section-title" id="outcomes-h">
          Outcomes
          {q.data ? <span className="idea-section-count num">{items.length}</span> : null}
        </h2>
        {reorderable ? (
          <>
            <p id={hintId} className={reorder.lifted ? "idea-move-hint" : "visually-hidden"}>
              Arrow keys or a click on another card move it. Enter places it, Esc puts it back.
            </p>
            <p className="visually-hidden" aria-live="polite">
              {reorder.announcement}
            </p>
          </>
        ) : null}
        {q.isPending ? (
          <div className="idea-grid" aria-busy="true">
            {[0, 1].map((n) => (
              <div key={n} className="idea-card-skeleton">
                <Loading variant="lines" lines={4} label={n ? undefined : "Loading the outcomes…"} />
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <ErrorCallout error={q.error} onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <div className="sheet idea-empty">
            {q.data.archived_hidden ? (
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
                    ? `Propose outcomes for ${product.name} in WhatBuild from its product concept, and add the ones I agree to, each as a card with its picture and text.`
                    : `Interview me about ${product.name}, then write its product concept and outcomes in WhatBuild, each as a card with its picture and text.`
                }
              >
                An outcome is what the product&rsquo;s users should be able to achieve. Outcomes are the compass: the evidence, assumptions, mockups and Story are read against them.
              </FirstUse>
            )}
          </div>
        ) : (
          <ol ref={reorder.gridRef} className="idea-grid" data-reorderable={reorderable ? "" : undefined}>
            {shown.map((o, i) => (
              <li
                key={o.outcome_id}
                ref={reorder.itemRef(o.outcome_id)}
                className="idea-grid-item"
                data-dragging={reorder.dragging === o.outcome_id ? "" : undefined}
              >
                <IdeaCard
                  kind="outcome"
                  id={`outcome-${o.outcome_id}`}
                  cardRef={reorder.cardRef(o.outcome_id)}
                  className={`${o.archived_at ? "is-archived" : ""}${found === o.outcome_id ? " is-found" : ""}${reorder.dragging === o.outcome_id ? " is-dragging" : ""}${reorder.lifted === o.outcome_id ? " is-lifted" : ""}`}
                  title={o.title}
                  headProps={
                    reorderable
                      ? { onPointerDown: (e) => reorder.onPointerDown(o.outcome_id, e, "head"), onClick: (e) => reorder.onHeadClick(o.outcome_id, e) }
                      : undefined
                  }
                  lead={
                    reorderable ? (
                      // The number is the handle: drag it, or press it to pick the card up and move it with the arrow keys.
                      <button
                        type="button"
                        ref={reorder.gripRef(o.outcome_id)}
                        className="idea-card-grip num"
                        aria-label={`Move “${o.title}”, outcome ${i + 1} of ${shown.length}`}
                        aria-pressed={reorder.lifted === o.outcome_id}
                        aria-describedby={hintId}
                        title="Drag to move"
                        onPointerDown={(e) => reorder.onPointerDown(o.outcome_id, e, "grip")}
                        onClick={() => reorder.onGripClick(o.outcome_id)}
                        onKeyDown={(e) => reorder.onGripKeyDown(o.outcome_id, e)}
                      >
                        <Glyph name="grip" size="sm" />
                        <span className="idea-card-grip-n">{i + 1}</span>
                      </button>
                    ) : (
                      <span className="idea-card-index num" aria-hidden="true">
                        {i + 1}
                      </span>
                    )
                  }
                  heading={(hid) => (
                    <h3 className="idea-card-title" id={hid}>
                      <span className="visually-hidden">Outcome {i + 1}: </span>
                      {o.title}
                    </h3>
                  )}
                  status={o.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
                  front={o.card_chars ? `${base}/outcomes/${o.outcome_id}/card${qs({ theme: scheme, v: o.etag })}` : null}
                  ask={`Draw the picture on the outcome card “${o.title}” in WhatBuild.`}
                  back={
                    o.description.trim() ? (
                      <Markdown source={o.description} className="prose idea-card-prose" headingShift={3} />
                    ) : (
                      <p className="faint">No text yet.</p>
                    )
                  }
                  meta={
                    <>
                      Updated by {attribution(o.updated_by)}, <time dateTime={o.updated_at}>{relativeTime(o.updated_at)}</time>
                    </>
                  }
                  tools={
                    // Someone who cannot change outcomes here (a viewer, or anyone on an archived product) gets no menu of nothing.
                    canWrite ? (
                      <Menu label={`Actions for ${o.title}`} triggerClassName="icon-btn icon-btn-sm" trigger={<Glyph name="ellipsis" />} align="end">
                        {o.archived_at ? (
                          <MenuItem icon="archive-restore" onSelect={() => setArchived.mutate({ o, archived: false, undo: true })}>
                            Restore
                          </MenuItem>
                        ) : (
                          <MenuItem icon="archive" onSelect={() => setArchived.mutate({ o, archived: true, undo: true })}>
                            Archive
                          </MenuItem>
                        )}
                        {canDelete ? (
                          <>
                            <MenuSeparator />
                            <MenuItem icon="trash" tone="danger" onSelect={() => setDeleting(o)}>
                              Delete permanently…
                            </MenuItem>
                          </>
                        ) : null}
                      </Menu>
                    ) : null
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </section>
      {deleting ? (
        <DeleteDialog<OutcomeImpact>
          title="Delete this outcome permanently?"
          impactPath={`${base}/outcomes/${deleting.outcome_id}/delete-impact`}
          deletePath={`${base}/outcomes/${deleting.outcome_id}`}
          alternative={deleting.archived_at ? undefined : { label: "Archive instead", onSelect: () => setArchived.mutate({ o: deleting, archived: true, undo: true }) }}
          renderImpact={(i) => (
            <>
              <p>This deletes {quotedAtEnd(deleting.title).replace(/\.$/, "")} with its picture and text.</p>
              {i.assumptions.length ? <p>{servedBy(i.assumptions.length)}</p> : null}
            </>
          )}
          onDeleted={() => {
            refresh();
            toast(`Deleted ${quotedAtEnd(deleting.title)} The activity log records who, when and why.`);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
