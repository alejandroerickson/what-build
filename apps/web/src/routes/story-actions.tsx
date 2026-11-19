import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { plural, quotedAtEnd } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { useToast } from "../ui/index.tsx";
import { ArchivedTitles } from "./archived-titles.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import { RenameDialog } from "./rename-dialog.tsx";
import { toServer, type Hierarchy, type PageView, type StoryNode } from "./story-model.ts";

/** A Story page as its actions need it: the tree's rows, the archived list and the page shown all have these. */
export interface PageRef {
  page_id: string;
  title: string;
  etag: string;
  archived_at: string | null;
}

/** What the tree and the inspector can ask of a page. Each is offered only to a role that may do it. */
export interface PageActions {
  rename: (page: PageRef) => void;
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
export function useArchiveActions(tree: StoryNode[]) {
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
    mutationFn: async ({ page, before }: { page: PageRef; before: StoryNode[] }) => {
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
      toast(inPlace ? `Restored ${quotedAtEnd(page.title)}` : `Restored ${quotedAtEnd(page.title)} The Story changed meanwhile, so it is at the end.`);
    },
    onError: (e, { page }) => {
      refresh(page.page_id);
      toast(`“${page.title}” couldn’t be restored. ${why(e)}`.trim(), { tone: "negative" });
    },
  });

  const archive = useMutation({
    mutationFn: ({ page }: { page: PageRef; before: StoryNode[] }) =>
      api<{ promoted_children: string[] }>("POST", `${base}/story/pages/${page.page_id}/archive`, { expected_etag: page.etag }),
    onSuccess: (r, { page, before }) => {
      refresh(page.page_id);
      const moved = r.promoted_children.length ? ` ${r.promoted_children.length === 1 ? "Its subpage moved" : "Its subpages moved"} up into its place.` : "";
      toast(`Archived ${quotedAtEnd(page.title)}${moved}`, { action: { label: "Undo", onClick: () => putBack.mutate({ page, before }) } });
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
      toast(`Restored ${quotedAtEnd(page.title)}`);
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

/**
 * Rename a Story page by hand: the title its navigation, crumbs and readers show. It publishes no
 * version, so the page's own HTML, and any heading in it, stays as the agent wrote it.
 */
export function RenamePage({ page, onClose }: { page: PageRef; onClose: () => void }) {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["story-tree", base] });
    void qc.invalidateQueries({ queryKey: ["story-pages", base] });
    void qc.invalidateQueries({ queryKey: ["story-page", base, page.page_id] });
  };
  return (
    <RenameDialog
      heading="Rename page"
      description="The page keeps its versions and its place, and what it says stays as it is. Readers and agents see the new title."
      current={page.title}
      save={(title) => api("PATCH", `${base}/story/pages/${page.page_id}`, { title, expected_etag: page.etag })}
      onSaved={(title) => toast(`Renamed to ${quotedAtEnd(title)}`)}
      onClose={() => {
        // Whatever came of it, the next try starts from the page as it is.
        refresh();
        onClose();
      }}
    />
  );
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
      alternative={page.archived_at || !canWrite ? undefined : { label: "Archive instead", onSelect: () => onArchive(page) }}
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
        toast(`Deleted ${quotedAtEnd(page.title)} The activity log records who, when and why.`);
        onClose();
        onDeleted();
      }}
      onClose={onClose}
    />
  );
}

/** What deleting every archived Story page destroys, as story.delete_archived_pages_impact reports it. */
interface ArchivedPagesImpact {
  etag: string;
  deleted_count: number;
  versions: number;
  mockups_shown: number;
  pages: { page_id: string; title: string; version_count: number }[];
}

/**
 * Delete every archived Story page at once, an admin's way of emptying the Story's archive. The
 * delete is guarded by the set the dialog shows: if a page is archived, restored or changed
 * meanwhile, the server refuses it and nothing goes.
 */
export function DeleteArchivedPages({ onClose }: { onClose: () => void }) {
  const { app, api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const impactPath = `${base}/story/archived-pages/delete-impact`;
  return (
    <DeleteDialog<ArchivedPagesImpact>
      title="Delete all archived Story pages permanently?"
      impactPath={impactPath}
      deletePath={`${base}/story/archived-pages`}
      allowed={(i) => i.deleted_count > 0}
      renderImpact={(i) =>
        i.deleted_count ? (
          <>
            <p>
              This deletes {i.deleted_count === 1 ? "the archived page below" : `all ${i.deleted_count} archived pages below`} with {plural(i.versions, "version")} and their notes. Links to
              them from other pages stop opening.
            </p>
            <ArchivedTitles titles={i.pages.map((p) => ({ id: p.page_id, title: p.title }))} label="Archived Story pages that would be deleted" />
            {i.mockups_shown ? (
              <p>
                {i.mockups_shown === 1 ? "A mockup canvas one of them shows is" : `${i.mockups_shown} mockup canvases they show are`} not touched.
              </p>
            ) : null}
          </>
        ) : (
          <p>
            <strong>No Story page is archived now.</strong>
          </p>
        )
      }
      onDeleted={() => {
        void qc.invalidateQueries({ queryKey: ["story-tree", base] });
        void qc.invalidateQueries({ queryKey: ["story-pages", base] });
        void qc.invalidateQueries({ queryKey: ["mockups", base] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        const impact = qc.getQueryData<ArchivedPagesImpact>(["delete-impact", impactPath]);
        const n = impact?.deleted_count ?? 0;
        toast(`Deleted ${n === 1 ? "1 archived Story page" : `${n} archived Story pages`}. The activity log records who, when and why.`);
        onClose();
        if (impact?.pages.some((p) => pathname.endsWith(`/story/${p.page_id}`))) navigate(`${app}/story`);
        qc.removeQueries({ queryKey: ["delete-impact", impactPath] });
      }}
      onClose={onClose}
    />
  );
}
