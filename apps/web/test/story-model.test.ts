import { describe, expect, it } from "vitest";
import { applyMove, arrangement, describePosition, filterTree, flatten, keyboardMove, mockupStop, positionOf, toServer, trail, type PageKind, type StoryNode } from "../src/routes/story-model.ts";

const n = (page_id: string, children: StoryNode[] = [], kind: PageKind = "story_page"): StoryNode => ({ page_id, title: page_id.toUpperCase(), description: "", kind, children });
const shape = (nodes: StoryNode[]): string => nodes.map((x) => x.page_id + (x.children.length ? `[${shape(x.children)}]` : "")).join(",");
const m = (page_id: string, kind: PageKind = "story_page") => ({ page_id, title: page_id.toUpperCase(), description: "", kind });
const tree = (): StoryNode[] =>
  arrangement({ etag: "e", items: [n("a", [n("b"), n("c")]), n("d"), n("m1", [], "mockup_page"), n("m2", [], "mockup_page"), n("x", [n("m3", [], "mockup_page")], "canvas")], unplaced: [m("u")] });

describe("Story tree", () => {
  it("holds every kind of page in one tree, with unplaced pages at its end", () => {
    const t = tree();
    expect(shape(t)).toBe("a[b,c],d,m1,m2,x[m3],u");
    expect(t[4]?.kind).toBe("canvas");
  });
  it("reads in depth-first order and traces a page's ancestors", () => {
    const t = tree();
    expect(flatten(t).map((x) => `${x.node.page_id}${x.level}`)).toEqual(["a1", "b2", "c2", "d1", "m11", "m21", "x1", "m32", "u1"]);
    expect(trail(t, "c")?.map((x) => x.page_id)).toEqual(["a", "c"]);
    expect(trail(t, "m3")?.map((x) => x.page_id)).toEqual(["x", "m3"]);
    expect(trail(t, "nope")).toBeNull();
  });
  it("filters to matches and keeps their ancestors", () => {
    expect(shape(filterTree(tree(), "c"))).toBe("a[c]");
  });
  it("flips between mockup pages in the Story's order, wherever they sit, and not on any other kind of page", () => {
    const t = tree();
    expect(mockupStop(t, "m1")).toMatchObject({ index: 0, count: 3, prev: null, next: { page_id: "m2" } });
    expect(mockupStop(t, "m2")).toMatchObject({ index: 1, prev: { page_id: "m1" }, next: { page_id: "m3" } });
    expect(mockupStop(t, "m3")).toMatchObject({ index: 2, prev: { page_id: "m2" }, next: null });
    expect(mockupStop(t, "a")).toBeNull();
    expect(mockupStop(t, "x")).toBeNull();
  });
});

describe("Moving Story pages", () => {
  const rest = "m1,m2,x[m3],u";
  it("reorders, nests and un-nests by page id", () => {
    const t = tree();
    const up = applyMove(t, { page: "c", parent: "a", before: "b" });
    expect(up.ok && shape(up.tree)).toBe(`a[c,b],d,${rest}`);
    const into = applyMove(t, { page: "d", parent: "b", before: null });
    expect(into.ok && shape(into.tree)).toBe(`a[b[d],c],${rest}`);
    const out = applyMove(t, { page: "b", parent: null, before: "d" });
    expect(out.ok && shape(out.tree)).toBe(`a[c],b,d,${rest}`);
    const stay = applyMove(t, { page: "b", parent: "a", before: "b" });
    expect(stay.ok && shape(stay.tree)).toBe(`a[b,c],d,${rest}`);
  });
  it("moves every kind of page alike: under another kind, and with others under it", () => {
    const t = tree();
    const underPage = applyMove(t, { page: "m1", parent: "a", before: "b" });
    expect(underPage.ok && shape(underPage.tree)).toBe("a[m1,b,c],d,m2,x[m3],u");
    const canvasUnderPage = applyMove(t, { page: "x", parent: "d", before: null });
    expect(canvasUnderPage.ok && shape(canvasUnderPage.tree)).toBe("a[b,c],d[x[m3]],m1,m2,u");
    const pageUnderCanvas = applyMove(t, { page: "d", parent: "x", before: "m3" });
    expect(pageUnderCanvas.ok && shape(pageUnderCanvas.tree)).toBe("a[b,c],m1,m2,x[d,m3],u");
    const pageUnderMockup = applyMove(t, { page: "c", parent: "m1", before: null });
    expect(pageUnderMockup.ok && shape(pageUnderMockup.tree)).toBe("a[b],d,m1[c],m2,x[m3],u");
    expect(describePosition(t, "m3")).toBe("under “X”, 1 of 1");
  });
  it("places a page no agent had placed, and saves the tree as shown", () => {
    const r = applyMove(arrangement({ etag: "e", items: [n("a", [n("b")]), n("d")], unplaced: [m("u")] }), { page: "u", parent: "a", before: null });
    expect(r.ok && shape(r.tree)).toBe("a[b,u],d");
    if (!r.ok) return;
    expect(toServer(r.tree)).toEqual({
      items: [{ page_id: "a", children: [{ page_id: "b", children: [] }, { page_id: "u", children: [] }] }, { page_id: "d", children: [] }],
    });
  });
  it("refuses a page inside its own subtree and trees deeper than six levels", () => {
    expect(applyMove(tree(), { page: "a", parent: "b", before: null }).ok).toBe(false);
    const deep = arrangement({ etag: null, items: [n("1", [n("2", [n("3", [n("4", [n("5", [n("6")])])])])]), n("x", [n("y")])], unplaced: [] });
    const r = applyMove(deep, { page: "x", parent: "5", before: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/6 levels/);
  });
  it("puts a moved page back where it was", () => {
    const t = tree();
    const back = positionOf(t, "c")!;
    const moved = applyMove(t, { page: "c", parent: null, before: null });
    if (!moved.ok) throw new Error(moved.reason);
    const undone = applyMove(moved.tree, back);
    expect(undone.ok && shape(undone.tree)).toBe(`a[b,c],d,${rest}`);
  });
  it("turns Alt+arrow keys into moves", () => {
    const t = tree();
    expect(keyboardMove(t, "c", "ArrowUp")).toEqual({ page: "c", parent: "a", before: "b" });
    expect(keyboardMove(t, "b", "ArrowDown")).toEqual({ page: "b", parent: "a", before: null });
    expect(keyboardMove(t, "c", "ArrowRight")).toEqual({ page: "c", parent: "b", before: null });
    expect(keyboardMove(t, "b", "ArrowLeft")).toEqual({ page: "b", parent: null, before: "d" });
    expect(keyboardMove(t, "a", "ArrowUp")).toHaveProperty("reason");
    expect(keyboardMove(t, "m2", "ArrowUp")).toEqual({ page: "m2", parent: null, before: "m1" });
    expect(keyboardMove(t, "m2", "ArrowRight")).toEqual({ page: "m2", parent: "m1", before: null });
    expect(describePosition(t, "c")).toBe("under “A”, 2 of 2");
  });
});
