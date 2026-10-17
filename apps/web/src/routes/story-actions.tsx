import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import { useToast } from "../ui/index.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import { toServer, type Arrangement, type Hierarchy, type PageView } from "./story-model.ts";

/** A Story page as its actions need it: the tree's rows, the archived list and the page shown all have these. */
export interface PageRef {
  page_id: string;
  title: string;
  etag: string;
  archived_at: string | null;
}

/** What the tree and the inspector can ask of a page. Each is offered only to a role that may do it. */
export interface PageActions {
  archive: (page: PageRef) => void;
  restore: (page: PageRef) => void;
  remove: (page: PageRef) => void;
}

function why(e: unknown): string {
  if (e instanceof ApiError && e.code === "stale_etag") return "It changed since you opened it. Try again.";
  return e instanceof Error ? e.message : "";
}

/**
 * Archive and restore a Story page by hand. Archiving takes the page out of the navigation and moves
 * its subpages up into its place; its Undo restores the page and puts the navigation back as it was
 * before, so the page returns where it stood rather than at the end.
 */
export function useArchiveActions(tree: Arrangement) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();

  const refresh = (page: string) => {
    void qc.invalidateQueries({ queryKey: ["story-tree", base] });
    void qc.invalidateQueries({ queryKey: ["story-pages", base] });
    void qc.invalidateQueries({ queryKey: ["story-page", base, page] });
    void qc.invalidateQueries({ queryKey: ["product"] });
  };

  const putBack = useMutation({
    mutationFn: async ({ page, before }: { page: PageRef; before: Arrangement }) => {
      const now = await api<PageView>("GET", `${base}/story/pages/${page.page_id}?include_html=false`);
      await api("POST", `${base}/story/pages/${page.page_id}/restore`, { expected_etag: now.etag });
      const fresh = await api<Hierarchy>("GET", `${base}/story/hierarchy`);
      try {
        await api("PUT", `${base}/story/hierarchy`, { ...toServer(before), expected_etag: fresh.etag });
        return true;
      } catch {
        // The page is back; the navigation changed meanwhile, so it waits at the end instead.
        return false;
      }
    },
    onSuccess: (inPlace, { page }) => {
      refresh(page.page_id);
      toast(inPlace ? `Restored “${page.title}”.` : `Restored “${page.title}”. The Story changed meanwhile, so it is at the end.`);
    },
    onError: (e, { page }) => {
      refresh(page.page_id);
      toast(`“${page.title}” couldn’t be restored. ${why(e)}`.trim(), { tone: "negative" });
    },
  });

  const archive = useMutation({
    mutationFn: ({ page }: { page: PageRef; before: Arrangement }) =>
      api<{ promoted_children: string[] }>("POST", `${base}/story/pages/${page.page_id}/archive`, { expected_etag: page.etag }),
    onSuccess: (r, { page, before }) => {
      refresh(page.page_id);
      const moved = r.promoted_children.length ? ` ${r.promoted_children.length === 1 ? "Its subpage moved" : "Its subpages moved"} up into its place.` : "";
      toast(`Archived “${page.title}”.${moved}`, { action: { label: "Undo", onClick: () => putBack.mutate({ page, before }) } });
    },
    onError: (e, { page }) => {
      refresh(page.page_id);
      toast(`“${page.title}” couldn’t be archived. ${why(e)}`.trim(), { tone: "negative" });
    },
  });

  const restore = useMutation({
    mutationFn: (page: PageRef) => api("POST", `${base}/story/pages/${page.page_id}/restore`, { expected_etag: page.etag }),
    onSuccess: (_r, page) => {
      refresh(page.page_id);
      toast(`Restored “${page.title}”.`);
    },
    onError: (e, page) => {
      refresh(page.page_id);
      toast(`“${page.title}” couldn’t be restored. ${why(e)}`.trim(), { tone: "negative" });
    },
  });

  return {
    // The arrangement as it is when Archive is chosen, for its Undo.
    archive: (page: PageRef) => archive.mutate({ page, before: tree }),
    restore: (page: PageRef) => restore.mutate(page),
  };
}

/** What deleting a Story page destroys, as story.delete_page_impact reports it. */
interface PageImpact {
  etag: string;
  archived: boolean;
  version_count: number;
  sub_pages_promoted: string[];
}

/** Delete a Story page for good, with Archive offered beside it. */
export function DeletePage({ page, onArchive, onDeleted, onClose }: { page: PageRef; onArchive: (page: PageRef) => void; onDeleted: () => void; onClose: () => void }) {
  const { api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <DeleteDialog<PageImpact>
      title="Delete this Story page permanently?"
      impactPath={`${base}/story/pages/${page.page_id}/delete-impact`}
      deletePath={`${base}/story/pages/${page.page_id}`}
      alternative={{ label: "Archive instead", disabled: Boolean(page.archived_at) || !canWrite, onSelect: () => onArchive(page) }}
      renderImpact={(i) => (
        <>
          <p>
            This deletes “{page.title}” with {i.version_count === 1 ? "its only version" : `all ${i.version_count} of its versions`} and its notes.
          </p>
          {i.sub_pages_promoted.length ? <p>Its {i.sub_pages_promoted.length === 1 ? "sub-page moves" : `${i.sub_pages_promoted.length} sub-pages move`} up into its place.</p> : null}
        </>
      )}
      onDeleted={() => {
        void qc.invalidateQueries({ queryKey: ["story-tree", base] });
        void qc.invalidateQueries({ queryKey: ["story-pages", base] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        toast(`Deleted “${page.title}”. The activity log records who, when and why.`);
        onDeleted();
      }}
      onClose={onClose}
    />
  );
}
