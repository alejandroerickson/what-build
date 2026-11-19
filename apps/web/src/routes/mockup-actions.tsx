import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api.ts";
import { quotedAtEnd } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { useToast } from "../ui/index.tsx";
import { RenameDialog } from "./rename-dialog.tsx";

/** A mockup as its actions need it: a row of the list, an archived one, and the one on screen all have these. */
export interface MockupRef {
  mockup_id: string;
  title: string;
  etag: string;
  archived_at: string | null;
}

/** What the panel's rows and the inspector can ask of a mockup. Each is offered only to someone who can write. */
export interface MockupActions {
  rename: (m: MockupRef) => void;
  archive: (m: MockupRef) => void;
  restore: (m: MockupRef) => void;
}

/** Actions that do nothing, for the tutorial's example canvas. */
export const NO_MOCKUP_ACTIONS: MockupActions = { rename: () => {}, archive: () => {}, restore: () => {} };

function why(e: unknown): string {
  if (e instanceof ApiError && e.code === "stale_etag") return "It changed since you opened it. Try again.";
  return e instanceof Error ? e.message : "";
}

/**
 * Rename, archive and restore a mockup by hand, as agents do through MCP. Renaming publishes no
 * version. An archived mockup keeps its folder and its place, so Undo, which restores it, puts it
 * back where it stood. `dialogs` holds the rename dialog, to render beside whatever offers them.
 */
export function useMockupActions(): { actions: MockupActions; dialogs: ReactNode } {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [renaming, setRenaming] = useState<MockupRef | null>(null);

  // The list, the archived list (under the same key) and the mockup's own screen.
  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: ["mockups", base] });
    void qc.invalidateQueries({ queryKey: ["mockup", base, id] });
    void qc.invalidateQueries({ queryKey: ["product"] });
  };

  const restore = useMutation({
    mutationFn: (m: MockupRef) => api<MockupRef>("POST", `${base}/mockups/${m.mockup_id}/restore`, { expected_etag: m.etag }),
    onSuccess: (_r, m) => {
      refresh(m.mockup_id);
      toast(`Restored ${quotedAtEnd(m.title)}`);
    },
    onError: (e, m) => {
      refresh(m.mockup_id);
      toast(`“${m.title}” couldn’t be restored. ${why(e)}`.trim(), { tone: "negative" });
    },
  });

  const archive = useMutation({
    mutationFn: (m: MockupRef) => api<MockupRef>("POST", `${base}/mockups/${m.mockup_id}/archive`, { expected_etag: m.etag }),
    onSuccess: (r, m) => {
      refresh(m.mockup_id);
      toast(`Archived ${quotedAtEnd(m.title)}`, { action: { label: "Undo", onClick: () => restore.mutate({ ...m, etag: r.etag, archived_at: r.archived_at }) } });
    },
    onError: (e, m) => {
      refresh(m.mockup_id);
      toast(`“${m.title}” couldn’t be archived. ${why(e)}`.trim(), { tone: "negative" });
    },
  });

  const dialogs = renaming ? (
    <RenameDialog
      heading="Rename mockup canvas"
      description="Its versions, pages and place stay as they are. Agents see the new title too."
      current={renaming.title}
      save={(title) => api("PATCH", `${base}/mockups/${renaming.mockup_id}`, { title, expected_etag: renaming.etag })}
      onSaved={(title) => {
        refresh(renaming.mockup_id);
        toast(`Renamed to ${quotedAtEnd(title)}`);
      }}
      onClose={() => {
        // Whatever came of it, the next try starts from the mockup as it is.
        refresh(renaming.mockup_id);
        setRenaming(null);
      }}
    />
  ) : null;

  return {
    actions: { rename: setRenaming, archive: (m) => archive.mutate(m), restore: (m) => restore.mutate(m) },
    dialogs,
  };
}
