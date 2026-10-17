import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api.ts";
import { attribution, relativeTime } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import type { Annotation, RecordFull } from "../lib/types.ts";
import { Button, EmptyState, ErrorCallout, IconButton, Sheet, SheetHeader, Tag, TextArea, TextField, useToast } from "../ui/index.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import "../styles/screens/evidence.css";

/** A source's comments: each on the source as a whole, newest first, with a form to add one. */
export function CommentsView({ record }: { record: RecordFull }) {
  const { canWrite } = useProduct();
  const [writing, setWriting] = useState(false);
  const writable = canWrite && !record.archived_at;
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
          <EmptyState size="inline" title="No comments yet" action={writable ? <Button size="sm" onClick={() => setWriting(true)}>Comment</Button> : undefined}>
            Comments say what someone made of this source.
          </EmptyState>
        )
      ) : (
        <ul className="source-comments">
          {record.annotations.map((a) => (
            <li key={a.annotation_id}>
              <Comment annotation={a} />
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** One person's comment on a source. */
function Comment({ annotation: a }: { annotation: Annotation }) {
  const { api: base, canDelete } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  return (
    <article className="comment">
      <div className="comment-meta">
        <strong className="comment-author">{attribution(a.created_by)}</strong>
        <time dateTime={a.created_at}>{relativeTime(a.created_at)}</time>
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
