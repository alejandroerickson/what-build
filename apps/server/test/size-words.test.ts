import { describe, expect, it } from "vitest";
import { CANVAS_LOAD_BYTES, PAGE_LOAD_BYTES, PAGE_LOAD_FILES } from "../../../packages/core/src/prototype.ts";
import { canvasLoadProblems } from "../../../packages/core/src/ops/mockups.ts";
import { sizesApart, type SizeFormat } from "../../../packages/core/src/size-words.ts";

// A size a message sets beside a limit, or the room left, never reads the same as it while they
// differ, so a size just past a limit never reads as within it.

const MIB = 1024 * 1024;
const mb: SizeFormat = (n, places = 1) => (n >= MIB ? `${(n / MIB).toFixed(places)} MB` : `${Math.ceil(n / 1024)} KB`);
const GUIDANCE = /^Each page loads its document/;

describe("sizes set side by side", () => {
  it("keep the short form when it already tells them apart, or when they are the same", () => {
    expect(sizesApart(mb, 3 * MIB, MIB)).toEqual(["3.0 MB", "1.0 MB"]);
    expect(sizesApart(mb, MIB, MIB)).toEqual(["1.0 MB", "1.0 MB"]);
  });

  it("show more places, then bytes, when the short form would read alike", () => {
    expect(sizesApart(mb, 12_584_000, 12_582_912)).toEqual(["12.001 MB", "12.000 MB"]);
    expect(sizesApart(mb, 1_048_700, 1_048_576)).toEqual(["1,048,700 bytes", "1,048,576 bytes"]);
    expect(sizesApart(mb, 300, 200)).toEqual(["300 bytes", "200 bytes"]);
  });
});

describe("what a canvas's pages load", () => {
  it("names a document just past a page's bytes in more than the short form, with the canvas's total", () => {
    const loads = new Map([["app.html", { files: 5, bytes: 1_048_700 }]]);
    const problems = canvasLoadProblems([{ page_id: "home", entry: "app.html" }], loads);
    expect(problems[0]).toBe(
      `app.html, which page home enters, loads 5 files, 1,048,700 bytes with itself, each time a page's frame opens it; a page loads at most ${PAGE_LOAD_FILES} files and 1,048,576 bytes, so that it shows at once.`,
    );
    expect(problems[1]).toMatch(/^The pages load 1\.0 MB together, within the 12\.0 MB a canvas's pages load at most\. Each page loads its document/);
    expect(problems).toHaveLength(2);
  });

  it("names a canvas just past its pages' bytes together in more than the short form", () => {
    // Thirteen pages of 968,000 bytes each: 12,584,000 together, each page well within its own.
    const pages = Array.from({ length: 13 }, (_, i) => ({ page_id: `p${i}`, entry: `s${i}.html` }));
    const loads = new Map(pages.map((_, i) => [`s${i}.html`, { files: 1, bytes: 968_000 }]));
    expect(968_000).toBeLessThan(PAGE_LOAD_BYTES);
    const problems = canvasLoadProblems(pages, loads);
    expect(problems[0]).toBe(
      `The pages load 12.001 MB together, each page's frame fetching its document and all it loads; a canvas's pages load at most 12.000 MB, so that it opens in a few seconds.`,
    );
    expect(problems[1]).toMatch(GUIDANCE);
    expect(CANVAS_LOAD_BYTES).toBe(12_582_912);
  });

  it("names every page that enters a heavy document while they are few, and how many more past that", () => {
    const loads = new Map([["app.html", { files: PAGE_LOAD_FILES + 1, bytes: 2048 }]]);
    const enter = (n: number) => canvasLoadProblems(Array.from({ length: n }, (_, i) => ({ page_id: `h${i + 1}`, entry: `app.html?s=${i}` })), loads)[0];
    expect(enter(4)).toContain("which 4 pages enter (h1, h2, h3, h4), loads");
    expect(enter(6)).toContain("which 6 pages enter (h1, h2, h3, h4, h5, h6), loads");
    expect(enter(7)).toContain("which 7 pages enter (h1, h2, h3, h4, h5, and 2 more), loads");
    expect(enter(4)).not.toContain("…");
  });
});
