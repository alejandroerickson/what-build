import { describe, expect, it } from "vitest";
import { findByTitle, matchTitle } from "../src/lib/fuzzy.ts";

const titles = [
  "Approval matrices change constantly, and every change is a control",
  "Camps have slow internet, not no internet",
  "Planning meetings need a target selection they can argue with",
  "Rigs, camps and logistics are run by phone and radio",
];

const find = (q: string) => findByTitle(titles, q, (t) => t).map((x) => x.item);

describe("title search", () => {
  it("needs every word, in any order, ignoring case and punctuation", () => {
    expect(find("camps radio")).toEqual([titles[3]]);
    expect(find("RIGS,")).toEqual([titles[3]]);
    expect(find("camps banana")).toEqual([]);
  });

  it("ranks the start of a word over the middle of one", () => {
    expect(find("camp")).toEqual([titles[1], titles[3]]);
    expect(find("trol")).toEqual([titles[0]]);
  });

  it("forgives one letter wrong, missing or extra in longer words", () => {
    expect(find("aproval")).toEqual([titles[0]]);
    expect(find("internett")).toEqual([titles[1]]);
    expect(find("logistix")).toEqual([titles[3]]);
    expect(find("rug")).toEqual([]);
  });

  it("ignores accents, and marks the matched stretches of the original title", () => {
    expect(matchTitle("resume", "Résumé screening")?.ranges).toEqual([[0, 6]]);
    expect(matchTitle("slow net", titles[1]!)?.ranges).toEqual([
      [11, 15],
      [21, 24],
    ]);
  });

  it("lists everything, in order, for an empty search", () => {
    expect(find("  ")).toEqual(titles);
  });
});
