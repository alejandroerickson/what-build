import { describe, expect, it } from "vitest";
import { applyMove, filterTree, keyboardMove, positionOf, slugify, split, type Arrangement, type StoryNode } from "../src/routes/story-model.ts";

const n = (page_id: string, children: StoryNode[] = []): StoryNode => ({ page_id, title: page_id.toUpperCase(), description: "", children });
const shape = (nodes: StoryNode[]): string => nodes.map((x) => x.page_id + (x.children.length ? `[${shape(x.children)}]` : "")).join(",");
const tree = (): Arrangement => split({ etag: "e", items: [n("a", [n("b"), n("c")]), n("d"), n("u")], unplaced: ["u"] });

describe("Story tree moves", () => {
  it("splits unplaced pages from the navigation", () => {
    const t = tree();
    expect(shape(t.placed)).toBe("a[b,c],d");
    expect(t.unplaced.map((x) => x.page_id)).toEqual(["u"]);
  });
  it("reorders, nests and un-nests by page id", () => {
    const t = tree();
    const up = applyMove(t, { page: "c", parent: "a", before: "b" });
    expect(up.ok && shape(up.tree.placed)).toBe("a[c,b],d");
    const into = applyMove(t, { page: "d", parent: "b", before: null });
    expect(into.ok && shape(into.tree.placed)).toBe("a[b[d],c]");
    const out = applyMove(t, { page: "b", parent: null, before: "d" });
    expect(out.ok && shape(out.tree.placed)).toBe("a[c],b,d");
  });
  it("places an unplaced page and can take it out again", () => {
    const placed = applyMove(tree(), { page: "u", parent: "a", before: null });
    expect(placed.ok && shape(placed.tree.placed)).toBe("a[b,c,u],d");
    expect(placed.ok && placed.tree.unplaced).toEqual([]);
    if (!placed.ok) return;
    const back = applyMove(placed.tree, positionOf(tree(), "u"));
    expect(back.ok && shape(back.tree.placed)).toBe("a[b,c],d");
  });
  it("refuses a page inside its own subtree and trees deeper than six levels", () => {
    expect(applyMove(tree(), { page: "a", parent: "b", before: null }).ok).toBe(false);
    const deep = split({ etag: null, items: [n("1", [n("2", [n("3", [n("4", [n("5", [n("6")])])])])]), n("x", [n("y")])], unplaced: [] });
    const r = applyMove(deep, { page: "x", parent: "5", before: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/6 levels/);
  });
  it("turns Alt+arrow keys into moves", () => {
    const t = tree();
    expect(keyboardMove(t, "c", "ArrowUp")).toEqual({ page: "c", parent: "a", before: "b" });
    expect(keyboardMove(t, "b", "ArrowDown")).toEqual({ page: "b", parent: "a", before: null });
    expect(keyboardMove(t, "c", "ArrowRight")).toEqual({ page: "c", parent: "b", before: null });
    expect(keyboardMove(t, "b", "ArrowLeft")).toEqual({ page: "b", parent: null, before: "d" });
    expect(keyboardMove(t, "a", "ArrowUp")).toHaveProperty("reason");
    expect(keyboardMove(t, "u", "ArrowUp")).toEqual({ page: "u", parent: null, before: null });
  });
  it("filters to matches and keeps their ancestors", () => {
    expect(shape(filterTree(tree().placed, "c"))).toBe("a[c]");
  });
  it("makes page addresses from titles", () => {
    expect(slugify("Where Crewboard's discovery stands!")).toBe("where-crewboard-s-discovery-stands");
    expect(slugify("Café résumé")).toBe("cafe-resume");
  });
});
