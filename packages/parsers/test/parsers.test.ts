import { describe, expect, it } from "vitest";
import { derive, sliceCodePoints, type ParseResult } from "../src/index.ts";
import { splitLong } from "../src/text.ts";
import { makeDocx, makePdf, makeXlsx, utf8 } from "./fixtures.ts";

/** The offset invariant every derivation must hold: text[char_start:char_end] == segment.text, in code points. */
function expectOffsetsExact(r: ParseResult) {
  let prevEnd = -1;
  r.segments.forEach((s, i) => {
    expect(s.seq).toBe(i);
    expect(sliceCodePoints(r.text, s.char_start, s.char_end)).toBe(s.text);
    expect(s.char_start).toBeGreaterThan(prevEnd);
    prevEnd = s.char_end;
    expect(Array.from(s.text).length).toBeLessThanOrEqual(2000);
  });
  if (r.segments.length) expect(r.text.endsWith("\n")).toBe(true);
}

describe("WebVTT", () => {
  const vtt = `WEBVTT

NOTE this block is skipped

1
00:00:01.000 --> 00:00:04.500
<v Dana>We export to a spreadsheet every Friday 📊 because the tool can't.

2
00:00:04.500 --> 00:00:09.000
<v Sam>Why Friday?

00:00:09.000 --> 00:00:08.000
Inverted cue is skipped

00:01:02.5 --> 01:00:03.25
Priya: Because that's when the numbers close.
`;

  it("keeps exact cue times, speakers and code-point offsets past an astral character", async () => {
    const r = await derive(utf8(vtt), "call.vtt");
    expect(r.status).toBe("ready");
    expect(r.parser).toBe("webvtt");
    expect(r.segments).toHaveLength(3);
    expect(r.segments[0]).toMatchObject({ speaker: "Dana", start_ms: 1000, end_ms: 4500 });
    expect(r.segments[1]).toMatchObject({ speaker: "Sam", text: "Why Friday?" });
    expect(r.segments[2]).toMatchObject({ speaker: "Priya", start_ms: 62500, end_ms: 3603250 });
    // The emoji is one code point but two UTF-16 units: the next segment's offsets must count it once.
    const first = r.segments[0]!;
    expect(first.char_end - first.char_start).toBe(Array.from(first.text).length);
    expect(r.segments[1]!.char_start).toBe(first.char_end + 2);
    expect(r.facts["inverted_cues"]).toBe(1);
    expect(r.duration_ms).toBe(3603250);
    expect(r.outline).toContain("Dana");
    expectOffsetsExact(r);
  });

  it("never treats timestamp-shaped caption text as a cue", async () => {
    const r = await derive(utf8("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nsaid 00:00:03.000 --> 00:00:04.000 aloud\n"), "a.vtt");
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.text).toContain("aloud");
  });
});

describe("SubRip", () => {
  it("reads comma milliseconds and skips index lines", async () => {
    const r = await derive(utf8("1\n00:00:01,250 --> 00:00:03,000\nHello there\n\n2\n00:00:03,000 --> 00:00:05,000\nAlex: Hi\n"), "x.srt");
    expect(r.status).toBe("ready");
    expect(r.segments.map((s) => [s.text, s.start_ms, s.speaker])).toEqual([
      ["Hello there", 1250, null],
      ["Hi", 3000, "Alex"],
    ]);
  });
});

describe("plain text and Markdown", () => {
  it("segments paragraphs and headings, and outlines the headings", async () => {
    const md = "# Research plan\n\nFirst paragraph\ncontinues here.\n\n## Method\n\nSecond paragraph.\n";
    const r = await derive(utf8(md), "plan.md");
    expect(r.segments.map((s) => s.text)).toEqual([
      "# Research plan",
      "First paragraph continues here.",
      "## Method",
      "Second paragraph.",
    ]);
    expect(r.segments[2]!.heading_level).toBe(2);
    expect(r.outline).toContain("  - ## Method (segment 2)");
    expectOffsetsExact(r);
  });

  it("reads a Speaker: transcript one turn per segment, with speakers", async () => {
    const t = "Interviewer: How do you plan?\nDana: Quarterly, then\nwe revise monthly.\nInterviewer: Who decides?\nDana: The ops lead.\n";
    const r = await derive(utf8(t), "interview.txt");
    expect(r.segments.map((s) => [s.speaker, s.text])).toEqual([
      ["Interviewer", "How do you plan?"],
      ["Dana", "Quarterly, then we revise monthly."],
      ["Interviewer", "Who decides?"],
      ["Dana", "The ops lead."],
    ]);
  });

  it("splits an oversized paragraph at sentence boundaries under 2,000 characters", async () => {
    const sentence = "This sentence is exactly long enough to be repeated many times over. ";
    const r = await derive(utf8(sentence.repeat(100)), "long.txt");
    expect(r.segments.length).toBeGreaterThan(3);
    for (const s of r.segments) expect(s.text.endsWith(".")).toBe(true);
    expectOffsetsExact(r);
  });

  it("hard-cuts a paragraph with no spaces", () => {
    const pieces = splitLong("x".repeat(4500));
    expect(pieces.map((p) => p.length)).toEqual([2000, 2000, 500]);
  });

  it("reports failed, not ready, when the parse silently loses the text", async () => {
    const r = await derive(utf8("WEBVTT\n\n" + "no cues here at all, just prose. ".repeat(20)), "bad.vtt");
    expect(r.status).toBe("failed");
    expect(r.status_detail).toMatch(/kept only 0/);
  });
});

describe("HTML", () => {
  it("keeps main text and headings, drops scripts, styles and navigation", async () => {
    const html = `<html><head><title>x</title><style>p{}</style></head><body>
      <nav>Home | About</nav><h1>Findings</h1><p>First <b>bold</b> point.<br>Same para.</p>
      <script>alert(1)</script><ul><li>One</li><li>Two</li></ul></body></html>`;
    const r = await derive(utf8(html), "page.html");
    expect(r.segments.map((s) => s.text)).toEqual(["# Findings", "First bold point. Same para.", "One", "Two"]);
  });
});

describe("DOCX", () => {
  it("keeps headings via styles, the accepted view of tracked changes, tables as header pairs, and comments", async () => {
    const r = await derive(makeDocx(), "review.docx");
    expect(r.status).toBe("ready");
    expect(r.segments.map((s) => s.text)).toEqual([
      "# Pricing review",
      "We export to a spreadsheet every Friday.",
      "Plan | Price",
      "Plan: Starter | Price: $10",
      "Closing line",
      "# Review comments",
      "Reviewer B: Check the price.",
    ]);
    expect(r.facts).toMatchObject({ table_count: 1, comment_count: 1, had_tracked_changes: true, tracked_insertions: 1, tracked_deletions: 1 });
    expectOffsetsExact(r);
  });

  it("reports failed for a file that is not a Word document", async () => {
    const r = await derive(utf8("not a zip"), "x.docx");
    expect(r.status).toBe("failed");
  });
});

describe("XLSX", () => {
  it("renders one segment per row with header pairs", async () => {
    const r = await derive(makeXlsx(), "accounts.xlsx");
    expect(r.segments.map((s) => s.text)).toEqual([
      "# Sheet: Accounts",
      "[Accounts, row 1] Account | Seats",
      "[Accounts, row 2] Account: Acme | Seats: 12",
      "[Accounts, row 3] Account: Globex | Seats: 3.5",
    ]);
    expect(r.facts).toMatchObject({ sheet_count: 1, row_count: 3 });
  });
});

describe("PDF", () => {
  it("reads the text layer per page", async () => {
    const r = await derive(makePdf(["Discovery notes.", "We heard pricing twice."]), "notes.pdf");
    expect(r.status).toBe("ready");
    expect(r.segments[0]).toMatchObject({ text: "# Page 1", page: 1, heading_level: 1 });
    expect(r.segments.slice(1).map((s) => s.text).join(" ")).toContain("We heard pricing twice.");
    expectOffsetsExact(r);
  });

  it("fails honestly when there is no text layer", async () => {
    const r = await derive(makePdf([]), "scan.pdf");
    expect(r.status).toBe("failed");
    expect(r.status_detail).toMatch(/no text layer/);
  });
});

describe("statuses", () => {
  it("marks recordings as needing a transcript", async () => {
    expect((await derive(new Uint8Array(10), "call.m4a")).status).toBe("needs_transcript");
  });
  it("marks unknown formats unsupported", async () => {
    const r = await derive(new Uint8Array(10), "slides.pptx");
    expect(r.status).toBe("unsupported");
    expect(r.status_detail).toContain(".pptx");
  });
  it("marks oversized files too large without parsing", async () => {
    const r = await derive(new Uint8Array(11), "a.txt", { parseCapBytes: 10 });
    expect(r.status).toBe("too_large");
  });
});
