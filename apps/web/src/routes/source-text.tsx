import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { attribution, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import { derivedStatus, derivedStatusDetail } from "../lib/status.ts";
import type { Attachment, RecordFull } from "../lib/types.ts";
import { Button, Callout, Dialog, EmptyState, ErrorCallout, FindField, Glyph, IconButton, Loading, Menu, MenuGroup, MenuItem, Sheet, SheetHeader, TextArea, useToast } from "../ui/index.tsx";

/** Past this many characters, a text shows its first part until the reader asks for the rest. */
const SHOWN_CHARS = 300_000;

const count = (n: number) => n.toLocaleString("en-GB");

/** A source's whole derived text, as the server keeps it, with the etag a write over it names. */
interface WholeText {
  content: string;
  etag: string | null;
}

/** A source's whole derived text, as the server keeps it. */
async function fetchText(base: string, recordId: string): Promise<WholeText> {
  let res: Response;
  try {
    res = await fetch(`${base}/sources/${recordId}/text`, { credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "WhatBuild couldn’t be reached. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError(res.status, "error", res.status === 404 ? "This source has no text." : `WhatBuild answered with status ${res.status}.`);
  return { content: await res.text(), etag: res.headers.get("ETag")?.replace(/^W\//, "").replace(/^"(.*)"$/, "$1") ?? null };
}

/**
 * Someone else's version of a source's summary, notes or text, which an editor loads when a save
 * is refused because it changed after the editor opened (409 stale_etag).
 */
export type Theirs = { state: "loading" } | { state: "changed"; content: string } | { state: "removed" } | { state: "unknown" };

/**
 * What an editor of a source's summary, notes or text says when a save was refused because
 * someone changed it meanwhile: the person's words stay in their box, theirs show under it to
 * compare and copy from, and saving again replaces theirs (nothing keeps an earlier version). When
 * theirs could not be loaded, the person can load it again.
 */
export function ChangedMeanwhile({ noun, theirs, onLoad, rows = 8, className }: { noun: string; theirs: Theirs; onLoad: () => void; rows?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // The save button is at the dialog's foot: bring the notice into view beside it. (A block, so
  // the effect returns nothing: browsers that answer scrollIntoView with a promise would hand it to
  // React as a cleanup.)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [theirs.state]);
  const removed = theirs.state === "removed";
  return (
    <>
      <div ref={ref} role="alert">
        <Callout
          tone="attention"
          inset
          title={`Someone ${removed ? "removed" : "changed"} the ${noun} while you were editing`}
          action={theirs.state === "unknown" ? <Button size="sm" onClick={onLoad}>Load their version</Button> : undefined}
        >
          {theirs.state === "changed"
            ? "Your text is still here, and their version is below. Saving replaces theirs with yours, so first copy anything of theirs you want to keep."
            : removed
              ? "Your text is still here. Saving puts it back."
              : theirs.state === "loading"
                ? "Your text is still here. Loading their version…"
                : "Your text is still here. Their version couldn’t be loaded; load it to see what changed before you save."}
        </Callout>
      </div>
      {theirs.state === "changed" ? <TextArea label="Their version" readOnly rows={rows} value={theirs.content} className={className} /> : null}
    </>
  );
}

const SUFFIXES = ["ations", "ation", "ments", "ment", "ings", "ing", "ers", "er", "ies", "ied", "ed", "es", "ly", "s"];

/** A word's root, so a find also marks its other endings, as search reads words ("pricing" marks "priced"). */
function root(word: string): string {
  const w = word.toLowerCase();
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length).replace(/e$/, "");
  return w.length > 4 ? w.replace(/e$/, "") : w;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a find marks: each word at the start of a word, with any ending, and each "quoted phrase" as written. */
export function findPattern(find: string): RegExp | undefined {
  const parts = [...find.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((m) => (m[1] !== undefined ? escape(m[1].trim()).replace(/\s+/g, "\\s+") : `${escape(root(m[2]!))}[\\p{L}\\p{N}]*`))
    .filter((p) => p && p !== "[\\p{L}\\p{N}]*");
  if (!parts.length) return undefined;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})`, "giu");
}

/** The first part of a long text, ending at a paragraph. */
function firstPart(text: string): string {
  if (text.length <= SHOWN_CHARS) return text;
  const cut = text.lastIndexOf("\n\n", SHOWN_CHARS);
  return text.slice(0, cut > SHOWN_CHARS / 2 ? cut : SHOWN_CHARS);
}

/**
 * The source's derived text: its words as one document, what search reads. Where it came from is
 * said above it; editors write or edit it, or take an attachment's text. It opens folded to its
 * first lines, fading out, so the summary above stays what people read first; a click on the fade
 * unfolds it. `?find=` unfolds it, marks words in it and steps through them.
 */
export function TextView({ record, onAddAttachments }: { record: RecordFull; onAddAttachments?: (() => void) | undefined }) {
  const { api: base, canWrite } = useProduct();
  const [params, setParams] = useSearchParams();
  const find = params.get("find") ?? "";
  const [typed, setTyped] = useState(find);
  const [all, setAll] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [editing, setEditing] = useState(false);
  const [using, setUsing] = useState<Attachment | null>(null);
  const [at, setAt] = useState(0);
  const [marks, setMarks] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const fold = useRef<HTMLDivElement>(null);
  const writable = canWrite && !record.archived_at;
  const text = record.text;
  const q = useQuery({
    queryKey: ["source-text", base, record.record_id, text?.etag ?? ""],
    queryFn: () => fetchText(base, record.record_id),
    enabled: Boolean(text),
    staleTime: 60_000,
  });
  useEffect(() => setTyped(find), [find]);
  // The find follows what is typed, a moment after the typing stops, and lives in the address.
  useEffect(() => {
    if (typed === find) return;
    const t = setTimeout(
      () =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (typed.trim()) next.set("find", typed);
            else next.delete("find");
            return next;
          },
          { replace: true },
        ),
      250,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);
  const pattern = useMemo(() => findPattern(find), [find]);
  const content = q.data?.content ?? "";
  const shown = all || pattern ? content : firstPart(content);
  const folded = !unfolded && !pattern;
  // A find unfolds the text for good: clearing it leaves the reader where they were.
  useEffect(() => {
    if (pattern) setUnfolded(true);
  }, [pattern]);
  // Folded, the text is cut at a height; only a text that runs past it fades and offers the rest.
  useLayoutEffect(() => {
    const el = fold.current;
    if (!el || !folded) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [shown, folded]);
  const unfold = () => {
    setUnfolded(true);
    fold.current?.focus({ preventScroll: true });
  };
  // Count the marks once they are drawn, and bring the first into view.
  useEffect(() => {
    const found = body.current?.querySelectorAll("mark.text-find") ?? [];
    setMarks(found.length);
    setAt(0);
  }, [shown, pattern]);
  useEffect(() => {
    const found = body.current?.querySelectorAll("mark.text-find");
    if (!found?.length) return;
    found.forEach((m, i) => m.classList.toggle("text-find-current", i === at));
    found[Math.min(at, found.length - 1)]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [at, marks]);
  const readable = record.attachments.filter((a) => a.text.status === "ready" && !a.is_text_source);
  const step = (by: number) => setAt((i) => (marks ? (i + by + marks) % marks : 0));

  // Without a text, the empty state offers what an editor can do instead.
  const actions = writable && text ? (
    <>
      <Button size="sm" icon="pencil" onClick={() => setEditing(true)} disabled={!q.data}>
        Edit
      </Button>
      {readable.length ? (
        <Menu label="More text actions" trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-md">
          <MenuGroup label="Use an attachment’s text">
            {readable.map((a) => (
              <MenuItem key={a.path} icon="file-text" detail={`${count(a.text.chars)} characters`} onSelect={() => setUsing(a)}>
                {a.path}
              </MenuItem>
            ))}
          </MenuGroup>
        </Menu>
      ) : null}
    </>
  ) : undefined;

  return (
    <Sheet labelledBy="text-h" className="source-text-sheet">
      <SheetHeader
        id="text-h"
        title="Text"
        filter={
          text ? (
            <span className="text-find-bar">
              <FindField label="Find in the text" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), step(e.shiftKey ? -1 : 1))} />
              {pattern ? (
                <>
                  <span className="text-find-count num" aria-live="polite">
                    {marks ? `${at + 1} of ${count(marks)}` : "No matches"}
                  </span>
                  <IconButton size="sm" icon="chevron-up" label="Previous match" onClick={() => step(-1)} disabled={!marks} />
                  <IconButton size="sm" icon="chevron-down" label="Next match" onClick={() => step(1)} disabled={!marks} />
                </>
              ) : null}
            </span>
          ) : undefined
        }
        end={actions}
      />
      {text ? (
        <>
          <p className="source-text-meta">
            {text.taken_from ? (
              <>
                Read from <b>{text.taken_from.path}</b>
              </>
            ) : (
              <>
                Written by {attribution(text.updated_by)}, {relativeTime(text.updated_at)}
              </>
            )}{" "}
            · <span className="num">{count(text.chars)}</span> characters
          </p>
          {q.isPending ? (
            <Loading variant="lines" lines={8} label="Loading the text…" />
          ) : q.isError ? (
            <ErrorCallout inset title="The text couldn’t be loaded" error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <div ref={body} className={`source-text-body${folded ? " is-folded" : ""}${folded && overflows ? " is-cut" : ""}`}>
              <div ref={fold} id="source-text-fold" className="source-text-fold" tabIndex={-1}>
                <Markdown source={shown} className="prose source-text" headingShift={1} mark={pattern} />
              </div>
              {folded && overflows ? (
                <button type="button" className="source-text-unfold" aria-expanded={false} aria-controls="source-text-fold" onClick={unfold}>
                  <span className="source-text-unfold-label">
                    <Glyph name="chevron-down" size="sm" />
                    Show the whole text
                  </span>
                </button>
              ) : null}
              {!folded && shown.length < content.length ? (
                <p className="source-text-more">
                  <Button size="sm" onClick={() => setAll(true)}>
                    Show all {count(text.chars)} characters
                  </Button>
                </p>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <NoText record={record} readable={readable} writable={writable} onWrite={() => setEditing(true)} onUse={setUsing} onAddAttachments={onAddAttachments} />
      )}
      {editing ? <TextEditor record={record} opened={text && q.data ? q.data : { content: "", etag: null }} onClose={() => setEditing(false)} /> : null}
      {using ? <UseAttachmentText record={record} attachment={using} onClose={() => setUsing(null)} /> : null}
    </Sheet>
  );
}

/** What a source without text says: why, and what an editor can do about it. */
function NoText({
  record,
  readable,
  writable,
  onWrite,
  onUse,
  onAddAttachments,
}: {
  record: RecordFull;
  readable: Attachment[];
  writable: boolean;
  onWrite: () => void;
  onUse: (a: Attachment) => void;
  onAddAttachments?: (() => void) | undefined;
}) {
  const status = derivedStatus(record.derived_status);
  const detail = derivedStatusDetail(record.derived_status, record.status_detail);
  if (record.derived_status === "pending") {
    const reading = record.attachments.find((a) => a.text.status === "pending")?.path ?? record.pending_upload_path;
    return (
      <EmptyState size="inline" title="Reading its attachment">
        {reading ? `WhatBuild is reading ${reading}.` : "WhatBuild is reading its attachment."} The text appears here when it&rsquo;s done.
      </EmptyState>
    );
  }
  const actions = writable ? (
    <span className="row">
      {readable.slice(0, 3).map((a) => (
        <Button key={a.path} size="sm" onClick={() => onUse(a)}>
          Use the text of {a.path}
        </Button>
      ))}
      {onAddAttachments && record.derived_status !== "awaiting_text" ? (
        <Button size="sm" icon="upload" onClick={onAddAttachments}>
          Add attachments
        </Button>
      ) : null}
      <Button size="sm" variant="quiet" icon="pencil" onClick={onWrite}>
        Write the text
      </Button>
    </span>
  ) : undefined;
  return (
    <EmptyState size="inline" title={record.derived_status === "awaiting_file" ? "No text yet" : status.label} action={actions}>
      {status.explain} {detail ? <span className="muted">({detail})</span> : null} {writable ? (status.next ?? "") : ""}
    </EmptyState>
  );
}

/**
 * Write or edit the derived text, whole. Saving it empty removes it. Saving names the etag of the
 * text the dialog opened, so a change someone made meanwhile is never overwritten unseen.
 */
function TextEditor({ record, opened, onClose }: { record: RecordFull; opened: WholeText; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  // What the dialog opened: the person edits from it, whatever the page behind it loads meanwhile.
  const [start] = useState(opened);
  const [content, setContent] = useState(start.content);
  const [etag, setEtag] = useState(start.etag);
  const [theirs, setTheirs] = useState<Theirs | null>(null);
  const loadTheirs = async () => {
    setTheirs({ state: "loading" });
    // The page behind the dialog shows theirs too, once it reloads.
    void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
    try {
      const now = await fetchText(base, record.record_id);
      setEtag(now.etag);
      setTheirs({ state: "changed", content: now.content });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setEtag(null);
        setTheirs({ state: "removed" });
      } else setTheirs({ state: "unknown" });
    }
  };
  const save = useMutation({
    mutationFn: () => api("PUT", `${base}/sources/${record.record_id}/derived/text`, { content, ...(etag ? { expected_etag: etag } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
      void qc.invalidateQueries({ queryKey: ["source-text", base, record.record_id] });
      toast(content.trim() ? "Text saved." : "Text removed.");
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "stale_etag") void loadTheirs();
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={start.content ? "Edit the text" : "Write the text"}
      dismissable={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            busyLabel="Saving…"
            disabled={(!theirs && content === start.content) || theirs?.state === "loading"}
            onClick={() => save.mutate()}
          >
            {theirs?.state === "changed" ? "Save mine over theirs" : "Save"}
          </Button>
        </>
      }
    >
      <TextArea
        label="Text"
        hint="Markdown. Keep the words as they were said or written; your reading of the source belongs in its summary or notes. Saving it empty removes the text."
        className="source-text-editor"
        rows={22}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        autoFocus
      />
      {theirs ? <ChangedMeanwhile noun="text" theirs={theirs} onLoad={() => void loadTheirs()} className="source-text-theirs" /> : null}
      {save.isError && !stale ? <ErrorCallout inset error={save.error} /> : null}
    </Dialog>
  );
}

/** Make an attachment's text the source's, in place of what it has. */
function UseAttachmentText({ record, attachment, onClose }: { record: RecordFull; attachment: Attachment; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const use = useMutation({
    mutationFn: () => api("PUT", `${base}/sources/${record.record_id}/derived/text`, { from_attachment: attachment.path, ...(record.text ? { expected_etag: record.text.etag } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] });
      void qc.invalidateQueries({ queryKey: ["source-text", base, record.record_id] });
      toast(`The text of ${attachment.path} is now this source’s text.`);
      onClose();
    },
  });
  const t = record.text;
  const stale = use.error instanceof ApiError && use.error.code === "stale_etag";
  // Reloading the source says again what its text is now, and gives the etag to name.
  const reload = () =>
    void qc.invalidateQueries({ queryKey: ["source", base, record.record_id] }).then(() => {
      void qc.invalidateQueries({ queryKey: ["source-text", base, record.record_id] });
      use.reset();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!use.isPending}
      title={`Use the text of ${attachment.path}?`}
      footer={
        <>
          <Button onClick={onClose} disabled={use.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={use.isPending} busyLabel="Saving…" disabled={stale} onClick={() => use.mutate()}>
            Use its text
          </Button>
        </>
      }
    >
      <p>
        {!t
          ? "It becomes this source’s text, which search reads."
          : t.taken_from
            ? `It replaces the text read from ${t.taken_from.path}.`
            : "It replaces the text written for this source, edits included."}{" "}
        When a new version of {attachment.path} arrives, the text follows it until someone edits it.
      </p>
      {stale ? (
        <div role="alert">
          <Callout tone="attention" inset title="Someone changed the text while this was open" action={<Button size="sm" onClick={reload}>Load the latest</Button>}>
            Nothing was replaced. Load the latest to see what it would replace now, then choose again.
          </Callout>
        </div>
      ) : use.isError ? (
        <ErrorCallout inset error={use.error} />
      ) : null}
    </Dialog>
  );
}

export { UseAttachmentText };
