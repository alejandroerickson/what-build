import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { attribution, formatCue, passageText, relativeTime } from "../lib/format.ts";
import { evidenceLinks, Markdown, mentionedSourceIds, mentionLabels, mentionText, passageHref, sourceMentions } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { useSourceTitles } from "../lib/source-titles.ts";
import type { Annotation, RecordFull, Segment } from "../lib/types.ts";
import { Button, ErrorCallout, FindField, IconButton, Loading, Sheet, SheetHeader, Tag, TextArea, TextField, useToast } from "../ui/index.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import "../styles/screens/evidence.css";

interface Passage {
  total_segments: number;
  segments: Segment[];
  out_of_range: boolean;
  warning: string | null;
}

const PAGE = 50;

/** "¶3" or "¶3–5": a passage address. */
export function address(start: number, end: number = start) {
  return start === end ? `¶${start}` : `¶${start}–${end}`;
}

/** Where a passage sits: the speaker and cue time, or the page. */
function who(s: Segment) {
  const at = s.start_ms !== null ? formatCue(s.start_ms) : s.page ? `p. ${s.page}` : null;
  return [s.speaker, at].filter(Boolean).join(" · ");
}

/** The first passage of the page that shows a range: its own page when the range fits one, else the range's start. */
function pageFor(lo: number, hi: number) {
  const aligned = Math.floor(lo / PAGE) * PAGE;
  return hi <= aligned + PAGE - 1 ? aligned : lo;
}

/** A table-row passage laid out in columns: the header row, or one row's cells under it. */
interface RowCells {
  head: boolean;
  cells: string[];
}

/**
 * Parsers store a table as one passage per row: the header as "A | B", each row as
 * "A: cell | B: cell" (a matrix row leads with its unlabelled name). A header followed by rows that
 * use its names is shown as a small table; each row stays its own passage, to select and comment on.
 * Anything that does not fit the pattern, or has more than six columns, reads as stored.
 */
function tableRows(segments: Segment[]): Map<number, RowCells> {
  const out = new Map<number, RowCells>();
  const plain = (s: Segment) => !s.speaker && !s.heading_level && s.start_ms === null && !s.text.includes("\n");
  for (let i = 0; i < segments.length; i++) {
    const h = segments[i]!;
    if (!plain(h)) continue;
    const head = h.text.split(" | ");
    if (head.length < 2 || head.length > 6 || head.some((c) => !c.trim() || c.length > 60)) continue;
    const rows: { seq: number; name: string | null; vals: Map<string, string> }[] = [];
    for (let j = i + 1; j < segments.length && plain(segments[j]!); j++) {
      const parts = segments[j]!.text.split(" | ");
      const vals = new Map<string, string>();
      let name: string | null = null;
      const fits = parts.every((p, k) => {
        const key = head.find((n) => p.startsWith(`${n}: `));
        if (key !== undefined && !vals.has(key)) return vals.set(key, p.slice(key.length + 2)), true;
        if (k === 0) return (name = p), true;
        return false;
      });
      if (!fits || !vals.size) break;
      rows.push({ seq: segments[j]!.seq, name, vals });
    }
    if (!rows.length) continue;
    const lead = rows.some((r) => r.name !== null);
    out.set(h.seq, { head: true, cells: lead ? ["", ...head] : head });
    for (const r of rows) out.set(r.seq, { head: false, cells: [...(lead ? [r.name ?? ""] : []), ...head.map((n) => r.vals.get(n) ?? "")] });
    i += rows.length;
  }
  return out;
}

/**
 * The passage reader: a window of passages by number, never the whole source. The URL holds the
 * position (?seq=N, and ?to=M for a range), so a search hit, a link or a comment opens exactly
 * where it points, with the whole range marked. Pick a passage (Shift for a range) to comment on it
 * or copy a reference to it for an agent.
 */
export function PassageReader({ record }: { record: RecordFull }) {
  const { api: base, app, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const total = record.segment_count;
  const clamp = (n: number) => Math.max(0, Math.min(total - 1, n));
  const raw = params.get("seq");
  const rawTo = params.get("to");
  const target = raw !== null && raw !== "" && !Number.isNaN(Number(raw)) ? clamp(Number(raw)) : null;
  const targetEnd = target !== null && rawTo !== null && rawTo !== "" && !Number.isNaN(Number(rawTo)) ? Math.max(target, clamp(Number(rawTo))) : target;
  const [start, setStart] = useState(() => (target !== null ? pageFor(target, targetEnd!) : 0));
  const [sel, setSel] = useState<{ a: number; b: number } | null>(target !== null ? { a: target, b: targetEnd! } : null);
  const [composing, setComposing] = useState(false);
  const [goto, setGoto] = useState("");
  const [find, setFind] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (target === null || targetEnd === null) return;
    setStart(pageFor(target, targetEnd));
    setSel({ a: target, b: targetEnd });
  }, [target, targetEnd]);
  const end = Math.min(total - 1, start + PAGE - 1);
  const q = useQuery({
    queryKey: ["passage", base, record.record_id, start, end],
    queryFn: () => api<Passage>("GET", `${base}/sources/${record.record_id}/passage${qs({ start, end, unit: "seq" })}`),
    enabled: total > 0,
    placeholderData: (prev) => prev,
  });
  useEffect(() => {
    if (target === null || !q.data) return;
    listRef.current?.querySelector<HTMLElement>(`[data-seq="${target}"]`)?.scrollIntoView({ block: "center" });
  }, [q.data, target]);
  const lo = sel ? Math.min(sel.a, sel.b) : null;
  const hi = sel ? Math.max(sel.a, sel.b) : null;
  const writable = canWrite && !record.archived_at;
  const jump = (seq: number) => {
    const next = new URLSearchParams(params);
    next.set("view", "passages");
    next.set("seq", String(Math.max(0, Math.min(total - 1, seq))));
    next.delete("tab");
    setParams(next, { replace: true });
  };
  const pick = (seq: number, extend: boolean) => {
    setComposing(false);
    if (extend && sel) return setSel({ a: sel.a, b: seq });
    if (sel && lo === hi && lo === seq) return setSel(null);
    if (sel && lo === hi && seq !== sel.a && Math.abs(seq - sel.a) <= 50) return setSel({ a: sel.a, b: seq });
    if (sel && lo !== null && hi !== null && seq >= lo && seq <= hi) return setSel(null);
    setSel({ a: seq, b: seq });
  };
  // Each comment sits under the last passage of its range that is on this page; a comment on a
  // range also tints every passage it covers.
  const byRow = new Map<number, Annotation[]>();
  const inRange = new Set<number>();
  for (const a of record.annotations) {
    if (a.seq_start === null || a.seq_end === null || a.seq_end < start || a.seq_start > end) continue;
    const at = Math.min(a.seq_end, end);
    byRow.set(at, [...(byRow.get(at) ?? []), a]);
    if (a.seq_end > a.seq_start) for (let n = Math.max(a.seq_start, start); n <= at; n++) inRange.add(n);
  }
  const segments = q.data?.segments ?? [];
  const table = tableRows(segments);
  // Passages that mention other sources by id (a view or a digest) read "Title ¶N" instead of a raw id.
  const mentionedIds = [...new Set(segments.flatMap((s) => mentionedSourceIds(s.text)))];
  const titles = useSourceTitles(base, mentionedIds);
  const evidence = { app, titles, labels: mentionLabels(mentionedIds, titles) };
  const searchThis = (e: FormEvent) => {
    e.preventDefault();
    if (find.trim()) navigate(`${app}/search?q=${encodeURIComponent(find.trim())}&record_id=${record.record_id}`);
  };
  if (!total) return null;
  const composeAt = composing && hi !== null ? Math.min(Math.max(hi, start), end) : null;
  const selectionBar =
    lo !== null && hi !== null && !composing ? (
      <div className="selection-bar" role="region" aria-label="Selected passages">
        <span className="small">
          <strong className="num">{address(lo, hi)}</strong> selected{hi - lo >= 50 ? ". A comment covers at most 50 passages." : "."}
        </span>
        <div className="row">
          {writable ? (
            <Button size="sm" variant="primary" icon="pencil" onClick={() => setComposing(true)} disabled={hi - lo >= 50}>
              Comment
            </Button>
          ) : null}
          <Button
            size="sm"
            icon="copy"
            onClick={() => {
              const ref = JSON.stringify({ record_id: record.record_id, seq_start: lo, seq_end: hi });
              navigator.clipboard
                .writeText(ref)
                .then(() => toast("Reference copied. Paste it to your agent."))
                .catch(() => toast("Couldn’t copy the reference.", { tone: "negative" }));
            }}
          >
            Copy reference
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setSel(null);
              setComposing(false);
            }}
          >
            Clear
          </Button>
        </div>
      </div>
    ) : null;
  return (
    <div className="passages">
      <Sheet className="passages-sheet" labelledBy="passages-h">
        <SheetHeader
          id="passages-h"
          title="Passages"
          count={total > PAGE ? `${address(start, end)} of ${total}` : total}
          end={
            <form role="search" className="passages-find" onSubmit={searchThis}>
              <FindField label="Search this source" value={find} onChange={(e) => setFind(e.target.value)} enterKeyHint="search" />
            </form>
          }
        />
        {q.isPending ? (
          <Loading label="Loading passages…" lines={6} />
        ) : q.isError ? (
          <div className="sheet-body">
            <ErrorCallout inset title="Passages couldn’t be loaded" error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : (
          <ol className="passage-list" ref={listRef} aria-busy={q.isFetching || undefined}>
            {q.data.segments.map((s) => {
              const selected = lo !== null && hi !== null && s.seq >= lo && s.seq <= hi;
              const targeted = target !== null && targetEnd !== null && s.seq >= target && s.seq <= targetEnd;
              const comments = byRow.get(s.seq) ?? [];
              const line = who(s);
              const row = table.get(s.seq);
              const mentions = sourceMentions(s.text);
              return (
                <li
                  key={s.seq}
                  data-seq={s.seq}
                  className={`passage${selected ? " passage-selected" : ""}${targeted ? " passage-target" : ""}${s.heading_level ? " passage-heading" : ""}${inRange.has(s.seq) ? " passage-commented" : ""}${row ? ` passage-row${row.head ? " passage-row-head" : ""}` : ""}`}
                >
                  <Link className="passage-addr num" to={`?view=passages&seq=${s.seq}`} replace aria-label={`Link to passage ${s.seq}`}>
                    ¶{s.seq}
                  </Link>
                  <div className="passage-body">
                    <button type="button" className="passage-select" aria-pressed={selected} onClick={(e) => pick(s.seq, e.shiftKey)}>
                      {line ? <span className="passage-who">{line}</span> : null}
                      {row ? (
                        <>
                          <span className="visually-hidden">{s.text}</span>
                          <span className="passage-cells" style={{ gridTemplateColumns: `repeat(${row.cells.length}, minmax(0, 1fr))` }} aria-hidden="true">
                            {row.cells.map((c, i) => (
                              <span key={i} className="passage-cell">
                                {c}
                              </span>
                            ))}
                          </span>
                        </>
                      ) : (
                        <span className="passage-text">{mentions.length ? evidenceLinks(s.text, `p${s.seq}`, evidence, false) : passageText(s.text, s.heading_level)}</span>
                      )}
                    </button>
                    {mentions.length ? (
                      <div className="passage-aids">
                        <span className="passage-mentions">
                          <span className="faint">Mentions</span>
                          {[...new Map(mentions.map((r) => [`${r.id}:${r.start}:${r.end}`, r])).values()].map((r) => (
                            <Link key={`${r.id}:${r.start}:${r.end}`} to={passageHref(app, r.id, r.start, r.end)} className="evidence-link" title={titles[r.id]}>
                              {mentionText(evidence.labels[r.id] ?? "Source", r.start, r.end)}
                            </Link>
                          ))}
                        </span>
                      </div>
                    ) : null}
                    {comments.length ? (
                      <ul className="passage-comments" aria-label={`Comments on passage ${s.seq}`}>
                        {comments.map((a) => (
                          <li key={a.annotation_id}>
                            <Comment annotation={a} showAddress={a.seq_start !== a.seq_end || a.seq_start !== s.seq} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {composeAt === s.seq && lo !== null && hi !== null ? (
                      <CommentForm recordId={record.record_id} seqStart={lo} seqEnd={hi} onDone={() => setComposing(false)} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {/* Docked above the pager, so it never covers Previous, Next or "Go to ¶". */}
        {selectionBar}
        {total > PAGE ? (
          <div className="passages-pager">
            <Button size="sm" icon="chevron-left" disabled={start === 0} onClick={() => setStart(Math.max(0, start - PAGE))}>
              Previous
            </Button>
            <span className="small faint num" aria-live="polite">
              {address(start, end)} of {total}
            </span>
            <Button size="sm" disabled={end >= total - 1} onClick={() => setStart(start + PAGE)}>
              Next
            </Button>
            <form
              className="passages-goto"
              onSubmit={(e) => {
                e.preventDefault();
                if (goto !== "") jump(Number(goto));
              }}
            >
              <label className="small faint" htmlFor="passages-goto">
                Go to ¶
              </label>
              <input id="passages-goto" className="input" type="number" inputMode="numeric" min={0} max={total - 1} value={goto} onChange={(e) => setGoto(e.target.value)} />
            </form>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

/** One person's comment on a source, optionally on a passage range. */
export function Comment({ annotation: a, showAddress, linkAddress }: { annotation: Annotation; showAddress?: boolean; linkAddress?: boolean }) {
  const { api: base, canDelete } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const addr = a.seq_start !== null && a.seq_end !== null ? address(a.seq_start, a.seq_end) : null;
  return (
    <article className="comment">
      <div className="comment-meta">
        <strong className="comment-author">{attribution(a.created_by)}</strong>
        <time dateTime={a.created_at}>{relativeTime(a.created_at)}</time>
        {showAddress && addr ? (
          linkAddress ? (
            <Link to={`?view=passages&seq=${a.seq_start}${a.seq_end !== a.seq_start ? `&to=${a.seq_end}` : ""}`} className="quiet-link num">
              {addr}
            </Link>
          ) : (
            <span className="num">{addr}</span>
          )
        ) : null}
        {!addr && showAddress ? <span>On the whole source</span> : null}
        {a.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
        {canDelete ? <IconButton size="sm" icon="trash" label="Delete this comment permanently" className="comment-delete" onClick={() => setDeleting(true)} /> : null}
      </div>
      <Markdown source={a.note} className="prose comment-text" headingShift={3} />
      {deleting ? (
        <DeleteDialog
          title="Delete this comment permanently?"
          etag={a.etag}
          deletePath={`${base}/annotations/${a.annotation_id}`}
          renderImpact={() => <p>This deletes the comment by {attribution(a.created_by)}, with its earlier text.</p>}
          onDeleted={() => {
            void qc.invalidateQueries({ queryKey: ["source", base, a.record_id] });
            toast("Comment deleted. The activity log records who, when and why.");
            setDeleting(false);
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </article>
  );
}

export function CommentForm({ recordId, seqStart, seqEnd, onDone }: { recordId: string; seqStart?: number; seqEnd?: number; onDone: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api("POST", `${base}/sources/${recordId}/annotations`, {
        note,
        ...(seqStart !== undefined ? { seq_start: seqStart, seq_end: seqEnd } : {}),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: async () => {
      toast("Comment added.");
      await qc.invalidateQueries({ queryKey: ["source", base, recordId] });
      onDone();
    },
  });
  return (
    <form
      className="comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <TextArea
        label={seqStart !== undefined ? `Comment on ${address(seqStart, seqEnd)}` : "Comment on the whole source"}
        required
        maxLength={2000}
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        autoFocus
      />
      <TextField label="Tags" optional hint="Comma-separated." value={tags} onChange={(e) => setTags(e.target.value)} />
      {save.isError ? <ErrorCallout inset error={save.error} /> : null}
      <div className="row">
        <Button type="submit" size="sm" variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!note.trim()}>
          Save comment
        </Button>
        <Button size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
