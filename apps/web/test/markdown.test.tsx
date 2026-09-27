import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCue, formatDate, formatDateTime, passageText, relativeTime } from "../src/lib/format.ts";
import { citationLabels, Markdown } from "../src/lib/markdown.tsx";
import { derivedStatusDetail } from "../src/lib/status.ts";

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
  it("renders tables, task lists and headings shifted below the page title", () => {
    const out = html("# Title\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] not");
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<table>");
    expect(out).toContain('type="checkbox"');
  });
  it("renders evidence as a linked 'Source ¶N' token, resolving bare citations when titles are known", () => {
    const id = "01K5Z8T2Q4R6S8V0W2X4Y6Z8A0";
    const linked = html(`It takes hours ([Crew lead interview ¶5](/t/a/b/c/evidence/${id}?seq=5)).`);
    expect(linked).toContain('class="evidence-link"');
    expect(linked).toContain("Crew lead interview\u00a0¶5");
    const bare = renderToStaticMarkup(
      <Markdown source={`As she said (source ${id}, segments 1–3; source 01K5Z8T2Q4R6S8V0W2X4Y6Z8A1).`} evidence={{ app: "/t/a/b/c", titles: { [id]: "Crew lead interview — Greenline, Aug 2026" } }} />,
    );
    expect(bare).not.toContain(id + ",");
    expect(bare).toContain(`href="/t/a/b/c/evidence/${id}?seq=1&amp;to=3"`);
    expect(bare).toContain("Crew lead interview\u00a0¶1–3");
    expect(bare).toContain(">Source</a>");
  });
  it("extends a chip label until each cited source reads differently", () => {
    const [a, b, c, d, e] = ["A0", "A1", "A2", "A3", "A4"].map((x) => `01K5Z8T2Q4R6S8V0W2X4Y6Z8${x}`) as [string, string, string, string, string];
    const titles = { [a]: "Usability study — crew", [b]: "Usability study — office", [c]: "Digest", [d]: "Digest", [e]: "Kickoff notes — March" };
    expect(citationLabels([a, b, c, d, e], titles)).toEqual({
      [a]: "Usability study (crew)",
      [b]: "Usability study (office)",
      [c]: "Digest (1)",
      [d]: "Digest (2)",
      [e]: "Kickoff notes",
    });
    const out = renderToStaticMarkup(<Markdown source={`One (source ${a}, segment 29), another (source ${b}, ¶29).`} evidence={{ app: "/p", titles }} />);
    expect(out).toContain(`Usability study (crew)${" "}¶29`);
    expect(out).toContain(`Usability study (office)${" "}¶29`);
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

describe("passages and statuses", () => {
  it("shows a heading passage without its Markdown markers, and leaves other text as stored", () => {
    expect(passageText("## Tickets by category", 2)).toBe("Tickets by category");
    expect(passageText("# Planning interview — Example Co, Mar 2026", 1)).toBe("Planning interview — Example Co, Mar 2026");
    expect(passageText("#hashtag stays", null)).toBe("#hashtag stays");
    expect(passageText("# Not a heading here", null)).toBe("# Not a heading here");
  });
  it("adds the server's status detail only where the explanation does not already say it", () => {
    expect(derivedStatusDetail("needs_transcript", "a recording is stored and playable but has no text")).toBeNull();
    expect(derivedStatusDetail("unsupported", "no parser reads .key files")).toBeNull();
    expect(derivedStatusDetail("failed", "Error: bad zip")).toBe("Error: bad zip");
    expect(derivedStatusDetail("too_large", "the file is 90 bytes")).toBe("the file is 90 bytes");
    expect(derivedStatusDetail("something_new", "why")).toBe("why");
    expect(derivedStatusDetail("failed", null)).toBeNull();
  });
});
