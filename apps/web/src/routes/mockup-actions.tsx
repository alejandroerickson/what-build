import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { plural, quotedAtEnd } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { useToast } from "../ui/index.tsx";
import { DeleteDialog } from "./delete-dialog.tsx";
import { ArchivedTitles } from "./archived-titles.tsx";
import { RenameDialog } from "./rename-dialog.tsx";

/** A mockup as its actions need it: a row of the list, an archived one, and the one on screen all have these. */
export interface MockupRef {
  mockup_id: string;
  title: string;
  etag: string;
  archived_at: string | null;
}

/** What the panel's rows and the inspector can ask of a mockup. Each is offered only to a role that may do it: renaming, archiving and restoring to whoever can write, deleting to an admin. */
export interface MockupActions {
  rename: (m: MockupRef) => void;
  archive: (m: MockupRef) => void;
  restore: (m: MockupRef) => void;
  remove: (m: MockupRef) => void;
}

/** Actions that do nothing, for the tutorial's example canvas. */
export const NO_MOCKUP_ACTIONS: MockupActions = { rename: () => {}, archive: () => {}, restore: () => {}, remove: () => {} };

function why(e: unknown): string {
  if (e instanceof ApiError && e.code === "stale_etag") return "It changed since you opened it. Try again.";
  return e instanceof Error ? e.message : "";
}

/**
 * Rename, archive, restore and delete a mockup by hand, as agents do through MCP. Renaming
 * publishes no version. An archived mockup keeps its folder and its place, so Undo, which restores
 * it, puts it back where it stood. `dialogs` holds the rename and delete dialogs, to render beside
 * whatever offers them.
 */
export function useMockupActions(): { actions: MockupActions; dialogs: ReactNode } {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const [renaming, setRenaming] = useState<MockupRef | null>(null);
  const [deleting, setDeleting] = useState<MockupRef | null>(null);

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

  const renameDialog = renaming ? (
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
    actions: { rename: setRenaming, archive: (m) => archive.mutate(m), restore: (m) => restore.mutate(m), remove: setDeleting },
    dialogs: (
      <>
        {renameDialog}
        {deleting ? <DeleteMockup mockup={deleting} onArchive={() => archive.mutate(deleting)} onClose={() => setDeleting(null)} /> : null}
      </>
    ),
  };
}

/** What deleting a mockup destroys, as mockups.delete_impact reports it. */
interface MockupImpact {
  etag: string;
  version_count: number;
  story_pages_showing: { page_id: string; title: string; archived: boolean }[];
  earlier_story_versions_showing: { page_id: string; title: string; version: number }[];
}

/** What deleting a mockup deletes, as its dialog says it: every version, each with its own pages, notes, files and brief. */
export function mockupImpactWords(title: string, versions: number): string {
  return versions === 1
    ? `This deletes “${title}” with its only version: its pages, notes, files and brief.`
    : `This deletes “${title}” with all ${versions} of its versions: their pages, notes, files and briefs.`;
}

/** The Story pages that hold a mockup, each a link, archived ones marked. */
function ShowingPages({ pages }: { pages: { page_id: string; title: string; archived: boolean }[] }) {
  const { app } = useProduct();
  return (
    <ul className="delete-impact-list">
      {pages.map((p) => (
        <li key={p.page_id}>
          <Link to={`${app}/story/${p.page_id}`}>{p.title}</Link>
          {p.archived ? <span className="faint"> · archived</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Delete a mockup for good. A Story page that shows it holds it: that page goes, or gets HTML of its
 * own, first. Deleting the mockup on screen goes back to the list.
 */
function DeleteMockup({ mockup, onArchive, onClose }: { mockup: MockupRef; onArchive: () => void; onClose: () => void }) {
  const { app, api: base, canWrite } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <DeleteDialog<MockupImpact>
      title="Delete this mockup permanently?"
      impactPath={`${base}/mockups/${mockup.mockup_id}/delete-impact`}
      deletePath={`${base}/mockups/${mockup.mockup_id}`}
      alternative={mockup.archived_at || !canWrite ? undefined : { label: "Archive instead", onSelect: onArchive }}
      allowed={(i) => !i.story_pages_showing.length}
      renderImpact={(i) =>
        i.story_pages_showing.length ? (
          <>
            <p>
              <strong>{i.story_pages_showing.length === 1 ? "A Story page shows" : `${i.story_pages_showing.length} Story pages show`} this mockup.</strong> Delete{" "}
              {i.story_pages_showing.length === 1 ? "that page" : "those pages"} first.
            </p>
            <ShowingPages pages={i.story_pages_showing} />
          </>
        ) : (
          <>
            <p>{mockupImpactWords(mockup.title, i.version_count)}</p>
            {i.earlier_story_versions_showing.length ? (
              <p>
                {i.earlier_story_versions_showing.length === 1 ? "An earlier version of a Story page shows it, and will" : `${i.earlier_story_versions_showing.length} earlier versions of Story pages show it, and will`}{" "}
                show an empty page.
              </p>
            ) : null}
          </>
        )
      }
      onDeleted={() => {
        void qc.invalidateQueries({ queryKey: ["mockups", base] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        toast(`Deleted ${quotedAtEnd(mockup.title)} The activity log records who, when and why.`);
        onClose();
        if (pathname.includes(`/exploration/mockups/${mockup.mockup_id}`)) navigate(`${app}/exploration/mockups`);
      }}
      onClose={onClose}
    />
  );
}

/** What deleting every archived mockup destroys, as mockups.delete_archived_impact reports it. */
interface ArchivedMockupsImpact {
  etag: string;
  deleted_count: number;
  held_count: number;
  versions: number;
  mockups: { mockup_id: string; title: string; version_count: number }[];
  held: { mockup_id: string; title: string; story_pages_showing: { page_id: string; title: string; archived: boolean }[] }[];
}

/**
 * Delete every archived mockup at once, an admin's way of emptying the archive. Mockups a Story page
 * shows stay archived, each with the pages that hold it. The delete is guarded by the set the dialog
 * shows: if one is archived, restored or changed meanwhile, the server refuses it and nothing goes.
 */
export function DeleteArchivedMockups({ onClose }: { onClose: () => void }) {
  const { app, api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <DeleteDialog<ArchivedMockupsImpact>
      title="Delete all archived mockup canvases permanently?"
      impactPath={`${base}/archived-mockups/delete-impact`}
      deletePath={`${base}/archived-mockups`}
      allowed={(i) => i.deleted_count > 0}
      renderImpact={(i) => (
        <>
          {i.deleted_count ? (
            <>
              <p>
                This deletes {i.deleted_count === 1 ? "the archived mockup canvas below" : `all ${i.deleted_count} archived mockup canvases below`} with{" "}
                {plural(i.versions, "version")}: their pages, notes, files, prototypes and briefs.
              </p>
              <ArchivedTitles titles={i.mockups.map((m) => ({ id: m.mockup_id, title: m.title }))} label="Archived mockup canvases that would be deleted" />
            </>
          ) : (
            <p>
              <strong>None of the archived mockup canvases can be deleted yet.</strong>
            </p>
          )}
          {i.held_count ? (
            <>
              <p>
                {i.held_count === 1 ? "One stays archived, because a Story page shows it" : `${i.held_count} stay archived, because Story pages show them`}.{" "}
                {i.held.flatMap((m) => m.story_pages_showing).length === 1
                  ? "Delete that page first, or ask your agent to publish it with HTML of its own."
                  : "Delete those pages first, or ask your agent to publish them with HTML of their own."}
              </p>
              <ul className="delete-impact-list">
                {i.held.map((m) => (
                  <li key={m.mockup_id}>
                    {m.title}
                    <span className="faint">
                      {" "}
                      · shown on{" "}
                      {m.story_pages_showing.map((p, n) => (
                        <span key={p.page_id}>
                          {n ? ", " : ""}
                          <Link to={`${app}/story/${p.page_id}`}>{p.title}</Link>
                          {p.archived ? " (archived)" : ""}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
      onDeleted={() => {
        void qc.invalidateQueries({ queryKey: ["mockups", base] });
        void qc.invalidateQueries({ queryKey: ["product"] });
        // The impact was read when the dialog opened; what it listed is what went.
        const impact = qc.getQueryData<ArchivedMockupsImpact>(["delete-impact", `${base}/archived-mockups/delete-impact`]);
        const n = impact?.deleted_count ?? 0;
        toast(`Deleted ${n === 1 ? "1 archived mockup canvas" : `${n} archived mockup canvases`}. The activity log records who, when and why.`);
        onClose();
        if (impact?.mockups.some((m) => pathname.includes(`/exploration/mockups/${m.mockup_id}`))) navigate(`${app}/exploration/mockups`);
        qc.removeQueries({ queryKey: ["delete-impact", `${base}/archived-mockups/delete-impact`] });
      }}
      onClose={onClose}
    />
  );
}
