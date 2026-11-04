import { describe, expect, it } from "vitest";
import { slugify } from "../../../packages/core/src/util.ts";

/** What slugify gave when its trims took every dash at either end, to show that taking one gives the same. */
function earlier(input: string, max = 60, fallback = "untitled"): string {
  const trim = (t: string) => {
    let start = 0;
    let end = t.length;
    while (start < end && t[start] === "-") start++;
    while (end > start && t[end - 1] === "-") end--;
    return t.slice(start, end);
  };
  const dashed = input
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return trim(trim(dashed).slice(0, max)) || fallback;
}

describe("slugify", () => {
  it("makes a slug of letters, digits and single dashes", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Crème brûlée — 2024")).toBe("creme-brulee-2024");
    expect(slugify("a -- b __ c")).toBe("a-b-c");
    expect(slugify("2026-11-04 Interview with Ana")).toBe("2026-11-04-interview-with-ana");
  });

  it("trims separators and dashes at either end", () => {
    expect(slugify("--- leading and trailing ---")).toBe("leading-and-trailing");
    expect(slugify("  -?!x!?-  ")).toBe("x");
    expect(slugify("-")).toBe("untitled");
  });

  it("falls back when nothing is left", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("---")).toBe("untitled");
    expect(slugify("日本語", 40, "product")).toBe("product");
  });

  it("trims a dash the cut at max leaves at the end", () => {
    expect(slugify("abcd efgh", 5)).toBe("abcd");
    expect(slugify("abcd -- efgh", 5)).toBe("abcd");
    expect(slugify("abcd efgh", 4)).toBe("abcd");
    expect(slugify("abcd efgh", 6)).toBe("abcd-e");
    expect(slugify("-abcd efgh", 5)).toBe("abcd");
  });

  // A guard against a later slowdown: the collapse to one dash runs before the trims, so the earlier
  // trims were fast on this input too. That the output is unchanged is the next test's to show.
  it("stays fast on a long run of separators and dashes", () => {
    const run = "- -_-.".repeat(8_333);
    const input = `a${run}b${run}c`;
    expect(input.length).toBeGreaterThan(99_990);
    const started = performance.now();
    expect(slugify(input)).toBe("a-b-c");
    expect(slugify(input, 100_000)).toBe("a-b-c");
    expect(slugify(`${run}${run}`)).toBe("untitled");
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("gives what it gave before for 5,000 short inputs of letters, separators and dashes", () => {
    const alphabet = ["a", "Z", "9", "-", " ", "_", "é", "—", "."];
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let i = 0; i < 5_000; i++) {
      const input = Array.from({ length: next() % 16 }, () => alphabet[next() % alphabet.length]).join("");
      const max = next() % 13;
      expect(slugify(input, max), JSON.stringify([input, max])).toBe(earlier(input, max));
    }
  });
});
