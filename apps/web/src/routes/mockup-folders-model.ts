/**
 * How a product's mockups are arranged, as data: the mockups in no folder, then each folder with
 * its own, all in the order people gave them. Pure functions, so dragging, the keyboard and a row's
 * menu share them, and the panel can show a move before the server has answered.
 */

export interface MockupSummary {
  mockup_id: string;
  title: string;
  summary: string;
  /** The folder it sits in, or null for none. */
  folder_id: string | null;
  current_version: number;
  archived_at: string | null;
  etag: string;
  updated_at: string;
  page_count: number;
}

export interface MockupFolder {
  folder_id: string;
  name: string;
  etag: string;
  /** The mockups in it that are not archived. */
  mockup_count: number;
}

/** mockups.list: `items` in the order people see them, and the folders in theirs. */
export interface MockupList {
  items: MockupSummary[];
  folders: MockupFolder[];
}

/** The longest name a folder takes (mockups.create_folder). */
export const FOLDER_NAME_MAX = 80;

/** A mockup put in a folder (null for none) in front of another there, or last; or a folder put in front of another, or last. */
export type MockupMove = { kind: "mockup"; id: string; folder: string | null; before: string | null } | { kind: "folder"; id: string; before: string | null };

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** The mockups in a folder, or in none, in their order. */
export function mockupsIn(list: MockupList, folder: string | null): MockupSummary[] {
  return list.items.filter((m) => m.folder_id === folder);
}

const folderName = (list: MockupList, folder: string | null) => list.folders.find((f) => f.folder_id === folder)?.name;

/** Where a mockup sits, in words: "in the folder Checkout", "in no folder". */
export function placeWords(list: MockupList, folder: string | null): string {
  const name = folderName(list, folder);
  return name === undefined ? "in no folder" : `in the folder “${name}”`;
}

/** The list after a move: the same mockups and folders, in the order the move leaves them, each folder counted again. */
export function applyMove(list: MockupList, m: MockupMove): MockupList {
  if (m.kind === "folder") {
    const moving = list.folders.find((f) => f.folder_id === m.id);
    if (!moving) return list;
    const others = list.folders.filter((f) => f.folder_id !== m.id);
    const found = m.before === null ? -1 : others.findIndex((f) => f.folder_id === m.before);
    const at = found < 0 ? others.length : found;
    return ordered(list.items, [...others.slice(0, at), moving, ...others.slice(at)]);
  }
  const moving = list.items.find((x) => x.mockup_id === m.id);
  if (!moving) return list;
  const others = list.items.filter((x) => x.mockup_id !== m.id);
  const there = others.filter((x) => x.folder_id === m.folder);
  const found = m.before === null ? -1 : there.findIndex((x) => x.mockup_id === m.before);
  const at = found < 0 ? there.length : found;
  const placed = [...there.slice(0, at), { ...moving, folder_id: m.folder }, ...there.slice(at)];
  return ordered([...others.filter((x) => x.folder_id !== m.folder), ...placed], list.folders);
}

/** Mockups grouped as the list gives them: those in no folder, then each folder's, with the folders counted. */
function ordered(items: MockupSummary[], folders: MockupFolder[]): MockupList {
  const known = new Set(folders.map((f) => f.folder_id));
  const of = (folder: string | null) => items.filter((x) => (folder === null ? x.folder_id === null || !known.has(x.folder_id) : x.folder_id === folder));
  return {
    items: [...of(null), ...folders.flatMap((f) => of(f.folder_id))],
    folders: folders.map((f) => ({ ...f, mockup_count: of(f.folder_id).filter((x) => !x.archived_at).length })),
  };
}

/** The move that puts a mockup or a folder back where it stands now. */
export function moveBack(list: MockupList, m: MockupMove): MockupMove | null {
  if (m.kind === "folder") {
    const i = list.folders.findIndex((f) => f.folder_id === m.id);
    return i < 0 ? null : { kind: "folder", id: m.id, before: list.folders[i + 1]?.folder_id ?? null };
  }
  const at = list.items.find((x) => x.mockup_id === m.id);
  if (!at) return null;
  const there = mockupsIn(list, at.folder_id);
  return { kind: "mockup", id: m.id, folder: at.folder_id, before: there[there.indexOf(at) + 1]?.mockup_id ?? null };
}

/** Whether a move would leave everything where it is. */
export function changesNothing(list: MockupList, m: MockupMove): boolean {
  const back = moveBack(list, m);
  if (!back) return true;
  return m.kind === "folder" ? back.before === m.before : back.kind === "mockup" && back.folder === m.folder && back.before === m.before;
}

/** Where something stands after a move, for a toast and a screen reader: "to the top of the folder “Checkout”", "after “Day planner”". */
export function describePlace(list: MockupList, m: MockupMove): string {
  if (m.kind === "folder") {
    const i = list.folders.findIndex((f) => f.folder_id === m.id);
    const prev = list.folders[i - 1];
    return prev ? `after the folder “${prev.name}”` : "in front of the other folders";
  }
  const at = list.items.find((x) => x.mockup_id === m.id);
  const there = at ? mockupsIn(list, at.folder_id) : [];
  const i = at ? there.indexOf(at) : -1;
  const name = folderName(list, at?.folder_id ?? null);
  const prev = there[i - 1];
  if (prev) return `after “${prev.title}”${name === undefined ? "" : ` in the folder “${name}”`}`;
  if (there.length > 1) return name === undefined ? "to the top of the mockups in no folder" : `to the top of the folder “${name}”`;
  return name === undefined ? "out of its folder" : `into the folder “${name}”`;
}

/**
 * What Alt and an arrow key do. Up and down move a mockup among those beside it, and a folder among
 * the folders. Left takes a mockup out of its folder; right has no folder to mean, so it says where
 * the choice is. Otherwise why nothing moves.
 */
export function keyboardMove(list: MockupList, kind: "mockup" | "folder", id: string, key: ArrowKey): MockupMove | { reason: string } {
  if (kind === "folder") {
    const i = list.folders.findIndex((f) => f.folder_id === id);
    const f = list.folders[i];
    if (!f) return { reason: "That folder is no longer here." };
    if (key === "ArrowUp") return i > 0 ? { kind: "folder", id, before: list.folders[i - 1]!.folder_id } : { reason: `“${f.name}” is already the first folder.` };
    if (key === "ArrowDown") return i < list.folders.length - 1 ? { kind: "folder", id, before: list.folders[i + 2]?.folder_id ?? null } : { reason: `“${f.name}” is already the last folder.` };
    return { reason: "Folders hold no folders. Alt + Up and Down move a folder among the others." };
  }
  const at = list.items.find((x) => x.mockup_id === id);
  if (!at) return { reason: "That mockup is no longer here." };
  const there = mockupsIn(list, at.folder_id);
  const i = there.indexOf(at);
  const where = placeWords(list, at.folder_id);
  switch (key) {
    case "ArrowUp":
      return i > 0 ? { kind: "mockup", id, folder: at.folder_id, before: there[i - 1]!.mockup_id } : { reason: `“${at.title}” is already first ${where}.` };
    case "ArrowDown":
      return i < there.length - 1 ? { kind: "mockup", id, folder: at.folder_id, before: there[i + 2]?.mockup_id ?? null } : { reason: `“${at.title}” is already last ${where}.` };
    case "ArrowLeft":
      return at.folder_id === null ? { reason: `“${at.title}” is in no folder already.` } : { kind: "mockup", id, folder: null, before: null };
    case "ArrowRight":
      return { reason: list.folders.length ? "Open the mockup’s menu to choose a folder for it." : "There are no folders yet. New folder, above the list, makes one." };
  }
}
