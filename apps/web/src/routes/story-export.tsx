import { useMemo, useState, type CSSProperties } from "react";
import { useProduct } from "../lib/session.tsx";
import { Button, ChoiceRow, Dialog } from "../ui/index.tsx";
import { flatten, MAX_PAGES, type Arrangement, type PageSummary, type StoryNode } from "./story-model.ts";

/**
 * Export to PDF: the person picks pages, and the browser prints the server's print view. Each
 * chosen page prints at its current version; the inspector's details stay behind.
 */
export function ExportDialog({ tree, archived, preselect, onClose }: { tree: Arrangement; archived: PageSummary[]; preselect: string[]; onClose: () => void }) {
  const { api: base } = useProduct();
  const groups = useMemo(() => {
    const out: { label: string | null; rows: { node: Pick<StoryNode, "page_id" | "title">; level: number }[] }[] = [];
    const placed = flatten(tree.placed);
    if (placed.length) out.push({ label: null, rows: placed });
    if (tree.unplaced.length) out.push({ label: "Unplaced pages", rows: tree.unplaced.map((n) => ({ node: n, level: 1 })) });
    if (archived.length) out.push({ label: "Archived pages", rows: archived.map((n) => ({ node: n, level: 1 })) });
    return out;
  }, [tree, archived]);
  const all = groups.flatMap((g) => g.rows.map((r) => r.node.page_id));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect.filter((id) => all.includes(id))));
  const ids = all.filter((id) => picked.has(id)).slice(0, MAX_PAGES);
  const href = ids.length ? `${base}/story/print?page_ids=${ids.map(encodeURIComponent).join(",")}` : undefined;
  const flip = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Export to PDF"
      description="The PDF holds the pages you select, in the Story's order: a contents list, then each page's current version under its title, with its version number and publish date."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {href ? (
            <a className="btn btn-primary btn-md" href={href} target="_blank" rel="noopener" onClick={() => setTimeout(onClose, 0)}>
              Open print view
            </a>
          ) : (
            <a className="btn btn-primary btn-md story-link-disabled" role="link" aria-disabled="true">
              Open print view
            </a>
          )}
        </>
      }
    >
      <div className="story-export-bar">
        <span className="small muted" aria-live="polite">
          {ids.length} of {all.length} {all.length === 1 ? "page" : "pages"} selected
        </span>
        <span className="row">
          <Button size="sm" variant="quiet" onClick={() => setPicked(new Set(all))}>
            Select all
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </span>
      </div>
      <div className="story-export-list">
        {groups.map((g) => (
          <fieldset key={g.label ?? "tree"} className="story-export-group">
            <legend className={g.label ? "story-export-legend" : "visually-hidden"}>{g.label ?? "Story pages"}</legend>
            {g.rows.map(({ node, level }) => (
              <div key={node.page_id} className="story-choice-indent" style={{ "--level": level - 1 } as CSSProperties}>
                <ChoiceRow label={node.title} checked={picked.has(node.page_id)} onChange={(e) => flip(node.page_id, e.target.checked)} />
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <p className="small muted">
        It opens in a new tab with your browser's print dialog: choose Save as PDF. Left out: what a page draws on, its cited passages and notes for agents, earlier versions, and anything a page draws with scripts.
      </p>
    </Dialog>
  );
}
