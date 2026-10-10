import { describe, expect, it } from "vitest";
import { filterTree, flatten, mockupStop, split, trail, type Arrangement, type StoryNode } from "../src/routes/story-model.ts";

const n = (page_id: string, children: StoryNode[] = []): StoryNode => ({ page_id, title: page_id.toUpperCase(), description: "", children });
const shape = (nodes: StoryNode[]): string => nodes.map((x) => x.page_id + (x.children.length ? `[${shape(x.children)}]` : "")).join(",");
const m = (page_id: string) => ({ page_id, title: page_id.toUpperCase(), description: "" });
const tree = (): Arrangement => split({ etag: "e", items: [n("a", [n("b"), n("c")]), n("d"), n("u")], unplaced: ["u"], mockups: [m("m1"), m("m2"), m("m3")] });

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
