import { describe, expect, it } from "vitest";
import { filterTree, flatten, split, trail, type Arrangement, type StoryNode } from "../src/routes/story-model.ts";

const n = (page_id: string, children: StoryNode[] = []): StoryNode => ({ page_id, title: page_id.toUpperCase(), description: "", children });
const shape = (nodes: StoryNode[]): string => nodes.map((x) => x.page_id + (x.children.length ? `[${shape(x.children)}]` : "")).join(",");
const tree = (): Arrangement => split({ etag: "e", items: [n("a", [n("b"), n("c")]), n("d"), n("u")], unplaced: ["u"] });

describe("Story tree", () => {
  it("splits unplaced pages from the navigation", () => {
    const t = tree();
    expect(shape(t.placed)).toBe("a[b,c],d");
    expect(t.unplaced.map((x) => x.page_id)).toEqual(["u"]);
  });
  it("reads in depth-first order and traces a page's ancestors", () => {
    const t = tree();
    expect(flatten(t.placed).map((x) => `${x.node.page_id}${x.level}`)).toEqual(["a1", "b2", "c2", "d1"]);
    expect(trail(t.placed, "c")?.map((x) => x.page_id)).toEqual(["a", "c"]);
    expect(trail(t.placed, "u")).toBeNull();
  });
  it("filters to matches and keeps their ancestors", () => {
    expect(shape(filterTree(tree().placed, "c"))).toBe("a[c]");
  });
});
