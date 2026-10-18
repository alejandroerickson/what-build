import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api.ts";
import { Button, Dialog, ErrorCallout, Loading, TextArea, TextField } from "../ui/index.tsx";

/** What `confirm` says on every permanent delete; the server refuses anything else. */
const CONFIRM = "delete permanently";

/**
 * The one dialog for deleting something permanently. It shows what goes, read from the thing's
 * delete_impact; asks why, which is recorded with the deletion; for a whole product or
 * organization, asks for its name to be typed; and offers Cancel and, where there is one, the
 * reversible alternative beside it. Delete is never the default button, and the dialog can't be
 * dismissed while it runs.
 */
export function DeleteDialog<I extends object>({ title, impactPath, etag, deletePath, typeToConfirm, renderImpact, alternative, allowed, onDeleted, onClose }: {
  /** "Delete this assumption permanently?" */
  title: string;
  /** The delete_impact read; absent for what nothing else depends on, such as a comment. */
  impactPath?: string;
  /** The etag to delete, when there is no impact to read it from. */
  etag?: string;
  deletePath: string;
  /** For a whole product or organization: the name to type. */
  typeToConfirm?: { what: string; name: string };
  /** What the impact means, in plain words. */
  renderImpact: (impact: I) => ReactNode;
  /** The reversible alternative, such as Archive instead. */
  alternative?: { label: string; onSelect: () => void; disabled?: boolean };
  /** Whether the impact allows the delete at all; renderImpact says why not. */
  allowed?: (impact: I) => boolean;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const impact = useQuery({ queryKey: ["delete-impact", impactPath], enabled: Boolean(impactPath), queryFn: () => api<I>("GET", impactPath!) });
  const ready = impactPath ? impact.data : ({} as I);
  // The etag the delete is guarded by: the one the impact was read at, so a change since is refused.
  const guard = (impact.data as { etag?: string } | undefined)?.etag ?? etag;
  const del = useMutation({
    mutationFn: () =>
      api("DELETE", deletePath, {
        ...(guard ? { expected_etag: guard } : {}),
        reason,
        confirm: CONFIRM,
        ...(typeToConfirm ? { name: typed.trim() } : {}),
      }),
    onSuccess: onDeleted,
  });
  const named = !typeToConfirm || typed.trim() === typeToConfirm.name;
  const permitted = Boolean(ready) && (!allowed || allowed(ready!));
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description="This can’t be undone."
      dismissable={!del.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          {alternative ? (
            <Button
              onClick={() => {
                alternative.onSelect();
                onClose();
              }}
              disabled={alternative.disabled || del.isPending}
            >
              {alternative.label}
            </Button>
          ) : null}
          <Button variant="danger" disabled={!permitted || !reason.trim() || !named} busy={del.isPending} busyLabel="Deleting…" onClick={() => del.mutate()}>
            Delete permanently
          </Button>
        </>
      }
    >
      {impactPath && impact.isPending ? (
        <Loading variant="lines" lines={3} label="Checking what would be lost…" />
      ) : impactPath && impact.isError ? (
        <ErrorCallout inset error={impact.error} onRetry={() => impact.refetch()} />
      ) : ready ? (
        <div className="delete-impact">{renderImpact(ready)}</div>
      ) : null}
      {ready && !permitted ? null : (
        <TextArea label="Why is it being deleted?" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded with the deletion." />
      )}
      {typeToConfirm && (!ready || permitted) ? (
        <TextField
          label={`Type the ${typeToConfirm.what}’s name to confirm: ${typeToConfirm.name}`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}
      {del.isError ? <ErrorCallout inset error={del.error} /> : null}
    </Dialog>
  );
}

/** "a, b and c": the parts of a list worth saying, without the empty ones. */
export function listed(parts: (string | false | null | undefined)[]): string {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length <= 1 ? (kept[0] ?? "") : `${kept.slice(0, -1).join(", ")} and ${kept.at(-1)}`;
}
