import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../lib/api.ts";
import { Button, Dialog, ErrorCallout, TextField, tooLong } from "../ui/index.tsx";

/** The longest title a mockup or a Story page takes (mockups.rename, story.rename_page). */
export const TITLE_MAX = 200;

/**
 * Asks for a new title for a mockup or a Story page. Renaming publishes no version and changes
 * nothing a page itself says: it is the name the thing is listed and shown under.
 */
export function RenameDialog({ heading, description, current, save, onSaved, onClose }: {
  /** The dialog's title: "Rename mockup canvas", "Rename page". */
  heading: string;
  description?: string;
  /** The title it has now. */
  current: string;
  /** Saves the new title, trimmed; it throws what the server refused. */
  save: (title: string) => Promise<unknown>;
  onSaved: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(current);
  const trimmed = title.trim();
  const rename = useMutation({
    mutationFn: () => save(trimmed),
    onSuccess: () => {
      onSaved(trimmed);
      onClose();
    },
  });
  const valid = trimmed.length > 0 && !tooLong(title, TITLE_MAX) && trimmed !== current;
  // Someone else changed it meanwhile: say that, in place of the server's words for an agent.
  const stale = rename.error instanceof ApiError && rename.error.code === "stale_etag";
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!rename.isPending}
      title={heading}
      description={description}
      footer={
        <>
          <Button onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={rename.isPending} busyLabel="Renaming…" disabled={!valid} onClick={() => rename.mutate()}>
            Rename
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !rename.isPending) rename.mutate();
        }}
      >
        <TextField label="Title" value={title} maxLength={TITLE_MAX} autoFocus onChange={(e) => setTitle(e.target.value)} />
        {rename.isError ? <ErrorCallout inset error={stale ? new Error("Someone else changed it just now. Close this, and rename it again if you still want to.") : rename.error} /> : null}
      </form>
    </Dialog>
  );
}
