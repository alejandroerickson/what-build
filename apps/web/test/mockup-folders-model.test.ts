import { describe, expect, it } from "vitest";
import { applyMove, changesNothing, describePlace, keyboardMove, moveBack, type MockupFolder, type MockupList, type MockupSummary } from "../src/routes/mockup-folders-model.ts";

const mockup = (id: string, folder: string | null = null): MockupSummary => ({ mockup_id: id, title: id.toUpperCase(), summary: "", folder_id: folder, current_version: 1, archived_at: null, etag: `${id}-1`, updated_at: "2026-10-01T09:00:00.000Z", page_count: 1 });
const folder = (id: string, count: number): MockupFolder => ({ folder_id: id, name: id.toUpperCase(), etag: `${id}-1`, mockup_count: count });
/** a and b in no folder; c and d in the folder x; the folder y empty. */
const list = (): MockupList => ({ items: [mockup("a"), mockup("b"), mockup("c", "x"), mockup("d", "x")], folders: [folder("x", 2), folder("y", 0)] });
/** The arrangement on one line: the mockups in no folder, then each folder with its own and its count. */
const shape = (l: MockupList) => [l.items.filter((m) => m.folder_id === null).map((m) => m.mockup_id).join(","), ...l.folders.map((f) => `${f.folder_id}${f.mockup_count}[${l.items.filter((m) => m.folder_id === f.folder_id).map((m) => m.mockup_id).join(",")}]`)].join(" ");

describe("Arranged mockups", () => {
  it("moves a mockup in front of another beside it, or last", () => {
    expect(shape(applyMove(list(), { kind: "mockup", id: "b", folder: null, before: "a" }))).toBe("b,a x2[c,d] y0[]");
    expect(shape(applyMove(list(), { kind: "mockup", id: "a", folder: null, before: null }))).toBe("b,a x2[c,d] y0[]");
  });
  it("puts a mockup in a folder and takes one out, counting each folder again", () => {
    expect(shape(applyMove(list(), { kind: "mockup", id: "a", folder: "x", before: "d" }))).toBe("b x3[c,a,d] y0[]");
    expect(shape(applyMove(list(), { kind: "mockup", id: "a", folder: "y", before: null }))).toBe("b x2[c,d] y1[a]");
    expect(shape(applyMove(list(), { kind: "mockup", id: "c", folder: null, before: "a" }))).toBe("c,a,b x1[d] y0[]");
  });
  it("keeps the list in the order people see it: no folder first, then folder by folder", () => {
    const moved = applyMove(list(), { kind: "mockup", id: "d", folder: "y", before: null });
    expect(moved.items.map((m) => m.mockup_id)).toEqual(["a", "b", "c", "d"]);
    expect(applyMove(moved, { kind: "folder", id: "y", before: "x" }).items.map((m) => m.mockup_id)).toEqual(["a", "b", "d", "c"]);
  });
  it("moves a folder in front of another, or last, with its mockups", () => {
    expect(shape(applyMove(list(), { kind: "folder", id: "y", before: "x" }))).toBe("a,b y0[] x2[c,d]");
    expect(shape(applyMove(list(), { kind: "folder", id: "x", before: null }))).toBe("a,b y0[] x2[c,d]");
  });
  it("goes last when the mockup or folder it was to go in front of is gone", () => {
    expect(shape(applyMove(list(), { kind: "mockup", id: "a", folder: "x", before: "gone" }))).toBe("b x3[c,d,a] y0[]");
    expect(shape(applyMove(list(), { kind: "folder", id: "x", before: "gone" }))).toBe("a,b y0[] x2[c,d]");
  });
  it("knows the move that undoes one, and a move that changes nothing", () => {
    const l = list();
    const m = { kind: "mockup", id: "c", folder: null, before: "a" } as const;
    const back = moveBack(l, m)!;
    expect(back).toEqual({ kind: "mockup", id: "c", folder: "x", before: "d" });
    expect(shape(applyMove(applyMove(l, m), back))).toBe(shape(l));
    expect(changesNothing(l, back)).toBe(true);
    expect(changesNothing(l, m)).toBe(false);
    expect(changesNothing(l, { kind: "mockup", id: "b", folder: null, before: null })).toBe(true);
    expect(changesNothing(l, { kind: "folder", id: "x", before: "y" })).toBe(true);
    expect(changesNothing(l, { kind: "folder", id: "y", before: "x" })).toBe(false);
  });
  it("says where something landed", () => {
    const said = (m: Parameters<typeof applyMove>[1]) => describePlace(applyMove(list(), m), m);
    expect(said({ kind: "mockup", id: "a", folder: "x", before: "c" })).toBe("to the top of the folder “X”");
    expect(said({ kind: "mockup", id: "a", folder: "x", before: null })).toBe("after “D” in the folder “X”");
    expect(said({ kind: "mockup", id: "a", folder: "y", before: null })).toBe("into the folder “Y”");
    expect(said({ kind: "mockup", id: "d", folder: null, before: "a" })).toBe("to the top of the mockups in no folder");
    expect(said({ kind: "mockup", id: "d", folder: null, before: null })).toBe("after “B”");
    expect(said({ kind: "folder", id: "y", before: "x" })).toBe("in front of the other folders");
    expect(said({ kind: "folder", id: "x", before: null })).toBe("after the folder “Y”");
  });
});

describe("Moving mockups with the keyboard", () => {
  it("moves a mockup up and down among those beside it, and stops at the ends", () => {
    expect(keyboardMove(list(), "mockup", "b", "ArrowUp")).toEqual({ kind: "mockup", id: "b", folder: null, before: "a" });
    expect(keyboardMove(list(), "mockup", "a", "ArrowDown")).toEqual({ kind: "mockup", id: "a", folder: null, before: null });
    expect(keyboardMove(list(), "mockup", "c", "ArrowDown")).toEqual({ kind: "mockup", id: "c", folder: "x", before: null });
    expect(keyboardMove(list(), "mockup", "a", "ArrowUp")).toEqual({ reason: "“A” is already first in no folder." });
    expect(keyboardMove(list(), "mockup", "d", "ArrowDown")).toEqual({ reason: "“D” is already last in the folder “X”." });
  });
  it("takes a mockup out of its folder with Left, and leaves the choice of a folder to its menu", () => {
    expect(keyboardMove(list(), "mockup", "c", "ArrowLeft")).toEqual({ kind: "mockup", id: "c", folder: null, before: null });
    expect(keyboardMove(list(), "mockup", "a", "ArrowLeft")).toEqual({ reason: "“A” is in no folder already." });
    expect(keyboardMove(list(), "mockup", "a", "ArrowRight")).toEqual({ reason: "Open the mockup’s menu to choose a folder for it." });
  });
  it("moves a folder among the folders", () => {
    expect(keyboardMove(list(), "folder", "y", "ArrowUp")).toEqual({ kind: "folder", id: "y", before: "x" });
    expect(keyboardMove(list(), "folder", "x", "ArrowDown")).toEqual({ kind: "folder", id: "x", before: null });
    expect(keyboardMove(list(), "folder", "x", "ArrowUp")).toEqual({ reason: "“X” is already the first folder." });
    expect(keyboardMove(list(), "folder", "x", "ArrowRight")).toEqual({ reason: "Folders hold no folders. Alt + Up and Down move a folder among the others." });
  });
});
