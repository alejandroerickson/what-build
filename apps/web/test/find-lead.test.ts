import { describe, expect, it } from "vitest";
import { leadTo, type Marks } from "../src/lib/find.tsx";

const marked = (r: { text: string; marks: Marks }) => r.marks.map(([s, e]) => r.text.slice(s, e));

describe("leadTo", () => {
  const text = "…as jobs? Marisol: Jobs. I start with the jobs we have to do, then I figure out which crew and which day. The crew lead sends it.";
  const at = (word: string, from = 0) => {
    const s = text.indexOf(word, from);
    return [s, s + word.length] as [number, number];
  };

  it("starts a short way before the first mark, at the start of a word, and moves every mark with it", () => {
    const first = at("crew");
    const marks: Marks = [first, at("crew", first[1])];
    const r = leadTo(text, marks, 20);
    expect(r.text.startsWith("…")).toBe(true);
    expect(r.text).toMatch(/^…[A-Za-z]/);
    expect(r.text.endsWith("sends it.")).toBe(true);
    expect(r.marks[0]![0]).toBeLessThanOrEqual(21);
    expect(marked(r)).toEqual(["crew", "crew"]);
  });

  it("leaves an excerpt whose first mark is already near its start as it is", () => {
    const marks: Marks = [at("Marisol")];
    expect(leadTo(text, marks, 20)).toEqual({ text, marks });
    expect(leadTo(text, [], 20)).toEqual({ text, marks: [] });
  });

  it("starts at the mark when no space comes before it within reach", () => {
    const long = `${"x".repeat(60)}crew and more`;
    const r = leadTo(long, [[60, 64]], 20);
    expect(r).toEqual({ text: "…crew and more", marks: [[1, 5]] });
  });
});
