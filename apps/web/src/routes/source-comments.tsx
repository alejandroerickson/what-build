import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { api, qs } from "../lib/api.ts";
import { actorName, attribution, nestQuotes, plural, relativeTime } from "../lib/format.ts";
import { Markdown, markdownText } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import type { Annotation, RecordFull } from "../lib/types.ts";
import {
  Button, Dialog, EmptyState, ErrorCallout, Glyph, Menu, MenuItem, MenuSeparator, Sheet, SheetHeader, StatusBadge, Tag, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import "../styles/screens/evidence.css";

/** Every comment on a source, archived ones too, newest first, as sources.list_annotations pages them. */
async function everyComment(base: string, recordId: string): Promise<Annotation[]> {
  const all: Annotation[] = [];
  let cursor: string | undefined;
  do {
    const page = await api<{ items: Annotation[]; next_cursor: string | null }>(
      "GET",
      `${base}/sources/${recordId}/annotations${qs({ include_archived: "true", limit: 200, cursor })}`,
    );
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor && all.length < 2000);
  return all;
}

/**
 * A source's comments: each on the source as a whole, newest first, with a form to add one.
 * Archived ones stay out of the way until asked for (`?include_archived=1`), muted, under the others.
 */
export function CommentsView({ record }: { record: RecordFull }) {
  const { api: base, canWrite, canDelete } = useProduct();
  const [params, setParams] = useSearchParams();
  const [writing, setWriting] = useState(false);
  // An archived source is read-only: its comments are neither changed nor deleted until it is restored.
  const writable = canWrite && !record.archived_at;
  const deletable = canDelete && !record.archived_at;
  const showArchived = params.get("include_archived") === "1";
  const every = useQuery({ queryKey: ["source-comments", base, record.record_id], queryFn: () => everyComment(base, record.record_id) });
  const archived = (every.data ?? []).filter((a) => a.archived_at);
  // Every menu shown here has a name of its own, the archived comments' too.
  const menuNames = commentMenuNames([...record.annotations, ...(showArchived ? archived : [])]);
  const setShowArchived = (on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (on) next.set("include_archived", "1");
        else next.delete("include_archived");
        return next;
      },
      { replace: !on },
    );
  return (
    <Sheet labelledBy="comments-h">
      <SheetHeader
        id="comments-h"
        title="Comments"
        count={record.annotations.length}
        end={
          writable && !writing ? (
            <Button size="sm" icon="pencil" onClick={() => setWriting(true)}>
              Comment
            </Button>
          ) : undefined
        }
      />
      {writing ? (
        <div className="sheet-body">
          <CommentForm recordId={record.record_id} onDone={() => setWriting(false)} />
        </div>
      ) : null}
      {!record.annotations.length ? (
        writing ? null : (
          <EmptyState
            size="inline"
            title={archived.length ? "No current comments" : "No comments yet"}
            action={writable ? <Button size="sm" onClick={() => setWriting(true)}>Comment</Button> : undefined}
          >
            Comments say what someone made of this source.
          </EmptyState>
        )
      ) : (
        <ul className="source-comments">
          {record.annotations.map((a) => (
            <li key={a.annotation_id}>
              <Comment annotation={a} menuName={menuNames.get(a.annotation_id)!} writable={writable} deletable={deletable} />
            </li>
          ))}
        </ul>
      )}
      {showArchived && archived.length ? (
        <ul className="source-comments source-comments-archived" aria-label="Archived comments">
          {archived.map((a) => (
            <li key={a.annotation_id}>
              <Comment annotation={a} menuName={menuNames.get(a.annotation_id)!} writable={writable} deletable={deletable} />
            </li>
          ))}
        </ul>
      ) : null}
      {archived.length ? (
        <div className="source-comments-foot">
          <button type="button" className="quiet-link" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide archived comments" : `Show ${plural(archived.length, "archived comment")}`}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * Archive a comment, with the reason the person gave, or restore it: sources.update_annotation. A
 * failure reloads the comments, so trying again names the comment's latest etag; a dialog says
 * the failure itself (`inDialog`), anywhere else a toast does.
 */
function useCommentArchive(a: Annotation, { inDialog = false } = {}) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["source", base, a.record_id] });
    void qc.invalidateQueries({ queryKey: ["source-comments", base, a.record_id] });
  };
  const m = useMutation({
    mutationFn: ({ archived, etag, reason }: { archived: boolean; etag: string; reason?: string }) =>
      api<Annotation>("PATCH", `${base}/annotations/${a.annotation_id}`, { expected_etag: etag, archived, ...(reason ? { archive_reason: reason } : {}) }),
    onSuccess: (next, { archived }) => {
      reload();
      toast(
        archived ? "Comment archived." : "Comment restored.",
        archived ? { action: { label: "Undo", onClick: () => m.mutate({ archived: false, etag: next.etag }) } } : {},
      );
    },
    onError: (e) => {
      reload();
      if (!inDialog) toast((e as Error).message, { tone: "negative" });
    },
  });
  return m;
}

/** How many of a comment's words the name of its menu quotes. */
const OPENING_WORDS = 6;

/**
 * A comment's first words, plain, as the name of its menu quotes them, so that two comments by the
 * same person at the same time are told apart: "Gate codes again.", or "Crews plan by the day,
 * and…" for a longer one.
 */
export function commentOpening(note: string): string {
  const words = markdownText(note).split(" ").filter(Boolean);
  const kept = words.length > OPENING_WORDS ? `${words.slice(0, OPENING_WORDS).join(" ").replace(/[\s,;:.!?…—–-]+$/, "")}…` : words.join(" ");
  return nestQuotes(kept);
}

/**
 * The names of the menus of the comments shown together: whose comment each is, when, and its first
 * words. Comments that would still share a name, by one person at one time and starting with the
 * same words, as a write sent twice does, say which of them each is: "(1 of 2)".
 */
export function commentMenuNames(comments: Annotation[]): Map<string, string> {
  const names = comments.map((a) => {
    const opening = commentOpening(a.note);
    return `Actions for ${actorName(a.created_by)}’s comment from ${relativeTime(a.created_at)}${opening ? `, “${opening}”` : ""}`;
  });
  const alike = new Map<string, number>();
  for (const n of names) alike.set(n, (alike.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    comments.map((a, i) => {
      const name = names[i]!;
      const of = alike.get(name)!;
      if (of === 1) return [a.annotation_id, name];
      seen.set(name, (seen.get(name) ?? 0) + 1);
      return [a.annotation_id, `${name} (${seen.get(name)} of ${of})`];
    }),
  );
}

/** One person's comment on a source, with what an editor and an admin can do to it, in a menu called `menuName`. */
function Comment({ annotation: a, menuName, writable, deletable }: { annotation: Annotation; menuName: string; writable: boolean; deletable: boolean }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<"archive" | "delete" | null>(null);
  const archive = useCommentArchive(a);
  const archived = Boolean(a.archived_at);
  return (
    <article className={`comment${archived ? " is-archived" : ""}`}>
      <div className="comment-meta">
        <strong className="comment-author">{attribution(a.created_by)}</strong>
        <time dateTime={a.created_at}>{relativeTime(a.created_at)}</time>
        {a.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
        {archived ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
        {writable || deletable ? (
          <Menu label={menuName} trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm comment-actions" align="end">
            {writable && archived ? (
              <MenuItem icon="archive-restore" onSelect={() => archive.mutate({ archived: false, etag: a.etag })}>
                Restore
              </MenuItem>
            ) : null}
            {writable && !archived ? (
              <MenuItem icon="archive" meta="Reversible" onSelect={() => setDialog("archive")}>
                Archive…
              </MenuItem>
            ) : null}
            {deletable ? (
              <>
                {writable ? <MenuSeparator /> : null}
                <MenuItem icon="trash" tone="danger" onSelect={() => setDialog("delete")}>
                  Delete permanently…
                </MenuItem>
              </>
            ) : null}
          </Menu>
        ) : null}
      </div>
      <Markdown source={a.note} className="prose comment-text" headingShift={3} />
      {archived ? (
        <p className="comment-archived">
          Archived {relativeTime(a.archived_at)}
          {a.archive_reason ? <>: {a.archive_reason}</> : "."}
        </p>
      ) : null}
      {dialog === "archive" ? <ArchiveComment annotation={a} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? (
        <DeleteDialog
          title="Delete this comment permanently?"
          etag={a.etag}
          deletePath={`${base}/annotations/${a.annotation_id}`}
          alternative={writable && !archived ? { label: "Archive instead", onSelect: () => archive.mutate({ archived: true, etag: a.etag }) } : undefined}
          renderImpact={() => <p>This deletes the comment by {attribution(a.created_by)}, with its earlier text.</p>}
          onDeleted={() => {
            void qc.invalidateQueries({ queryKey: ["source", base, a.record_id] });
            void qc.invalidateQueries({ queryKey: ["source-comments", base, a.record_id] });
            toast("Comment deleted. The activity log records who, when and why.");
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </article>
  );
}

/**
 * Archive a comment, saying why if the person wants to: the reason stays with the comment, and the
 * activity log records only that it was archived.
 */
function ArchiveComment({ annotation: a, onClose }: { annotation: Annotation; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const archive = useCommentArchive(a, { inDialog: true });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Archive this comment"
      description="It leaves the source’s comments and search, including your agents’, and keeps everything. You can restore it."
      dismissable={!archive.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={archive.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="archive"
            busy={archive.isPending}
            busyLabel="Archiving…"
            onClick={() => archive.mutate({ archived: true, etag: a.etag, reason: reason.trim() }, { onSuccess: onClose })}
          >
            Archive
          </Button>
        </>
      }
    >
      <TextArea
        label="Why is it being archived?"
        optional
        maxLength={500}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Kept with the comment. The activity log records that it was archived, not why."
        autoFocus
      />
      {archive.isError ? <ErrorCallout inset error={archive.error} /> : null}
    </Dialog>
  );
}

function CommentForm({ recordId, onDone }: { recordId: string; onDone: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api("POST", `${base}/sources/${recordId}/annotations`, {
        note,
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
      <TextArea label="Comment" required maxLength={2000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
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
