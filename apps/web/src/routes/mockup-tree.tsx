import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import { PanelFilter, PanelSection } from "../shell/slots.tsx";
import { Button, Dialog, ErrorCallout, Glyph, IconButton, Menu, MenuGroup, MenuItem, MenuRadio, MenuSeparator, OneLine, TextField, tooLong, useToast } from "../ui/index.tsx";
import {
  applyMove, changesNothing, describePlace, FOLDER_NAME_MAX, keyboardMove, mockupsIn, moveBack,
  type ArrowKey, type MockupFolder, type MockupList, type MockupMove, type MockupSummary,
} from "./mockup-folders-model.ts";
import { useMockupList } from "./mockups.tsx";

/**
 * The mockups in the panel: those in no folder, then each folder with its own, one level deep.
 * Anyone who can write arranges them by hand, as the Story's pages are (story-tree.tsx, whose row
 * styles these rows share): a mockup or a folder is dragged by its handle or moved with Alt and
 * the arrow keys, and a mockup's menu names the folder to put it in. Everyone in the product sees
 * the one arrangement; which folders are folded away is each person's own, kept in this browser.
 */

// ---- Saving moves -------------------------------------------------------------------------------

/**
 * Moves a mockup or a folder. The panel shows the move at once, and the moves are saved one after
 * another. Each says where something goes beside what (in front of this mockup, in that folder),
 * so one made while someone else rearranges still lands where the person put it; if what it named
 * has gone, the person is told and the list shows the mockups as they are.
 */
function useArrange(base: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = useMemo(() => ["mockups", base], [base]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);
  return (m: MockupMove): MockupList | null => {
    const now = qc.getQueryData<MockupList>(key);
    if (!now) return null;
    const next = applyMove(now, m);
    void qc.cancelQueries({ queryKey: key });
    qc.setQueryData(key, next);
    waiting.current++;
    chain.current = chain.current.then(async () => {
      try {
        if (m.kind === "mockup") await api("POST", `${base}/mockups/${m.id}/move`, { folder_id: m.folder, before_mockup_id: m.before });
        else await api("POST", `${base}/mockup-folders/${m.id}/move`, { before_folder_id: m.before });
      } catch (e) {
        const raced = e instanceof ApiError && (e.code === "invalid_move" || e.isNotFound);
        toast(
          raced
            ? "Someone else rearranged the mockups at the same time, and your move no longer fits. The list now shows them as they are."
            : `Your move was not saved. ${e instanceof Error ? e.message : ""}`.trim(),
          { tone: "negative" },
        );
      } finally {
        if (--waiting.current === 0) void qc.invalidateQueries({ queryKey: key });
        if (m.kind === "mockup") void qc.invalidateQueries({ queryKey: ["mockup", base, m.id] });
      }
    });
    return next;
  };
}

// ---- The tree -----------------------------------------------------------------------------------

type RowKind = "mockup" | "folder";
const rowKey = (kind: RowKind, id: string) => `${kind}:${id}`;

type Zone = "before" | "after" | "into" | "out";
interface Drag {
  kind: RowKind;
  id: string;
  x: number;
  y: number;
  active: boolean;
  /** Where it would land: the row that shows it, how, and the move a release makes. Null over nothing, or where a drop would change nothing. */
  over: { row: string | null; zone: Zone; move: MockupMove } | null;
}

type Asking = { kind: "new"; then?: MockupSummary } | { kind: "rename"; folder: MockupFolder } | { kind: "remove"; folder: MockupFolder };

function readCollapsed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function MockupTree() {
  const { app, api: base, product, canWrite } = useProduct();
  const { pathname } = useLocation();
  // The panel sits above the screen's route, so it reads the open mockup from the path.
  const current = /\/exploration\/mockups\/([^/]+)/.exec(pathname)?.[1];
  const onIndex = /\/exploration\/mockups\/?$/.test(pathname);
  const query = useMockupList();
  const list = query.data;
  const qc = useQueryClient();
  const toast = useToast();
  const arrange = useArrange(base);
  const storeKey = `whatbuild.mockup-folders-collapsed.${product.product_id}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(storeKey));
  const [announcement, setAnnouncement] = useState("");
  const [asking, setAsking] = useState<Asking | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const focusRequest = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const saveCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify([...next]));
    } catch {
      // Only a convenience; the folders still open and close.
    }
  };
  const open = (folder: string) => {
    if (!collapsed.has(folder)) return;
    const next = new Set(collapsed);
    next.delete(folder);
    saveCollapsed(next);
  };
  const toggle = (folder: string) => {
    const next = new Set(collapsed);
    if (!next.delete(folder)) next.add(folder);
    saveCollapsed(next);
  };

  // The folder of the mockup on screen is always open, so a link never lands on a row that is folded away.
  const currentFolder = list?.items.find((m) => m.mockup_id === current)?.folder_id ?? null;
  useEffect(() => {
    if (currentFolder) open(currentFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolder]);

  const announce = (text: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(text));
  };

  const nameOf = (m: MockupMove) =>
    m.kind === "folder" ? `the folder “${list?.folders.find((f) => f.folder_id === m.id)?.name ?? ""}”` : `“${list?.items.find((x) => x.mockup_id === m.id)?.title ?? ""}”`;

  /** Applies a move: a drag or a menu choice gets a toast with Undo, a keyboard move is announced. */
  const commit = (m: MockupMove, how: "keyboard" | "pointer") => {
    if (!list || changesNothing(list, m)) return;
    const back = moveBack(list, m);
    const next = arrange(m);
    if (!next) return;
    if (m.kind === "mockup" && m.folder) open(m.folder);
    focusRequest.current = rowKey(m.kind, m.id);
    const said = `Moved ${nameOf(m)} ${describePlace(next, m)}.`;
    if (how === "keyboard") announce(said);
    else toast(said, back ? { action: { label: "Undo", onClick: () => void arrange(back) } } : undefined);
  };

  // ---- Pointer dragging: the grip starts it; the row under the pointer takes it -------------------

  const overAt = (x: number, y: number, d: Drag): Drag["over"] => {
    if (!list) return null;
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-target]");
    if (!el || !rootRef.current?.contains(el)) return null;
    const target = el.dataset["dropTarget"];
    const id = el.dataset["id"] ?? "";
    const upper = () => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    };
    const settle = (row: string | null, zone: Zone, move: MockupMove): Drag["over"] => (changesNothing(list, move) ? null : { row, zone, move });
    if (d.kind === "mockup") {
      if (target === "out") return settle(null, "out", { kind: "mockup", id: d.id, folder: null, before: null });
      if (target === "folder") return settle(rowKey("folder", id), "into", { kind: "mockup", id: d.id, folder: id, before: null });
      const at = list.items.find((m) => m.mockup_id === id);
      if (!at || id === d.id) return null;
      if (upper()) return settle(rowKey("mockup", id), "before", { kind: "mockup", id: d.id, folder: at.folder_id, before: id });
      const there = mockupsIn(list, at.folder_id).filter((m) => m.mockup_id !== d.id);
      const after = there[there.findIndex((m) => m.mockup_id === id) + 1];
      return settle(rowKey("mockup", id), "after", { kind: "mockup", id: d.id, folder: at.folder_id, before: after?.mockup_id ?? null });
    }
    // A folder goes in front of or after another folder; over a folder's mockups, after that folder.
    const folder = target === "folder" ? id : target === "mockup" ? (el.dataset["folder"] ?? "") : "";
    if (!folder || folder === d.id) return null;
    const others = list.folders.filter((f) => f.folder_id !== d.id);
    if (target === "folder" && upper()) return settle(rowKey("folder", folder), "before", { kind: "folder", id: d.id, before: folder });
    const after = others[others.findIndex((f) => f.folder_id === folder) + 1];
    // The bar sits under the folder's last row on screen: its last mockup while it is open.
    const last = collapsed.has(folder) ? undefined : mockupsIn(list, folder).at(-1);
    return settle(last ? rowKey("mockup", last.mockup_id) : rowKey("folder", folder), "after", { kind: "folder", id: d.id, before: after?.folder_id ?? null });
  };

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const onGripDown = (e: ReactPointerEvent<HTMLElement>, kind: RowKind, id: string) => {
    if (e.button !== 0 || !canWrite) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ kind, id, x: e.clientX, y: e.clientY, active: false, over: null });
  };
  const onGripMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const active = d.active || Math.abs(e.clientY - d.y) > 4 || Math.abs(e.clientX - d.x) > 4;
    if (!active) return;
    const scroller = rootRef.current?.closest<HTMLElement>(".panel-context-body");
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (e.clientY < r.top + 24) scroller.scrollBy(0, -8);
      else if (e.clientY > r.bottom - 24) scroller.scrollBy(0, 8);
    }
    setDragState({ ...d, active: true, over: overAt(e.clientX, e.clientY, d) });
  };
  const onGripUp = () => {
    const d = dragRef.current;
    setDragState(null);
    if (d?.active && d.over) commit(d.over.move, "pointer");
  };
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setDragState(null);
      announce("Move cancelled.");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);

  // ---- Keyboard: one tab stop, the arrow keys between rows, Alt with them to move ------------------

  const loose = list ? mockupsIn(list, null) : [];
  const visible = useMemo(() => {
    const out: { key: string; kind: RowKind; id: string; folder: string | null }[] = [];
    if (!list) return out;
    for (const m of mockupsIn(list, null)) out.push({ key: rowKey("mockup", m.mockup_id), kind: "mockup", id: m.mockup_id, folder: null });
    for (const f of list.folders) {
      out.push({ key: rowKey("folder", f.folder_id), kind: "folder", id: f.folder_id, folder: null });
      if (!collapsed.has(f.folder_id)) for (const m of mockupsIn(list, f.folder_id)) out.push({ key: rowKey("mockup", m.mockup_id), kind: "mockup", id: m.mockup_id, folder: f.folder_id });
    }
    return out;
  }, [list, collapsed]);
  const currentKey = current ? rowKey("mockup", current) : null;
  const tabStop = (focusKey && visible.some((v) => v.key === focusKey) ? focusKey : null) ?? (currentKey && visible.some((v) => v.key === currentKey) ? currentKey : null) ?? visible[0]?.key ?? null;

  const focusRow = (key: string) => {
    setFocusKey(key);
    rootRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"] [role="treeitem"]`)?.focus();
  };
  // A row's "…" button follows its row in the tab order, and a row just moved keeps the focus.
  useLayoutEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>(".story-row-more").forEach((b) => {
      b.tabIndex = b.closest<HTMLElement>("[data-row]")?.dataset["row"] === tabStop ? 0 : -1;
    });
    const want = focusRequest.current;
    if (want && visible.some((v) => v.key === want)) {
      focusRequest.current = null;
      focusRow(want);
    }
  });

  const openRowMenu = (key: string) => rootRef.current?.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(key)}"] .story-row-more`)?.click();

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, key: string) => {
    const i = visible.findIndex((v) => v.key === key);
    const v = visible[i];
    if (!v || !list) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (!canWrite) return;
      const m = keyboardMove(list, v.kind, v.id, e.key as ArrowKey);
      if ("reason" in m) announce(m.reason);
      else commit(m, "keyboard");
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const go = (n: number) => {
      e.preventDefault();
      const t = visible[Math.max(0, Math.min(visible.length - 1, n))];
      if (t) focusRow(t.key);
    };
    const isFolder = v.kind === "folder";
    const isOpen = isFolder && !collapsed.has(v.id);
    switch (e.key) {
      case "ArrowDown":
        return go(i + 1);
      case "ArrowUp":
        return go(i - 1);
      case "Home":
        return go(0);
      case "End":
        return go(visible.length - 1);
      case "ArrowRight":
        e.preventDefault();
        if (isFolder && !isOpen) toggle(v.id);
        else if (isFolder && mockupsIn(list, v.id).length) go(i + 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (isOpen) toggle(v.id);
        else if (v.folder) focusRow(rowKey("folder", v.folder));
        return;
      case "ContextMenu":
        e.preventDefault();
        openRowMenu(key);
        return;
      case "F10":
        if (e.shiftKey) {
          e.preventDefault();
          openRowMenu(key);
        }
        return;
    }
  };

  // ---- Folders: made, renamed and removed ---------------------------------------------------------

  const refresh = () => void qc.invalidateQueries({ queryKey: ["mockups", base] });
  const remove = async (f: MockupFolder) => {
    setAsking(null);
    try {
      await api("POST", `${base}/mockup-folders/${f.folder_id}/remove`, {});
      toast(`Removed the folder “${f.name}”.${f.mockup_count ? ` Its ${f.mockup_count === 1 ? "mockup is" : `${f.mockup_count} mockups are`} in no folder now.` : ""}`);
    } catch (e) {
      toast(`The folder was not removed. ${e instanceof Error ? e.message : ""}`.trim(), { tone: "negative" });
    } finally {
      refresh();
    }
  };

  if (!list || (!list.items.length && !list.folders.length))
    return (
      <PanelSection title="Mockups" end={canWrite && list ? <NewFolderButton onClick={() => setAsking({ kind: "new" })} /> : undefined}>
        <PanelFilter to={`${app}/exploration/mockups`} current={onIndex} replace={false}>
          {query.isPending ? "Loading…" : "None yet"}
        </PanelFilter>
        {asking?.kind === "new" ? <FolderDialog base={base} onClose={() => setAsking(null)} onSaved={refresh} /> : null}
      </PanelSection>
    );

  const dragged = drag?.active ? drag : null;
  const dropOf = (key: string) => (dragged?.over?.row === key ? dragged.over.zone : undefined);
  // While a mockup that is in a folder is dragged, a place to drop it out of every folder.
  const offerOut = dragged?.kind === "mockup" && list.items.find((m) => m.mockup_id === dragged.id)?.folder_id != null;
  const grip = (kind: RowKind, id: string) =>
    canWrite ? (
      <span className="story-grip" aria-hidden="true" title="Drag to move" onPointerDown={(e) => onGripDown(e, kind, id)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
        <Glyph name="grip" size="sm" />
      </span>
    ) : (
      <span className="story-grip-space" aria-hidden="true" />
    );

  const mockupRow = (m: MockupSummary, level: number, pos: number, size: number) => {
    const key = rowKey("mockup", m.mockup_id);
    const isCurrent = m.mockup_id === current;
    return (
      <li key={key} role="none" className="story-node">
        <div
          className="story-row"
          data-row={key}
          data-drop-target="mockup"
          data-id={m.mockup_id}
          data-folder={m.folder_id ?? ""}
          data-current={isCurrent || undefined}
          data-dragging={dragged?.kind === "mockup" && dragged.id === m.mockup_id ? "" : undefined}
          data-drop={dropOf(key)}
          style={{ "--level": level - 1 } as CSSProperties}
        >
          {grip("mockup", m.mockup_id)}
          <span className="story-indent" aria-hidden="true" />
          <Link
            to={`${app}/exploration/mockups/${m.mockup_id}`}
            role="treeitem"
            className="story-link"
            aria-level={level}
            aria-setsize={size}
            aria-posinset={pos}
            aria-current={isCurrent ? "page" : undefined}
            aria-keyshortcuts={canWrite ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft" : undefined}
            tabIndex={tabStop === key ? 0 : -1}
            onFocus={() => setFocusKey(key)}
            onKeyDown={(e) => onKeyDown(e, key)}
          >
            <span className="story-kind">
              <Glyph name="layout-grid" />
            </span>
            <OneLine text={m.title} />
          </Link>
          {canWrite ? (
            <Menu label={`Move “${m.title}”`} trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm story-row-more" minWidth={220}>
              <MenuGroup label="Folder">
                <MenuRadio checked={m.folder_id === null} onSelect={() => commit({ kind: "mockup", id: m.mockup_id, folder: null, before: null }, "pointer")}>
                  No folder
                </MenuRadio>
                {list.folders.map((f) => (
                  <MenuRadio key={f.folder_id} checked={m.folder_id === f.folder_id} onSelect={() => commit({ kind: "mockup", id: m.mockup_id, folder: f.folder_id, before: null }, "pointer")}>
                    {f.name}
                  </MenuRadio>
                ))}
              </MenuGroup>
              <MenuSeparator />
              <MenuItem icon="folder-plus" onSelect={() => setAsking({ kind: "new", then: m })}>
                New folder…
              </MenuItem>
            </Menu>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <PanelSection title="Mockups" end={canWrite ? <NewFolderButton onClick={() => setAsking({ kind: "new" })} /> : undefined}>
      <div ref={rootRef} className={`mockup-tree${dragged ? " is-dragging" : ""}`}>
        <ul role="tree" aria-label="Mockups" className="story-tree">
          {loose.map((m, i) => mockupRow(m, 1, i + 1, loose.length + list.folders.length))}
          {offerOut ? (
            <li role="none">
              <div className="story-drop-end" data-drop-target="out" data-drop={dragged?.over?.zone === "out" ? "end" : undefined}>
                Move out of its folder
              </div>
            </li>
          ) : null}
          {list.folders.map((f, i) => (
            <FolderRows
              key={f.folder_id}
              folder={f}
              mockups={mockupsIn(list, f.folder_id)}
              open={!collapsed.has(f.folder_id)}
              pos={loose.length + i + 1}
              size={loose.length + list.folders.length}
              tabStop={tabStop}
              canWrite={canWrite}
              dragging={dragged?.kind === "folder" && dragged.id === f.folder_id}
              drop={dropOf(rowKey("folder", f.folder_id))}
              grip={grip("folder", f.folder_id)}
              onToggle={() => toggle(f.folder_id)}
              onFocus={setFocusKey}
              onKeyDown={onKeyDown}
              onRename={() => setAsking({ kind: "rename", folder: f })}
              onRemove={() => (f.mockup_count ? setAsking({ kind: "remove", folder: f }) : void remove(f))}
              row={mockupRow}
            />
          ))}
        </ul>
        {canWrite && list.items.length + list.folders.length > 1 ? (
          <p className="story-tree-hint">Drag a mockup by its handle to reorder it or put it in a folder. With one focused, Alt + arrow keys move it.</p>
        ) : null}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </div>
      {asking?.kind === "new" || asking?.kind === "rename" ? (
        <FolderDialog
          base={base}
          folder={asking.kind === "rename" ? asking.folder : undefined}
          onClose={() => setAsking(null)}
          onSaved={(f) => {
            const then = asking.kind === "new" ? asking.then : undefined;
            const now = qc.getQueryData<MockupList>(["mockups", base]);
            // A folder made from a mockup's menu takes that mockup: it is added to the list here, so the move shows at once.
            if (then && now && !now.folders.some((x) => x.folder_id === f.folder_id)) {
              qc.setQueryData<MockupList>(["mockups", base], { ...now, folders: [...now.folders, f] });
              void arrange({ kind: "mockup", id: then.mockup_id, folder: f.folder_id, before: null });
              toast(`Moved “${then.title}” into the folder “${f.name}”.`);
            } else refresh();
          }}
        />
      ) : null}
      {asking?.kind === "remove" ? (
        <Dialog
          open
          onClose={() => setAsking(null)}
          title={`Remove the folder “${asking.folder.name}”?`}
          description={`Its ${asking.folder.mockup_count === 1 ? "mockup stays" : `${asking.folder.mockup_count} mockups stay`}, in no folder. Nothing is deleted.`}
          footer={
            <>
              <Button onClick={() => setAsking(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void remove(asking.folder)}>
                Remove folder
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      ) : null}
    </PanelSection>
  );
}

function NewFolderButton({ onClick }: { onClick: () => void }) {
  return <IconButton size="sm" icon="folder-plus" label="New folder" onClick={onClick} />;
}

/** A folder's row and, while it is open, the mockups in it. */
function FolderRows({ folder, mockups, open, pos, size, tabStop, canWrite, dragging, drop, grip, onToggle, onFocus, onKeyDown, onRename, onRemove, row }: {
  folder: MockupFolder;
  mockups: MockupSummary[];
  open: boolean;
  pos: number;
  size: number;
  tabStop: string | null;
  canWrite: boolean;
  dragging: boolean;
  drop: Zone | undefined;
  grip: ReactNode;
  onToggle: () => void;
  onFocus: (key: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>, key: string) => void;
  onRename: () => void;
  onRemove: () => void;
  row: (m: MockupSummary, level: number, pos: number, size: number) => ReactNode;
}) {
  const key = rowKey("folder", folder.folder_id);
  const groupId = useId();
  return (
    <li role="none" className="story-node">
      <div className="story-row mockup-folder-row" data-row={key} data-drop-target="folder" data-id={folder.folder_id} data-dragging={dragging ? "" : undefined} data-drop={drop} style={{ "--level": 0 } as CSSProperties}>
        {grip}
        <button
          type="button"
          role="treeitem"
          className="story-link mockup-folder"
          aria-level={1}
          aria-setsize={size}
          aria-posinset={pos}
          aria-expanded={open}
          aria-owns={open ? groupId : undefined}
          aria-label={`${folder.name}, folder, ${folder.mockup_count === 1 ? "1 mockup" : `${folder.mockup_count} mockups`}`}
          aria-keyshortcuts={canWrite ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          tabIndex={tabStop === key ? 0 : -1}
          onClick={onToggle}
          onFocus={() => onFocus(key)}
          onKeyDown={(e) => onKeyDown(e, key)}
        >
          <span className="story-caret" aria-hidden="true" data-open={open || undefined}>
            <Glyph name="chevron-right" size="sm" />
          </span>
          <span className="story-kind">
            <Glyph name="folder" />
          </span>
          <OneLine text={folder.name} />
          <span className="mockup-folder-count num">{folder.mockup_count}</span>
        </button>
        {canWrite ? (
          <Menu label={`Actions for the folder “${folder.name}”`} trigger={<Glyph name="ellipsis" />} triggerClassName="icon-btn icon-btn-sm story-row-more" minWidth={200}>
            <MenuItem icon="pencil" onSelect={onRename}>
              Rename…
            </MenuItem>
            <MenuItem icon="x" meta={folder.mockup_count ? "Keeps its mockups" : undefined} onSelect={onRemove}>
              {folder.mockup_count ? "Remove folder…" : "Remove folder"}
            </MenuItem>
          </Menu>
        ) : null}
      </div>
      {open ? (
        <ul role="group" id={groupId} className="story-tree">
          {mockups.length ? (
            mockups.map((m, i) => row(m, 2, i + 1, mockups.length))
          ) : (
            <li role="none" className="mockup-folder-empty">
              No mockups in this folder
            </li>
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** Names a new folder, or renames one. */
function FolderDialog({ base, folder, onClose, onSaved }: { base: string; folder?: MockupFolder; onClose: () => void; onSaved: (f: MockupFolder) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(folder?.name ?? "");
  const trimmed = name.trim();
  const save = useMutation({
    mutationFn: () =>
      folder
        ? api<MockupFolder>("PATCH", `${base}/mockup-folders/${folder.folder_id}`, { name: trimmed, expected_etag: folder.etag })
        : api<MockupFolder>("POST", `${base}/mockup-folders`, { name: trimmed }),
    onSuccess: (f) => {
      onSaved(f);
      onClose();
    },
    // Whatever refused it, the list is read again, so a second try starts from the folders as they are.
    onError: () => void qc.invalidateQueries({ queryKey: ["mockups", base] }),
  });
  const valid = trimmed.length > 0 && !tooLong(name, FOLDER_NAME_MAX) && trimmed !== folder?.name;
  // Someone else renamed it meanwhile: say that, in place of the server's words for an agent.
  const stale = save.error instanceof ApiError && save.error.code === "stale_etag";
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!save.isPending}
      title={folder ? "Rename folder" : "New folder"}
      description={folder ? undefined : "A folder holds mockups, not other folders. Everyone in the product sees it."}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!valid} onClick={() => save.mutate()}>
            {folder ? "Rename" : "Create folder"}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !save.isPending) save.mutate();
        }}
      >
        <TextField label="Name" value={name} maxLength={FOLDER_NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} />
        {save.isError ? <ErrorCallout inset error={stale ? new Error("Someone else renamed this folder just now. Close this, and rename it again if you still want to.") : save.error} /> : null}
      </form>
    </Dialog>
  );
}
