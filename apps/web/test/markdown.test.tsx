import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCue, formatDate, formatDateTime, relativeTime } from "../src/lib/format.ts";
import { inAppHref, Markdown, markdownText, mentionLabels } from "../src/lib/markdown.tsx";
import { derivedStatusDetail } from "../src/lib/status.ts";
import { findPattern } from "../src/routes/source-text.tsx";

const html = (md: string) => renderToStaticMarkup(<Markdown source={md} />);

describe("safe Markdown", () => {
  it("never lets HTML from the source reach the page", () => {
    const out = html('Hello <script>alert(1)</script> <img src=x onerror=alert(1)> <a id="x"></a>world');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror=");
    expect(out).toContain("world");
  });
  it("renders only safe links, and images as links that never load", () => {
    const out = html("[ok](https://example.com) [bad](javascript:alert(1)) ![pic](https://x.test/p.png)");
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
    expect(out).toContain("[pic]");
  });
  it("opens a link into the product being read in place, whichever deployment wrote it", () => {
    const here = { origin: "https://dev.example.com", pathname: "/t/acme/core/planner/exploration/mockups/01ABC" };
    expect(inAppHref("https://dev.example.com/settings", here)).toBe("/settings");
    expect(inAppHref("https://app.example.com/t/acme/core/planner/evidence/01DEF?view=text&find=pricing", here)).toBe("/t/acme/core/planner/evidence/01DEF?view=text&find=pricing");
    expect(inAppHref("https://app.example.com/t/acme/core/planner", here)).toBe("/t/acme/core/planner");
    // Another product, another part of the original, or a page outside any product: left as written.
    for (const href of ["https://app.example.com/t/acme/core/other/evidence/01DEF", "https://app.example.com/t/acme/core/planner-2", "https://app.example.com/settings"])
      expect(inAppHref(href, here)).toBe(href);
    expect(inAppHref("https://app.example.com/t/acme/core/planner/idea", { origin: "https://dev.example.com", pathname: "/t/acme/members" })).toBe("https://app.example.com/t/acme/core/planner/idea");
  });
  it("renders tables, task lists and headings shifted below the page title", () => {
    const out = html("# Title\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] not");
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<table>");
    expect(out).toContain('type="checkbox"');
    // A tight task item holds its words inline, once, with no paragraph around them.
    expect(out).toMatch(/<li><input[^>]*> done<\/li>/);
    expect(out).not.toContain("[ ]");
  });
  it("renders evidence as a linked token named by its source, resolving a source mentioned by id when titles are known", () => {
    const id = "01K5Z8T2Q4R6S8V0W2X4Y6Z8A0";
    const linked = html(`It takes hours ([Crew lead interview](/t/a/b/c/evidence/${id})).`);
    expect(linked).toContain('class="evidence-link"');
    expect(linked).toContain(">Crew lead interview</a>");
    // A mention written while sources had passages opens the source; its numbers point at nothing now.
    const bare = renderToStaticMarkup(
      <Markdown source={`As she said (source ${id}, segments 1–3; source 01K5Z8T2Q4R6S8V0W2X4Y6Z8A1).`} evidence={{ app: "/t/a/b/c", titles: { [id]: "Crew lead interview — Greenline, Aug 2026" } }} />,
    );
    expect(bare).not.toContain(id + ",");
    expect(bare).not.toContain("segments");
    expect(bare).toContain(`href="/t/a/b/c/evidence/${id}"`);
    expect(bare).toContain(">Crew lead interview</a>");
    expect(bare).toContain(">Source</a>");
  });
  it("marks the words a find names, with their other endings, wherever they are in the text", () => {
    const out = renderToStaticMarkup(<Markdown source={"# Pricing\n\n**Dana** (0:05): Prices are priced on Fridays; *repricing* is not.\n\n| Plan | Price |\n|---|---|\n| A | 4 |"} mark={findPattern("pricing")} />);
    expect(out.match(/<mark class="text-find">/g)).toHaveLength(4);
    expect(out).toContain('<mark class="text-find">Pricing</mark>');
    expect(out).toContain('<mark class="text-find">Prices</mark> are <mark class="text-find">priced</mark>');
    expect(out).toContain("<em>repricing</em>");
    expect(renderToStaticMarkup(<Markdown source="Friday close and the close of Friday" mark={findPattern('"Friday close"')} />)).toContain('<mark class="text-find">Friday close</mark> and the close of Friday');
    expect(findPattern("  ")).toBeUndefined();
  });
  it("extends a chip label until each mentioned source reads differently", () => {
    const [a, b, c, d, e] = ["A0", "A1", "A2", "A3", "A4"].map((x) => `01K5Z8T2Q4R6S8V0W2X4Y6Z8${x}`) as [string, string, string, string, string];
    const titles = { [a]: "Usability study — crew", [b]: "Usability study — office", [c]: "Digest", [d]: "Digest", [e]: "Kickoff notes — March" };
    expect(mentionLabels([a, b, c, d, e], titles)).toEqual({
      [a]: "Usability study (crew)",
      [b]: "Usability study (office)",
      [c]: "Digest (1)",
      [d]: "Digest (2)",
      [e]: "Kickoff notes",
    });
    const out = renderToStaticMarkup(<Markdown source={`One (source ${a}, segment 29), another (source ${b}).`} evidence={{ app: "/p", titles }} />);
    expect(out).toContain(">Usability study (crew)</a>");
    expect(out).toContain(">Usability study (office)</a>");
  });
});

describe("formatting", () => {
  it("formats dates, cue times and relative times plainly", () => {
    expect(formatDate("2026-09-02")).toBe("2 Sept 2026");
    expect(formatDateTime("2026-09-26T14:18:00")).toMatch(/^26 Sept 2026, (2:18\s?p\.?m\.?|14:18)$/i);
    expect(formatCue(3312000)).toBe("55:12.0");
    expect(formatCue(3723400)).toBe("1:02:03.4");
    expect(relativeTime(new Date(Date.now() - 5000).toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe("3 h ago");
  });
});

describe("statuses", () => {
  it("adds the server's status detail only where the explanation does not already say it", () => {
    expect(derivedStatusDetail("needs_transcript", "a recording is stored and playable but has no text")).toBeNull();
    expect(derivedStatusDetail("unsupported", "no parser reads .key files")).toBeNull();
    expect(derivedStatusDetail("failed", "Error: bad zip")).toBe("Error: bad zip");
    expect(derivedStatusDetail("too_large", "the file is 90 bytes")).toBe("the file is 90 bytes");
    expect(derivedStatusDetail("something_new", "why")).toBe("why");
    expect(derivedStatusDetail("failed", null)).toBeNull();
  });
});

describe("Markdown as plain words, for a clamped summary", () => {
  it("drops the markers and keeps the words, on one line", () => {
    expect(markdownText("**Crewboard** helps *crew leads* plan the `week`.\n\n## Who\n\n- Crew leads\n- Office staff & ops")).toBe(
      "Crewboard helps crew leads plan the week. Who Crew leads Office staff & ops",
    );
  });
  it("keeps link text and never markup", () => {
    expect(markdownText("See [the notes](https://example.com) <b>now</b> > quoted")).toBe("See the notes now > quoted");
    expect(markdownText("")).toBe("");
  });
});
