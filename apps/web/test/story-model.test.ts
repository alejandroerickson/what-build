import { describe, expect, it } from "vitest";
import { applyMove, describePosition, filterTree, flatten, keyboardMove, mockupStop, positionOf, split, toServer, trail, type Arrangement, type StoryNode } from "../src/routes/story-model.ts";

const n = (page_id: string, children: StoryNode[] = []): StoryNode => ({ page_id, title: page_id.toUpperCase(), description: "", children });
const shape = (nodes: StoryNode[]): string => nodes.map((x) => x.page_id + (x.children.length ? `[${shape(x.children)}]` : "")).join(",");
const m = (page_id: string) => ({ page_id, title: page_id.toUpperCase(), description: "" });
const tree = (): Arrangement => split({ etag: "e", items: [n("a", [n("b"), n("c")]), n("d")], unplaced: [m("u")], mockups: [m("m1"), m("m2"), m("m3")] });

describe("Story tree", () => {
  it("keeps unplaced pages at the end of the tree, and the published mockups apart, in order", () => {
    const t = tree();
    expect(shape(t.pages)).toBe("a[b,c],d,u");
    expect(shape(t.mockups)).toBe("m1,m2,m3");
  });
  it("reads in depth-first order and traces a page's ancestors", () => {
    const t = tree();
    expect(flatten(t.pages).map((x) => `${x.node.page_id}${x.level}`)).toEqual(["a1", "b2", "c2", "d1", "u1"]);
    expect(trail(t.pages, "c")?.map((x) => x.page_id)).toEqual(["a", "c"]);
    expect(trail(t.pages, "m1")).toBeNull();
  });
  it("filters to matches and keeps their ancestors", () => {
    expect(shape(filterTree(tree().pages, "c"))).toBe("a[c]");
  });
  it("finds the published mockups either side of one, and nothing for a page that is not one", () => {
    const t = tree();
    expect(mockupStop(t, "m1")).toMatchObject({ index: 0, count: 3, prev: null, next: { page_id: "m2" } });
    expect(mockupStop(t, "m2")).toMatchObject({ index: 1, prev: { page_id: "m1" }, next: { page_id: "m3" } });
    expect(mockupStop(t, "m3")).toMatchObject({ index: 2, prev: { page_id: "m2" }, next: null });
    expect(mockupStop(t, "a")).toBeNull();
  });
});

describe("Moving Story pages", () => {
  it("reorders, nests and un-nests by page id", () => {
    const t = tree();
    const up = applyMove(t, { page: "c", parent: "a", before: "b" });
    expect(up.ok && shape(up.tree.pages)).toBe("a[c,b],d,u");
    const into = applyMove(t, { page: "d", parent: "b", before: null });
    expect(into.ok && shape(into.tree.pages)).toBe("a[b[d],c],u");
    const out = applyMove(t, { page: "b", parent: null, before: "d" });
    expect(out.ok && shape(out.tree.pages)).toBe("a[c],b,d,u");
    const stay = applyMove(t, { page: "b", parent: "a", before: "b" });
    expect(stay.ok && shape(stay.tree.pages)).toBe("a[b,c],d,u");
  });
  it("places a page no agent had placed, and saves the tree as shown", () => {
    const r = applyMove(tree(), { page: "u", parent: "a", before: null });
    expect(r.ok && shape(r.tree.pages)).toBe("a[b,c,u],d");
    if (!r.ok) return;
    expect(toServer(r.tree)).toEqual({
      items: [{ page_id: "a", children: [{ page_id: "b", children: [] }, { page_id: "c", children: [] }, { page_id: "u", children: [] }] }, { page_id: "d", children: [] }],
      mockups: ["m1", "m2", "m3"],
    });
  });
  it("refuses a page inside its own subtree and trees deeper than six levels", () => {
    expect(applyMove(tree(), { page: "a", parent: "b", before: null }).ok).toBe(false);
    const deep = split({ etag: null, items: [n("1", [n("2", [n("3", [n("4", [n("5", [n("6")])])])])]), n("x", [n("y")])], unplaced: [], mockups: [] });
    const r = applyMove(deep, { page: "x", parent: "5", before: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/6 levels/);
  });
  it("reorders the published mockups among themselves and never into the tree", () => {
    const t = tree();
    const r = applyMove(t, { page: "m3", parent: null, before: "m1" });
    expect(r.ok && shape(r.tree.mockups)).toBe("m3,m1,m2");
    expect(r.ok && shape(r.tree.pages)).toBe("a[b,c],d,u");
    expect(applyMove(t, { page: "m1", parent: "a", before: null }).ok).toBe(false);
    expect(positionOf(t, "m2")).toEqual({ page: "m2", parent: null, before: "m3" });
    expect(describePosition(t, "m2")).toBe("among the Published mockups, 2 of 3");
  });
  it("puts a moved page back where it was", () => {
    const t = tree();
    const back = positionOf(t, "c")!;
    const moved = applyMove(t, { page: "c", parent: null, before: null });
    if (!moved.ok) throw new Error(moved.reason);
    const undone = applyMove(moved.tree, back);
    expect(undone.ok && shape(undone.tree.pages)).toBe("a[b,c],d,u");
  });
  it("turns Alt+arrow keys into moves", () => {
    const t = tree();
    expect(keyboardMove(t, "c", "ArrowUp")).toEqual({ page: "c", parent: "a", before: "b" });
    expect(keyboardMove(t, "b", "ArrowDown")).toEqual({ page: "b", parent: "a", before: null });
    expect(keyboardMove(t, "c", "ArrowRight")).toEqual({ page: "c", parent: "b", before: null });
    expect(keyboardMove(t, "b", "ArrowLeft")).toEqual({ page: "b", parent: null, before: "d" });
    expect(keyboardMove(t, "a", "ArrowUp")).toHaveProperty("reason");
    expect(keyboardMove(t, "m2", "ArrowUp")).toEqual({ page: "m2", parent: null, before: "m1" });
    expect(keyboardMove(t, "m2", "ArrowRight")).toHaveProperty("reason");
    expect(describePosition(t, "c")).toBe("under “A”, 2 of 2");
  });
});
