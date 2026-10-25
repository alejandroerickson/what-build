import { parseProductRef, prototypeWarnings, scopeSelector } from "@whatbuild/core";
import { shownRuns } from "@whatbuild/core/find-in-text";
import { describe, expect, it } from "vitest";

// Text an editor or an agent controls, shaped to make a backtracking pattern take quadratic time.
// Each must come back at once, and still read ordinary input as before.
function quickly<T>(f: () => T): T {
  const start = performance.now();
  const out = f();
  expect(performance.now() - start).toBeLessThan(1000);
  return out;
}

const css = (text: string) => [{ path: "a.css", media_type: "text/css", data: new TextEncoder().encode(text) }];

describe("patterns over text a caller writes take linear time", () => {
  it("trims the slashes around a product reference", () => {
    expect(parseProductRef("//acme/team/crm//")).toEqual({ tenant: "acme", team: "team", product: "crm" });
    const start = performance.now();
    expect(() => parseProductRef(`${"/".repeat(200_000)}x`)).toThrow(/not a product reference/);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("finds the addresses in a prototype's CSS", () => {
    expect(prototypeWarnings(css("a { background: url( b.png ) } @import 'c.css';"))).toEqual([
      "a.css names b.png, which the prototype does not hold.",
      "a.css names c.css, which the prototype does not hold.",
    ]);
    for (const hostile of [`a{background:url(${" ".repeat(200_000)}`, "url(url(".repeat(25_000), `url(a${" b".repeat(100_000)}`]) {
      expect(quickly(() => prototypeWarnings(css(hostile)))).toEqual([]);
    }
  });

  it("scopes a page's selectors, attribute selectors and strings left as they are", () => {
    expect(scopeSelector('body [data-x="a]b"] p[title="x y"]')).toBe(':host [data-x="a]b"] p[title="x y"]');
    for (const hostile of ["[".repeat(100_000), `"${'\\"'.repeat(50_000)}`, `'${"\\'".repeat(50_000)}`]) {
      expect(quickly(() => scopeSelector(hostile))).toBe(hostile);
    }
  });
});

describe("entities in Markdown", () => {
  it("shows text that reads &lt; as &lt;, turning &amp; back last as the web app does", () => {
    expect(shownRuns("It reads &amp;lt; here, Tom &amp; Jerry.").join("")).toContain("It reads &lt; here, Tom & Jerry.");
  });
});
