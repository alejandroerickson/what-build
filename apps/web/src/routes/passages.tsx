import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { formatCue } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import type { RecordFull, Segment } from "../lib/types.ts";
import { Button, ErrorCallout, Loading, TextArea, TextField, useToast } from "../ui/index.tsx";

interface Passage {
  total_segments: number;
  segments: Segment[];
  out_of_range: boolean;
  warning: string | null;
}

/**
 * The passage reader: pages of segments by number, never the whole source. The URL holds the
 * position (?seq=N), so a search hit, a citation or a note opens exactly where it points.
 */
export function PassageReader({ record }: { record: RecordFull }) {
  const { api: base, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const total = record.segment_count;
  const [size, setSize] = useState(25);
  const target = params.get("seq") !== null ? Number(params.get("seq")) : null;
  const [start, setStart] = useState(() => (target !== null ? Math.floor(target / 25) * 25 : 0));
  const [sel, setSel] = useState<{ a: number; b: number } | null>(target !== null ? { a: target, b: target } : null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [goto, setGoto] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (target !== null && !Number.isNaN(target)) {
      setStart(Math.floor(target / size) * size);
      setSel({ a: target, b: target });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const end = Math.min(total - 1, start + size - 1);
  const q = useQuery({
    queryKey: ["passage", base, record.record_id, start, end],
    queryFn: () => api<Passage>("GET", `${base}/sources/${record.record_id}/passage${qs({ start, end, unit: "seq" })}`),
    enabled: total > 0,
    placeholderData: (prev) => prev,
  });
  useEffect(() => {
    if (target === null || !q.data) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seq="${target}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [q.data, target]);
  const lo = sel ? Math.min(sel.a, sel.b) : null;
  const hi = sel ? Math.max(sel.a, sel.b) : null;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.floor(start / size) + 1;
  const jump = (seq: number) => {
    const s = Math.max(0, Math.min(total - 1, seq));
    const next = new URLSearchParams(params);
    next.set("seq", String(s));
    next.set("tab", "passages");
    setParams(next, { replace: true });
  };
  const click = (seq: number) => {
    if (!sel || lo === null || hi === null) setSel({ a: seq, b: seq });
    else if (sel.a === sel.b && seq !== sel.a) setSel({ a: sel.a, b: seq });
    else if (seq >= lo && seq <= hi) setSel(null);
    else setSel({ a: seq, b: seq });
  };
  if (!total) return null;
  return (
    <div className="reader stack">
      <div className="reader-bar">
        <span className="small" aria-live="polite">
          Segments {start}–{end} of {total}
        </span>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (goto !== "") jump(Number(goto));
          }}
        >
          <TextField label="Go to segment" type="number" min={0} max={total - 1} value={goto} onChange={(e) => setGoto(e.target.value)} style={{ width: "6rem" }} />
        </form>
        <label className="small row">
          Per page
          <select className="input select" style={{ width: "auto" }} value={size} onChange={(e) => {
            const s = Number(e.target.value);
            setSize(s);
            setStart(Math.floor(start / s) * s);
          }}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <div className="row">
          <Button size="sm" disabled={start === 0} onClick={() => setStart(Math.max(0, start - size))} aria-label="Previous segments">
            Previous
          </Button>
          <span className="small num">
            {page} / {pages}
          </span>
          <Button size="sm" disabled={end >= total - 1} onClick={() => setStart(start + size)} aria-label="Next segments">
            Next
          </Button>
        </div>
      </div>
      {q.isPending ? (
        <Loading label="Loading passages…" lines={8} />
      ) : q.isError ? (
        <ErrorCallout title="This passage could not be loaded" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ol className="segments" ref={listRef} start={start}>
          {q.data.segments.map((s) => {
            const selected = lo !== null && hi !== null && s.seq >= lo && s.seq <= hi;
            return (
              <li key={s.seq} data-seq={s.seq} className={`segment ${selected ? "segment-selected" : ""} ${s.heading_level ? "segment-heading" : ""} ${target === s.seq ? "segment-target" : ""}`}>
                <button type="button" className="segment-btn" aria-pressed={selected} onClick={() => click(s.seq)}>
                  <span className="segment-meta">
                    <span className="num">{s.seq}</span>
                    {s.start_ms !== null ? <span className="num">{formatCue(s.start_ms)}</span> : s.page ? <span>p. {s.page}</span> : null}
                    {s.speaker ? <span className="segment-speaker">{s.speaker}</span> : null}
                  </span>
                  <span className="segment-text">{s.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {lo !== null && hi !== null ? (
        <div className="selection-bar" role="region" aria-label="Selected passage">
          <span className="small">{lo === hi ? `Segment ${lo} selected.` : `Segments ${lo}–${hi} selected.`}</span>
          <div className="row">
            {canWrite && !record.archived_at ? (
              <Button size="sm" variant="primary" onClick={() => setNoteOpen(true)} disabled={hi - lo >= 50}>
                Write a note
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                const ref = JSON.stringify({ record_id: record.record_id, seq_start: lo, seq_end: hi });
                void navigator.clipboard.writeText(ref).then(() => toast("Citation copied — paste it to your agent."));
              }}
            >
              Copy citation
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setSel(null)}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}
      {noteOpen && lo !== null && hi !== null ? <NoteForm recordId={record.record_id} seqStart={lo} seqEnd={hi} onDone={() => setNoteOpen(false)} /> : null}
    </div>
  );
}

export function NoteForm({ recordId, seqStart, seqEnd, onDone }: { recordId: string; seqStart?: number; seqEnd?: number; onDone: () => void }) {
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
      toast("Note added.");
      await qc.invalidateQueries({ queryKey: ["source", base, recordId] });
      onDone();
    },
  });
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <TextArea
        label={seqStart !== undefined ? (seqStart === seqEnd ? `Note on segment ${seqStart}` : `Note on segments ${seqStart}–${seqEnd}`) : "Note"}
        hint="Your observation about this passage. For anything across sources, write an insight."
        required
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        autoFocus
      />
      <TextField label="Tags" optional hint="Comma-separated." value={tags} onChange={(e) => setTags(e.target.value)} />
      {save.isError ? <ErrorCallout error={save.error} /> : null}
      <div className="row">
        <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
          Save note
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
