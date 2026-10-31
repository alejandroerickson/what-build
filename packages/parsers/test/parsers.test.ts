import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanPayload } from "../src/cues.ts";
import { clock, currentReading, derive, IMAGE_DETAIL, RECORDING_DETAIL, recordingDurationMs, SCAN_DETAIL, settledReading, sliceCodePoints, tableMarkdown, type ParseResult } from "../src/index.ts";
import { bytesReader } from "../src/media.ts";
import { splitLong } from "../src/text.ts";
import { builtinFormat, formatNumber, formatText, readFormat } from "../src/numfmt.ts";
import { stripInlineMarkdown, wraps } from "../src/plaintext.ts";
import { layoutPage, pageBlocks, type TextRun } from "../src/pdf-layout.ts";
import { makeDocx, makeDocxList, makeDocxParagraphs, makeFlac, makeMp3, makeMp4, makePdf, makePdfPages, makeWav, makeWorkbook, makeXlsx, makeXlsxSheet, pdfLines, pdfTable, pdfTextWidth, utf8, type PdfRun } from "./fixtures.ts";
import { makeCompoundFile, makeWordDoc } from "./word-fixtures.ts";

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
    expect(r.segments.some((s) => s.speaker === "Dana")).toBe(true);
    expectOffsetsExact(r);
  });

  it("never treats timestamp-shaped caption text as a cue", async () => {
    const r = await derive(utf8("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nsaid 00:00:03.000 --> 00:00:04.000 aloud\n"), "a.vtt");
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.text).toContain("aloud");
  });
});

describe("entities and escapes", () => {
  it("keeps a caption that reads &lt; as it reads, turning &amp; back last", () => {
    expect(cleanPayload("Use &amp;lt;b&amp;gt; for bold &amp; more").text).toBe("Use &lt;b&gt; for bold & more");
  });

  it("escapes a backslash in a table cell, so it cannot escape the pipe that closes the cell", () => {
    expect(tableMarkdown({ header: ["Path", "Note"], rows: [["C:\\", "a|b"]] }).split("\n")[2]).toBe("| C:\\\\ | a\\|b |");
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
  it("segments paragraphs and headings, with each heading's level", async () => {
    const md = "# Research plan\n\nFirst paragraph\ncontinues here.\n\n## Method\n\nSecond paragraph.\n";
    const r = await derive(utf8(md), "plan.md");
    expect(r.segments.map((s) => s.text)).toEqual([
      "# Research plan",
      "First paragraph continues here.",
      "## Method",
      "Second paragraph.",
    ]);
    expect(r.segments[2]!.heading_level).toBe(2);
    expectOffsetsExact(r);
  });

  it("reads a Speaker: transcript one turn per segment, with speakers", async () => {
    const t =
      "Interviewer: How do you plan?\nDana: Quarterly, then we revise it monthly, every Friday afternoon with the\ncrew leads in the yard.\nInterviewer: Who decides?\nDana: The ops lead.\nWe all sign it off.\n";
    const r = await derive(utf8(t), "interview.txt");
    expect(r.segments.map((s) => [s.speaker, s.text])).toEqual([
      ["Interviewer", "How do you plan?"],
      // A line that wraps a sentence onto the next joins it; a line of its own stays one.
      ["Dana", "Quarterly, then we revise it monthly, every Friday afternoon with the crew leads in the yard."],
      ["Interviewer", "Who decides?"],
      ["Dana", "The ops lead.  \nWe all sign it off."],
    ]);
  });

  it("reads timestamped and bracketed speaker labels", async () => {
    const t = "[00:00:05] Interviewer: How do you plan?\n[00:00:09] Dana: Quarterly.\n[Interviewer]: Who decides?\n[Dana]: The ops lead.\n";
    const r = await derive(utf8(t), "interview.txt");
    expect(r.segments.map((s) => [s.speaker, s.text])).toEqual([
      ["Interviewer", "How do you plan?"],
      ["Dana", "Quarterly."],
      ["Interviewer", "Who decides?"],
      ["Dana", "The ops lead."],
    ]);
  });

  it("keeps field lines and occasional labels as prose, not speakers", async () => {
    const fields = "Project: Scheduling\nDate: 3 September\nLocation: Depot\nAttendees: Dana, Sam\nWe walked the yard first.\n";
    const notes = "Note: this is a draft.\n\nWe met the ops lead on Tuesday.\n\nShe plans by the week.\n\nNote: follow up on pricing.\n";
    for (const [text, name] of [[fields, "visit.txt"], [notes, "notes.md"]] as const) {
      const r = await derive(utf8(text), name);
      expect(r.segments.every((s) => s.speaker === null)).toBe(true);
      expect(r.facts["transcript_turns"]).toBeUndefined();
    }
  });

  it("gives each list item its own segment, under its heading", async () => {
    const md = "## Observations\n\n- Crews text the office\n  every morning.\n- Nobody called it a crisis.\n* Third item\n\n1. First step\n2. Second step\n\nThe year was\n2019. It stayed in the paragraph.\n";
    const r = await derive(utf8(md), "visit.md");
    expect(r.segments.map((s) => s.text)).toEqual([
      "## Observations",
      "Crews text the office every morning.",
      "Nobody called it a crisis.",
      "Third item",
      "1. First step",
      "2. Second step",
      "The year was 2019. It stayed in the paragraph.",
    ]);
    expectOffsetsExact(r);
  });

  it("keeps a plain-text list a list, under the line that introduces it", async () => {
    const r = await derive(utf8("Follow-ups:\n- call Dana\n- send the price sheet\n"), "note.txt");
    expect(r.markdown).toBe("Follow-ups:\n\n- call Dana\n- send the price sheet\n");
    expectOffsetsExact(r);
  });

  it("renders a pipe table one row per segment with header pairs, dropping the rule", async () => {
    const md = "| Plan | Price |\n|:-----|------:|\n| **Starter** | $10 |\n| Team | |\n\nAfter the table.\n";
    const r = await derive(utf8(md), "pricing.md");
    expect(r.segments.map((s) => s.text)).toEqual(["Plan | Price", "Plan: Starter | Price: $10", "Plan: Team", "After the table."]);
    expect(r.facts["table_count"]).toBe(1);
  });

  it("labels a matrix whose top-left header cell is empty, with each row's first cell as its name", async () => {
    const md = "|   | Plan A | Plan B |\n|---|---|---|\n| Reached the saved view | 4 of 5 | 0 of 5 |\n| Asked for help | | 2 of 5 |\n";
    const r = await derive(utf8(md), "results.md");
    expect(r.segments.map((s) => s.text)).toEqual([
      "Plan A | Plan B",
      "Reached the saved view | Plan A: 4 of 5 | Plan B: 0 of 5",
      "Asked for help | Plan B: 2 of 5",
    ]);
    const keyValue = await derive(utf8("| Owner | |\n|---|---|\n| Status | Open |\n"), "meta.md");
    expect(keyValue.segments.map((s) => s.text)).toEqual(["Owner", "Status | Open"]);
  });

  it("strips inline Markdown and blockquote markers, but not snake_case, arithmetic or code", async () => {
    const md = "> **Bold** and *italic* and __strong__ and _em_ and `x_y_z`.\n\nKeep snake_case_name, 2*3*4 and \\*literal\\*.\n\n---\n\nSetext title\n============\n";
    const r = await derive(utf8(md), "notes.md");
    expect(r.segments.map((s) => s.text)).toEqual([
      "Bold and italic and strong and em and x_y_z.",
      "Keep snake_case_name, 2*3*4 and *literal*.",
      "# Setext title",
    ]);
    expect(r.segments[2]!.heading_level).toBe(1);
    expect(stripInlineMarkdown("***both***")).toBe("both");
    // Plain text keeps its asterisks.
    const t = await derive(utf8("A *starred* word.\n"), "a.txt");
    expect(t.segments[0]!.text).toBe("A *starred* word.");
  });

  it("reads **Name:** turns in a Markdown transcript as speakers", async () => {
    const md = "# Interview\n\n**Interviewer:** How do you plan?\n\n**Ana Lucía:** Quarterly, then\nwe revise monthly.\n\n**Interviewer:** Who decides?\n\n**Ana Lucía**: The *ops* lead.\n";
    const r = await derive(utf8(md), "interview.md");
    expect(r.parser).toBe("markdown");
    expect(r.segments.map((s) => [s.speaker, s.text])).toEqual([
      [null, "# Interview"],
      ["Interviewer", "How do you plan?"],
      ["Ana Lucía", "Quarterly, then we revise monthly."],
      ["Interviewer", "Who decides?"],
      ["Ana Lucía", "The ops lead."],
    ]);
  });

  it("reads a timed label on its own line as the speaker of the paragraphs below it", async () => {
    const md = [
      "# Working session",
      "",
      "Kept: every message. Dropped: tool calls.",
      "",
      "## 1. Scope",
      "",
      "**Dana** (14:02 UTC):",
      "",
      "Plan the week first.",
      "",
      "Then the crews.",
      "",
      "Decision: ship it.",
      "",
      "**Sam, agent** (14:03 UTC):",
      "",
      "- Week plan drafted",
      "",
      "**Dana** (14:05 UTC):",
      "Good.",
      "",
      "## 2. Next",
      "",
      "Unattributed note.",
      "",
      "**Sam** (14:09 UTC): Pricing next.",
      "",
      "**Sam** (14:10 UTC):",
      "",
      "Done.",
    ].join("\n");
    const r = await derive(utf8(md), "session.md");
    expectOffsetsExact(r);
    expect(r.segments.map((s) => [s.speaker, s.text])).toEqual([
      [null, "# Working session"],
      [null, "Kept: every message. Dropped: tool calls."],
      [null, "## 1. Scope"],
      ["Dana", "Plan the week first."],
      ["Dana", "Then the crews."],
      ["Dana", "Decision: ship it."],
      ["Sam, agent", "Week plan drafted"],
      ["Dana", "Good."],
      [null, "## 2. Next"],
      [null, "Unattributed note."],
      ["Sam", "Pricing next."],
      ["Sam", "Done."],
    ]);
  });

  it("takes neither untimed labels nor a few timed ones for a transcript", async () => {
    const notes = "Decisions:\n\nShip Friday.\n\nActions:\n\nCall Dana.\n\nDecisions:\n\nHold pricing.\n\nActions:\n\nCall Sam.\n";
    const few = "Dana (09:00):\n\nHello.\n\nSam (09:01):\n\nHi.\n";
    for (const text of [notes, few]) {
      const r = await derive(utf8(text), "notes.md");
      expect(r.segments.every((s) => s.speaker === null)).toBe(true);
    }
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

  it("renders a table one row per segment with header pairs", async () => {
    const html = `<body><table><caption>Checks</caption><thead><tr><th>Check</th><th>Owner</th></tr></thead>
      <tbody><tr><td>Pricing <b>reviewed</b></td><td>Sam</td></tr><tr><td><p>Legal</p><p>sign-off</p></td><td></td></tr></tbody></table></body>`;
    const r = await derive(utf8(html), "checks.html");
    expect(r.segments.map((s) => s.text)).toEqual(["Checks", "Check | Owner", "Check: Pricing reviewed | Owner: Sam", "Check: Legal sign-off"]);
  });

  it("labels a matrix with an empty corner cell the same way as Markdown and DOCX", async () => {
    const html = `<body><table><tr><th></th><th>Plan A</th><th>Plan B</th></tr>
      <tr><th>Reached the saved view</th><td>4 of 5</td><td>0 of 5</td></tr></table></body>`;
    const r = await derive(utf8(html), "results.html");
    expect(r.segments.map((s) => s.text)).toEqual(["Plan A | Plan B", "Reached the saved view | Plan A: 4 of 5 | Plan B: 0 of 5"]);
  });

  it("keeps adjacent elements apart instead of running them together", async () => {
    const html = `<body><p><a href="/a">Intranet</a><a href="/b">Wiki</a></p>
      <div>Labels: <span>procedure</span><span>stage-gate</span><span>governance</span></div><p>un<b>believ</b>able</p></body>`;
    const r = await derive(utf8(html), "page.html");
    expect(r.segments.map((s) => s.text)).toEqual(["Intranet Wiki", "Labels: procedure stage-gate governance", "unbelievable"]);
  });

  it("fails a page with no readable text, such as a single-page app's shell", async () => {
    const html = `<!doctype html><html><head><title>Manual</title><script src="/app.js"></script></head>
      <body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
    const r = await derive(utf8(html), "manual.html");
    expect(r.status).toBe("failed");
    expect(r.segments).toEqual([]);
    expect(r.status_detail).toMatch(/no readable text/);
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

  it("reads Name: paragraphs as speaker turns, the same as a plain-text transcript", async () => {
    const turns = [
      { text: "Interviewer: How do you plan?" },
      { text: "Quarterly, then we revise monthly.", boldLead: "Dana Ortiz:" },
      { text: "Interviewer: Who decides?" },
      { text: "Dana Ortiz: The ops lead." },
    ];
    const r = await derive(makeDocxParagraphs([{ text: "Planning call", style: "Title" }, ...turns]), "call.docx");
    expect(r.segments.map((s) => [s.speaker, s.text])).toEqual([
      [null, "# Planning call"],
      ["Interviewer", "How do you plan?"],
      ["Dana Ortiz", "Quarterly, then we revise monthly."],
      ["Interviewer", "Who decides?"],
      ["Dana Ortiz", "The ops lead."],
    ]);
    expect(r.facts["transcript_turns"]).toBe(4);
    const txt = await derive(utf8(turns.map((t) => (t.boldLead ? `${t.boldLead} ${t.text}` : t.text)).join("\n")), "call.txt");
    expect(txt.segments.map((s) => [s.speaker, s.text])).toEqual(r.segments.slice(1).map((s) => [s.speaker, s.text]));
  });

  it("leaves an ordinary document's labelled paragraphs alone", async () => {
    const r = await derive(
      makeDocxParagraphs([{ text: "Note: draft." }, { text: "We met on Tuesday." }, { text: "Scope: pricing." }, { text: "Owner: Sam." }, { text: "Status: open." }]),
      "memo.docx",
    );
    expect(r.segments.every((s) => s.speaker === null)).toBe(true);
    expect(r.segments[0]!.text).toBe("Note: draft.");
  });

  it("puts Heading 1 below a Title, as Markdown puts ## below #", async () => {
    const withTitle = await derive(
      makeDocxParagraphs([{ text: "Planning notes", style: "Title" }, { text: "Agenda", style: "Heading1" }, { text: "Item", style: "Heading2" }, { text: "Body." }]),
      "notes.docx",
    );
    expect(withTitle.segments.map((s) => [s.text, s.heading_level ?? null])).toEqual([
      ["# Planning notes", 1],
      ["## Agenda", 2],
      ["### Item", 3],
      ["Body.", null],
    ]);
    const noTitle = await derive(makeDocxParagraphs([{ text: "Agenda", style: "Heading1" }, { text: "Body." }]), "notes.docx");
    expect(noTitle.segments[0]).toMatchObject({ text: "# Agenda", heading_level: 1 });
  });

  it("numbers decimal list items, drops bullet markers, and labels a matrix with an empty corner cell", async () => {
    const r = await derive(
      makeDocxList([
        { text: "Tasks", style: "Heading1" },
        { text: "Find the overdue approvals.", numId: 1 },
        { text: "Open the oldest one.", numId: 1, ilvl: 1 },
        { text: "Approve it.", numId: 1 },
        { text: "Crews text the office.", numId: 2 },
        { text: "Continues the list.", numId: 1 },
        { text: "Restarts at one.", numId: 3 },
        { text: "Numbered by its style.", style: "ListNumber" },
        { text: "A plain paragraph." },
      ]),
      "tasks.docx",
    );
    expect(r.segments.map((s) => s.text)).toEqual([
      "# Tasks",
      "1. Find the overdue approvals.",
      "1.1. Open the oldest one.",
      "2. Approve it.",
      "Crews text the office.",
      "3. Continues the list.",
      "1. Restarts at one.",
      "4. Numbered by its style.",
      "A plain paragraph.",
    ]);
    const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<w:document ${W}><w:body><w:tbl><w:tr><w:tc><w:p/></w:tc>${cell("Plan A")}${cell("Plan B")}</w:tr><w:tr>${cell("Reached the saved view")}${cell("4 of 5")}${cell("0 of 5")}</w:tr></w:tbl></w:body></w:document>`;
    const matrix = await derive(zipSync({ "word/document.xml": strToU8(doc) }), "results.docx");
    expect(matrix.segments.map((s) => s.text)).toEqual(["Plan A | Plan B", "Reached the saved view | Plan A: 4 of 5 | Plan B: 0 of 5"]);
  });

  it("reports failed for a file that is not a Word document", async () => {
    const r = await derive(utf8("not a zip"), "x.docx");
    expect(r.status).toBe("failed");
  });
});

describe("DOC", () => {
  const texts = async (bytes: Uint8Array) => (await derive(bytes, "notes.doc")).segments.map((s) => s.text);
  const failure = async (bytes: Uint8Array) => {
    const r = await derive(bytes, "notes.doc");
    expect(r.status).toBe("failed");
    expect(r.parser).toBe("doc");
    expect(r.segments).toEqual([]);
    return r.status_detail ?? "";
  };

  it("reads a Word 97 document's paragraphs, headings and table rows", async () => {
    const bytes = makeWordDoc(
      [
        ["Crew planning review\rWhy crews call the office\rDispatchers re-plan the day by phone.\r", true],
        ["Crew\x07Shift\x07\x07North\rteam\x07Early\x07\x07", true],
        ["After the table.\r", true],
      ],
      {
        styles: [0, 1, 62],
        paragraphs: [
          { istd: 2 },
          { istd: 1 },
          {},
          { inTable: true },
          { inTable: true },
          { inTable: true, rowEnd: true },
          { inTable: true },
          { inTable: true },
          { inTable: true },
          { inTable: true, rowEnd: true },
          {},
        ],
      },
    );
    const r = await derive(bytes, "review.doc");
    expect(r.status).toBe("ready");
    expect(r.parser).toBe("doc");
    expect(r.segments.map((s) => s.text)).toEqual([
      "# Crew planning review",
      "## Why crews call the office",
      "Dispatchers re-plan the day by phone.",
      "Crew | Shift",
      "Crew: North team | Shift: Early",
      "After the table.",
    ]);
    expect(r.segments.map((s) => s.heading_level ?? null)).toEqual([1, 2, null, null, null, null]);
    expect(r.facts).toEqual({ doc_format: "word97", table_count: 1 });
    expectOffsetsExact(r);
  });

  it("decodes 8-bit Windows-1252 and UTF-16 pieces into one text", async () => {
    const bytes = makeWordDoc([
      ["The café budget – ", true],
      ["reviewed in 日本 ", false],
      ["“quarterly”.\r", true],
    ]);
    expect(await texts(bytes)).toEqual(["The café budget – reviewed in 日本 “quarterly”."]);
  });

  it("keeps field results and drops field codes, nested or not", async () => {
    const bytes = makeWordDoc([
      ['See \x13 HYPERLINK "https://example.com/plan" \x14the plan\x15 today.\r', true],
      ["Page \x13 PAGE \x145\x15 of \x13 NUMPAGES \x15.\r", true],
      ["Nested \x13 IF \x13 DATE \x142026\x15 \x14kept\x15 result.\r", true],
    ]);
    expect(await texts(bytes)).toEqual(["See the plan today.", "Page 5 of .", "Nested kept result."]);
  });

  it("turns breaks into spaces or new paragraphs and drops object marks", async () => {
    const bytes = makeWordDoc([
      ["Line one\x0bline two\x0cNext page\r", true],
      ["co\x1eowner and re\x1fview\x01 with\xa0space\tand tab\r", true],
    ]);
    expect(await texts(bytes)).toEqual(["Line one line two", "Next page", "co-owner and review with space and tab"]);
  });

  it("reads only the main story, not the footnotes and headers after it", async () => {
    expect(await texts(makeWordDoc([["Main text only.\r", true]], { tail: "A footnote.\r" }))).toEqual(["Main text only."]);
  });

  it("finds table rows from cell marks alone, keeping empty cells in their columns", async () => {
    const bytes = makeWordDoc([
      ["Asset\x07Risk\x07Cost\x07\x07", true],
      ["Feeder 7\x07\x07300\x07\x07", true],
      ["Pump\x07Low\x07\x07\x07", true],
      ["After.\r", true],
    ]);
    expect(await texts(bytes)).toEqual(["Asset | Risk | Cost", "Asset: Feeder 7 | Cost: 300", "Asset: Pump | Risk: Low", "After."]);
  });

  it("reads speaker turns in a transcript saved as Word 97", async () => {
    const r = await derive(
      makeWordDoc([["Dana: We export every Friday.\rLee: Why Friday?\rDana: The tool cannot.\rLee: Thanks.\r", true]]),
      "call.doc",
    );
    expect(r.segments.map((s) => [s.speaker, s.text])).toEqual([
      ["Dana", "We export every Friday."],
      ["Lee", "Why Friday?"],
      ["Dana", "The tool cannot."],
      ["Lee", "Thanks."],
    ]);
    expect(r.facts["transcript_turns"]).toBe(4);
  });

  it("reads a Word 6 or Word 95 document's text and headings", async () => {
    const bytes = makeWordDoc([["Site visit\rCrews keep a paper log – always.\rTool\x07Use\x07\x07Radio\x07Daily\x07\x07Done.\r", true]], {
      word6: true,
      styles: [0, 1],
      paragraphs: [{ istd: 1 }, {}, {}, {}, {}, {}, {}, {}, {}],
    });
    const r = await derive(bytes, "visit.doc");
    expect(r.status).toBe("ready");
    expect(r.segments.map((s) => s.text)).toEqual(["# Site visit", "Crews keep a paper log – always.", "Tool | Use", "Tool: Radio | Use: Daily", "Done."]);
    expect(r.facts).toEqual({ doc_format: "word6", table_count: 1 });
    expectOffsetsExact(r);
  });

  it("reports why a Word binary document cannot be read", async () => {
    expect(await failure(makeWordDoc([["Secret.\r", true]], { encrypted: true }))).toContain("encrypted");
    expect(await failure(makeWordDoc([["Old.\r", true]], { word6: true, nFib: 0x2d }))).toContain("Word 2");
    expect(await failure(makeWordDoc([["Fast.\r", true]], { word6: true, fastSaved: true }))).toContain("fast-saved");
    expect(await failure(makeCompoundFile({ Workbook: new Uint8Array(100) }))).toContain("no WordDocument stream");
  });

  it("refuses hostile structure instead of repeating or overrunning text", async () => {
    // Every piece claims the same characters, which an unchecked reader would copy once per piece.
    const pieces: [string, boolean][] = Array.from({ length: 40 }, () => ["Repeated text. ", true]);
    const whole = pieces.length * pieces[0]![0].length;
    expect(await failure(makeWordDoc(pieces, { cps: [0, ...Array.from({ length: 40 }, (_, i) => (i % 2 ? 0 : whole))], ccpText: whole }))).toContain("piece table is malformed");
    expect(await failure(makeWordDoc([["Text.\r", true]], { cps: [3, 9] }))).toContain("piece table is malformed");
    expect(await failure(makeWordDoc([["Text.\r", true]], { ccpText: 10 ** 9 }))).toContain("main text length is out of range");
    expect(await failure(makeWordDoc([["Text.\r", true]], { fcShift: 0x10000 }))).toContain("outside the WordDocument stream");
    expect(await failure(makeWordDoc([["Text.\r", false]], { fcShift: 0x10000 }))).toContain("outside the WordDocument stream");
    expect(await failure(makeCompoundFile({ WordDocument: new Uint8Array(8192) }, { loopFat: true }))).toContain("loops");
  });

  it("reads a DOCX package saved as .doc with the DOCX parser", async () => {
    const asDoc = await derive(makeDocx(), "review.doc");
    const asDocx = await derive(makeDocx(), "review.docx");
    expect(asDoc.parser).toBe("doc");
    expect(asDoc.segments).toEqual(asDocx.segments);
    expect(asDoc.facts).toEqual({ doc_format: "docx", ...asDocx.facts });
  });

  it("reads the HTML part of a MIME HTML export saved as .doc", async () => {
    const mhtml = [
      "Date: Thu, 14 May 2026 20:53:04 +0000 (UTC)",
      "Subject: Exported page",
      "MIME-Version: 1.0",
      "Content-Type: multipart/related;",
      '\tboundary="----=_Part_7_1"',
      "",
      "------=_Part_7_1",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<html><body><h1>Crew notes</h1><p class=3D"x">Planners need a caf=C3=A9 view of the =',
      "week.</p></body></html>",
      "------=_Part_7_1",
      "Content-Type: image/png",
      "Content-Transfer-Encoding: base64",
      "",
      "iVBORw0KGgo=",
      "------=_Part_7_1--",
      "",
    ].join("\r\n");
    const r = await derive(utf8(mhtml), "export.doc");
    expect(r.segments.map((s) => s.text)).toEqual(["# Crew notes", "Planners need a café view of the week."]);
    expect(r.facts["doc_format"]).toBe("mhtml");
    expectOffsetsExact(r);
  });

  it("decodes a base64 HTML part in its declared character set", async () => {
    const html = Uint8Array.from([..."<p>Caf", 0xe9, ..." \u0093menu\u0094</p>"].map((c) => (typeof c === "number" ? c : c.charCodeAt(0))));
    const mhtml = `MIME-Version: 1.0\nContent-Type: multipart/related; boundary=b1\n\n--b1\nContent-Type: text/html; charset="windows-1252"\nContent-Transfer-Encoding: base64\n\n${btoa(String.fromCharCode(...html))}\n--b1--\n`;
    expect(await texts(utf8(mhtml))).toEqual(["Café “menu”"]);
  });

  it("reads plain HTML saved as .doc, in the character set its meta tag declares", async () => {
    const head = utf8('<html><head><meta http-equiv=Content-Type content="text/html; charset=windows-1252"></head><body><p>Caf');
    const tail = utf8(" plan</p></body></html>");
    const bytes = new Uint8Array([...head, 0xe9, ...tail]);
    const r = await derive(bytes, "page.doc");
    expect(r.segments.map((s) => s.text)).toEqual(["Café plan"]);
    expect(r.facts["doc_format"]).toBe("html");
  });

  it("reports failed for other files named .doc, and for HTML with no text", async () => {
    expect(await failure(utf8("{\\rtf1\\ansi Hello}"))).toContain("Rich Text Format");
    expect(await failure(utf8("plain bytes, not a document"))).toContain("not a Word document");
    expect(await failure(utf8("<html><body><script>render()</script></body></html>"))).toContain("no readable text");
    expect(await failure(utf8("MIME-Version: 1.0\nContent-Type: multipart/related; boundary=b\n\n--b\nContent-Type: image/png\n\nxx\n--b--\n"))).toContain("no HTML part");
  });

  it("is chosen for application/msword when the name has no known extension", async () => {
    const r = await derive(makeWordDoc([["Routed by type.\r", true]]), "upload", { mediaType: "application/msword" });
    expect(r.parser).toBe("doc");
    expect(r.segments.map((s) => s.text)).toEqual(["Routed by type."]);
    expect((await derive(makeWordDoc([["Upper case.\r", true]]), "OLD.DOC")).parser).toBe("doc");
  });
});

describe("CSV", () => {
  it("reads a CSV like a one-sheet workbook, with quoted fields", async () => {
    const csv = 'Account,Seats,Comment\r\nAcme,12,"Plans weekly, by hand"\r\nGlobex,3.5,"Said ""maybe""\non a second line"\r\n\r\n';
    const r = await derive(utf8(csv), "accounts.csv");
    expect(r.status).toBe("ready");
    expect(r.parser).toBe("csv");
    expect(r.segments.map((s) => s.text)).toEqual([
      "[row 1] Account | Seats | Comment",
      "[row 2] Account: Acme | Seats: 12 | Comment: Plans weekly, by hand",
      '[row 3] Account: Globex | Seats: 3.5 | Comment: Said "maybe" on a second line',
    ]);
    expect(r.facts).toMatchObject({ row_count: 3, truncated: false });
    expectOffsetsExact(r);
  });

  it("reads TSV and semicolon-separated files, and picks the parser by media type", async () => {
    const tsv = await derive(utf8("Name\tRole\nDana\tOps lead\n"), "people.tsv");
    expect(tsv.segments[1]!.text).toBe("[row 2] Name: Dana | Role: Ops lead");
    const semi = await derive(utf8("Name;Role\nSam;Planner\n"), "export", { mediaType: "text/csv" });
    expect(semi.segments[1]!.text).toBe("[row 2] Name: Sam | Role: Planner");
  });

  it("marks a header column a row leaves empty as blank, and leaves side notes unlabelled", async () => {
    const r = await derive(utf8("Sample,Cu_pct,S_pct\nKL-01,1.2,0.4\nKL-02,0.9,\nNR,,\n,,,Checked twice\n"), "assays.csv");
    expect(r.segments.map((s) => s.text)).toEqual([
      "[row 1] Sample | Cu_pct | S_pct",
      "[row 2] Sample: KL-01 | Cu_pct: 1.2 | S_pct: 0.4",
      "[row 3] Sample: KL-02 | Cu_pct: 0.9 | S_pct: (blank)",
      "[row 4] Sample: NR | Cu_pct: (blank) | S_pct: (blank)",
      "[row 5] Checked twice",
    ]);
    expect(r.parser_version).toBe("4");
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

  it("marks a header column a row leaves empty as blank, as CSV does", async () => {
    const r = await derive(makeXlsxSheet([["Sample", "Cu_pct", "S_pct"], ["KL-01", [1.2, 0], [0.4, 0]], ["KL-02", [0.9, 0]], ["NR", "", ""]]), "assays.xlsx");
    expect(r.segments.slice(2).map((s) => s.text)).toEqual([
      "[Register, row 2] Sample: KL-01 | Cu_pct: 1.2 | S_pct: 0.4",
      "[Register, row 3] Sample: KL-02 | Cu_pct: 0.9 | S_pct: (blank)",
      "[Register, row 4] Sample: NR | Cu_pct: (blank) | S_pct: (blank)",
    ]);
    expect(r.parser_version).toBe("6");
  });

  it("reads each value as its cell's number format shows it", async () => {
    const r = await derive(
      makeXlsxSheet(
        [
          ["Metric", "Change", "Share", "Ratio", "Revenue", "Margin", "Delta", "Status"],
          ["Bookings", [0.14, 1], [0.256, 2], [2.9666666666666666, 3], [57700, 4], [-1234, 5], [-1234, 6], { text: "late", style: 7 }],
          ["Churn", [-0.05, 1], [1, 2], [-0.0004, 3], [-57700, 4], [1234, 5], [1234, 6], "steady"],
          ["Pipeline", [0, 1], [1234567, 8], [0.375, 9], [1234567, 10], [0, 11], [0.000123, 12], [45000, 0]],
        ],
        {
          numFmts: ["+0.0%;-0.0%;0.0%", "0.000", '+"$"#,##0;-"$"#,##0', "#,##0;[Red]#,##0", '@" (est.)"', '#,##0.0,,"M"', "# ?/8", '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)'],
          xfs: [0, 164, 9, 165, 166, 37, 167, 168, 169, 170, 171, 171, 11],
        },
      ),
      "metrics.xlsx",
    );
    expect(r.markdown).toBe(
      "# Sheet: Register\n\n" +
        "| Row | Metric | Change | Share | Ratio | Revenue | Margin | Delta | Status |\n" +
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
        // Signs as the format writes them, negatives in brackets or (shown only in red) with a minus.
        "| 2 | Bookings | +14.0% | 26% | 2.967 | +$57,700 | (1,234) | -1,234 | late (est.) |\n" +
        "| 3 | Churn | -5.0% | 100% | 0.000 | -$57,700 | 1,234 | 1,234 | steady |\n" +
        "| 4 | Pipeline | 0.0% | 1.2M | 3/8 | $1,234,567 | $- | 1.23E-04 | 45000 |\n",
    );
  });

  it("reads dates and times as the format shows them, and the locale's own formats in ISO 8601", async () => {
    const r = await derive(
      makeXlsxSheet(
        [
          ["Permit", "Granted", "Expiry", "Checked", "Meeting", "Lead time", "Logged", "Renewed", "Share"],
          ["EL 101", [43565, 1], [46122, 2], [46055.5, 3], [0.5625, 4], [12.5, 5], [1.25, 6], [46086, 7], [0.25, 8]],
          ["EL 102", [1, 2], [60, 2], [61, 2], [-3, 2], [0.5, 1], [46122.25, 1], [45000, 0], [44927.75, 9]],
        ],
        {
          numFmts: ["yyyy-mm-dd", '[$-409]d mmm yyyy;@', '0.0" days"', "[Red]#,##0_);(#,##0)", 'dd/mm/yyyy\\ hh:mm:ss AM/PM'],
          xfs: [0, 164, 14, 22, 20, 166, 46, 165, 10, 168],
        },
      ),
      "register.xlsx",
    );
    expect(r.segments.map((s) => s.text)).toEqual([
      "# Sheet: Register",
      "[Register, row 1] Permit | Granted | Expiry | Checked | Meeting | Lead time | Logged | Renewed | Share",
      // 14 and 22 are the locale's short date and date and time, which the file does not record: ISO 8601.
      "[Register, row 2] Permit: EL 101 | Granted: 2019-04-10 | Expiry: 2026-04-10 | Checked: 2026-02-02 12:00 | Meeting: 13:30 | Lead time: 12.5 days | Logged: 30:00:00 | Renewed: 5 Mar 2026 | Share: 25.00%",
      // A negative date, and a day before the 1900 system's first, read as numbers.
      "[Register, row 3] Permit: EL 102 | Granted: 1900-01-01 | Expiry: 1900-02-29 | Checked: 1900-03-01 | Meeting: -3 | Lead time: 0.5 | Logged: 2026-04-10 | Renewed: 45000 | Share: 01/01/2023 06:00:00 PM",
    ]);
  });

  it("shows a time under one day in a date and time format as the time alone, as the 1900 system has no day 0", async () => {
    const r = await derive(
      makeXlsxSheet([["Crew", "Starts", "Ends", "Break", "Logged", "Day"], ["North", [0.5, 1], [0.75, 2], [0.25, 3], [0.5, 4], [0.5, 5]]], {
        numFmts: ["m/d/yyyy h:mm", "yyyy-mm-dd hh:mm", "dd/mm/yyyy\\ h:mm AM/PM", "yyyy-mm-dd"],
        xfs: [0, 164, 165, 166, 22, 167],
      }),
      "shifts.xlsx",
    );
    // A date alone has nothing to show for it, and reads as a number.
    expect(r.segments.slice(2).map((s) => s.text)).toEqual(["[Register, row 2] Crew: North | Starts: 12:00 | Ends: 18:00 | Break: 6:00 AM | Logged: 12:00 | Day: 0.5"]);
    // From day 1 on, the date and the time.
    expect(formatNumber(readFormat("m/d/yyyy h:mm"), 1.5, false)).toBe("1/1/1900 12:00");
    // In the 1904 system, day 0 is a date.
    expect(formatNumber(readFormat("yyyy-mm-dd hh:mm"), 0.75, true)).toBe("1904-01-01 18:00");
  });

  it("takes a date alone from the day its serial falls in, and rounds only a time it shows", () => {
    // 45658.9999999 is 2025-01-01 at 23:59:59.991: that day under a date alone, as SheetJS shows it.
    expect(formatNumber(readFormat("yyyy-mm-dd"), 45658.9999999, false)).toBe("2025-01-01");
    expect(formatNumber(readFormat("d-mmm-yy"), 45658.9999999, false)).toBe("1-Jan-25");
    expect(formatNumber(builtinFormat(14)!, 45658.9999999, false)).toBe("2025-01-01");
    // A time rounds to the finest part it shows, into the next day.
    expect(formatNumber(readFormat("yyyy-mm-dd hh:mm"), 45658.9999999, false)).toBe("2025-01-02 00:00");
    expect(formatNumber(builtinFormat(22)!, 45658.9999999, false)).toBe("2025-01-02 00:00");
    // A serial a float's error short of midnight is that midnight.
    expect(formatNumber(readFormat("yyyy-mm-dd"), 45658.9999999999, false)).toBe("2025-01-02");
  });

  it("counts dates from 1904 when the workbook uses the 1904 date system", async () => {
    const r = await derive(makeXlsxSheet([["Permit", "Expiry"], ["EL 101", [44660, 1]], ["EL 102", [0, 1]]], { numFmts: ["yyyy-mm-dd"], xfs: [0, 164], date1904: true }), "register.xlsx");
    expect(r.segments.slice(2).map((s) => s.text)).toEqual(["[Register, row 2] Permit: EL 101 | Expiry: 2026-04-10", "[Register, row 3] Permit: EL 102 | Expiry: 1904-01-01"]);
  });

  it("applies a format's parts: thousands, scaling, decimals, exponents, fractions, conditions, text and dates", () => {
    const shown = (code: string, v: number | string) => {
      const f = readFormat(code);
      return typeof v === "string" ? formatText(f, v) : formatNumber(f, v, false);
    };
    expect(shown("#,##0.00", -1234.5)).toBe("-1,234.50");
    expect(shown("#,##0,", 1234567)).toBe("1,235");
    expect(shown("0.0#", 1.5)).toBe("1.5");
    expect(shown("#.00", 0.5)).toBe(".50");
    expect(shown("0.00", -0.001)).toBe("0.00");
    expect(shown("00000", 123)).toBe("00123");
    expect(shown("(000) 000-0000", 5551234567)).toBe("(555) 123-4567");
    expect(shown("0.00E+00", 99999)).toBe("1.00E+05");
    expect(shown("##0.0E+0", 12345)).toBe("12.3E+3");
    expect(shown("# ?/?", 1.5)).toBe("1 1/2");
    expect(shown('[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', 1500)).toBe("1.5K");
    expect(shown('[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', -12)).toBe("-12");
    expect(shown("[$€-407]#,##0.00", 1234.5)).toBe("€1,234.50");
    expect(shown("#,##0;#,##0", -1234)).toBe("1,234");
    expect(shown('0;-0;0;"Name: "@', "Dana")).toBe("Name: Dana");
    expect(shown("@", 12)).toBeUndefined();
    expect(shown("dddd, mmmm d, yyyy", 46086)).toBe("Thursday, March 5, 2026");
    expect(shown("dd.mm.yy", 46086)).toBe("05.03.26");
    expect(shown("h:mm AM/PM", 0.5625)).toBe("1:30 PM");
    expect(shown("hh:mm:ss.000", 0.5000057870370371)).toBe("12:00:00.500");
    expect(shown("yyyy-mm-dd", -3)).toBeUndefined();
    expect(shown("[$-F800]dddd, mmmm dd, yyyy", 46086)).toBe("2026-03-05");
    expect(formatNumber(builtinFormat(14)!, 46122.25, false)).toBe("2026-04-10");
    // A code longer than Excel takes is read as General.
    expect(shown("0".repeat(300), 12.5)).toBe("12.5");
  });

  it("reads hidden sheets, columns and rows, and says they are hidden", async () => {
    const r = await derive(
      makeWorkbook([
        { name: "Plan", rows: [["Crew", "Lead", "Rate"], ["North", "Dana", [42, 0]], ["South", "Sam", [38, 0]], ["East", "Priya", [40, 0]]], hiddenRows: [3], hiddenColumns: ["C"] },
        { name: "Workings", state: "hidden", rows: [["Note", "Owner"], ["Rates from the 2026 card", "Sam"]] },
      ]),
      "plan.xlsx",
    );
    expect(r.markdown).toBe(
      "# Sheet: Plan\n\n| Row | Crew | Lead | Rate (hidden) |\n| --- | --- | --- | --- |\n| 2 | North | Dana | 42 |\n| 3 (hidden) | South | Sam | 38 |\n| 4 | East | Priya | 40 |\n\n" +
        "# Sheet: Workings (hidden)\n\n| Row | Note | Owner |\n| --- | --- | --- |\n| 2 | Rates from the 2026 card | Sam |\n",
    );
    expect(r.facts).toMatchObject({ sheet_count: 2, hidden_sheets: ["Workings"], hidden_rows: 1, hidden_columns: 1 });
  });

  it("reads a value its format shows as nothing as General, and says it is hidden, but a zero as the blank it shows", async () => {
    const r = await derive(
      makeXlsxSheet(
        [
          ["Crew", "Rate", "Delta", "Note", "Spare", "Reserve"],
          ["North", [42, 1], [-5, 2], { text: "Owner only", style: 1 }, [0, 3], [0, 1]],
          ["South", [38, 0], [5, 2], { text: "Shown", style: 0 }, [0, 4], [12, 3]],
        ],
        // ;;; shows nothing at all and 0;;0 nothing for a negative; 0;-0;;@ and #,##0;(#,##0); show a zero as a blank.
        { numFmts: [";;;", "0;;0", "0;-0;;@", "#,##0;(#,##0);"], xfs: [0, 164, 165, 166, 167] },
      ),
      "rates.xlsx",
    );
    expect(r.segments.slice(2).map((s) => s.text)).toEqual([
      "[Register, row 2] Crew: North | Rate: 42 (hidden) | Delta: -5 (hidden) | Note: Owner only (hidden) | Spare: (blank) | Reserve: (blank)",
      "[Register, row 3] Crew: South | Rate: 38 | Delta: 5 | Note: Shown | Spare: (blank) | Reserve: 12",
    ]);
    // A zero shown as a blank hides nothing, so it is not counted.
    expect(r.facts["hidden_values"]).toBe(3);
  });

  it("says a formula was saved without its value, rather than reading it as 0", async () => {
    const r = await derive(
      makeXlsxSheet([
        ["Item", "Cost", "Total", "Label", "Check"],
        ["Vans", [1200, 0], { formula: "B2*12", value: "" }, { formula: 'A2&""', value: "", type: "str" }, { formula: "B2>1000", value: "1", type: "b" }],
        ["Fuel", [300, 0], { formula: "SUM(B2:B3)" }, { formula: "A3", value: "Fuel", type: "str" }, { formula: "B3>1000", value: "0", type: "b" }],
      ]),
      "costs.xlsx",
    );
    expect(r.segments.slice(2).map((s) => s.text)).toEqual([
      // A string formula whose value is empty has a value, the empty string.
      "[Register, row 2] Item: Vans | Cost: 1200 | Total: =B2*12 (no stored value) | Label: (blank) | Check: TRUE",
      "[Register, row 3] Item: Fuel | Cost: 300 | Total: =SUM(B2:B3) (no stored value) | Label: Fuel | Check: FALSE",
    ]);
    expect(r.facts["formulas_without_values"]).toBe(2);
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

  it("reads a PDF with no text layer as an image is read: unsupported, not failed", async () => {
    const r = await derive(makePdf([]), "scan.pdf");
    expect(r).toMatchObject({ status: "unsupported", parser: "pdf", parser_version: "6", status_detail: SCAN_DETAIL, facts: { text_layer_chars: 0 } });
    // Its detail says what an agent that can see the pages does instead.
    expect(r.status_detail).toMatch(/^the PDF has no text layer: its pages are pictures, as a scan's are, and WhatBuild performs no OCR; an agent that can see its pages should read them/);
    expect(r.status_detail).toContain('derived_write(action="write_text")');
  });
});

describe("PDF layout", () => {
  const read = async (pages: PdfRun[][]) => {
    const r = await derive(makePdfPages(pages), "report.pdf");
    expect(r.status).toBe("ready");
    expectOffsetsExact(r);
    return r;
  };
  const results = [["Sample", "Result", "Limit"], ["Lead", "0.002 mg/L", "0.01"], ["Copper", "0.4 mg/L", "1.3"], ["Nitrate", "2.1 mg/L", "10"]];
  const columns = [72, 200, 320];
  const TABLE = "| Sample | Result | Limit |\n| --- | --- | --- |\n| Lead | 0.002 mg/L | 0.01 |\n| Copper | 0.4 mg/L | 1.3 |\n| Nitrate | 2.1 mg/L | 10 |";

  it("reads a table's rows as a table, whichever order its cells are drawn in", async () => {
    const cell = (i: number, j: number): PdfRun => ({ text: results[i]![j]!, x: columns[j]!, y: 700 - i * 16, bold: i === 0 });
    const byRow = await read([[...pdfLines(["Results by test:"], { top: 730 }), ...results.flatMap((r, i) => r.map((_, j) => cell(i, j)))]]);
    expect(byRow.markdown).toBe(`# Page 1\n\nResults by test:\n\n${TABLE}\n`);
    expect(byRow.facts).toMatchObject({ table_count: 1 });
    // A column at a time, as some reports draw them, reads the same.
    const byColumn = await read([[...pdfLines(["Results by test:"], { top: 730 }), ...columns.flatMap((_, j) => results.map((_, i) => cell(i, j)))]]);
    expect(byColumn.markdown).toBe(byRow.markdown);
  });

  it("reads a table whose cell wraps onto a second line, drawn a cell at a time, a row to a row", async () => {
    const r = await read([
      [
        { text: "Source", x: 72, y: 700, bold: true }, { text: "What we heard", x: 170, y: 700, bold: true }, { text: "Weight", x: 430, y: 700, bold: true },
        { text: "Interview", x: 72, y: 682 }, { text: "Pricing came up twice, and the team", x: 170, y: 682 }, { text: "said it blocks the rollout.", x: 170, y: 669 }, { text: "High", x: 430, y: 682 },
        { text: "Survey", x: 72, y: 651 }, { text: "Mixed responses on the price", x: 170, y: 651 }, { text: "Low", x: 430, y: 651 },
        ...pdfLines(["The interview carries the most weight."], { top: 620 }),
      ],
    ]);
    expect(r.markdown).toBe(
      "# Page 1\n\n| Source | What we heard | Weight |\n| --- | --- | --- |\n| Interview | Pricing came up twice, and the team said it blocks the rollout. | High |\n| Survey | Mixed responses on the price | Low |\n\nThe interview carries the most weight.\n",
    );
  });

  it("keeps a label and its value together, though the value sits lower or is drawn after every label", async () => {
    // A larger value set on the label's line, a little below its baseline.
    const offset = await read([[...pdfLines(["Analysis summary"]), { text: "Samples:", x: 72, y: 600, size: 8 }, { text: "79", x: 140, y: 596, size: 14 }, ...pdfLines(["The results follow."], { top: 560 })]]);
    expect(offset.markdown).toBe("# Page 1\n\nAnalysis summary\n\nSamples: 79\n\nThe results follow.\n");
    // A form whose labels are all drawn before its values.
    const fields = [["Client:", "Example Co."], ["Sample ID:", "S-0001"], ["Samples:", "79"], ["Received:", "2026-03-01"]];
    const form = await read([[...fields.map(([label], i) => ({ text: label!, x: 72, y: 700 - i * 15, size: 9 })), ...fields.map(([, value], i) => ({ text: value!, x: 160, y: 698 - i * 15 }))]]);
    expect(form.markdown).toBe("# Page 1\n\nClient: Example Co.\n\nSample ID: S-0001\n\nSamples: 79\n\nReceived: 2026-03-01\n");
    // Labels and values side by side, two pairs to a line.
    const grid = await read([
      [
        { text: "Method:", x: 72, y: 700 }, { text: "XYZ-12", x: 150, y: 700 }, { text: "Samples:", x: 300, y: 700 }, { text: "79", x: 380, y: 700 },
        { text: "Analyst:", x: 72, y: 685 }, { text: "Dana Lee", x: 150, y: 685 }, { text: "Received:", x: 300, y: 685 }, { text: "2026-03-01", x: 380, y: 685 },
      ],
    ]);
    expect(grid.markdown).toBe("# Page 1\n\nMethod: XYZ-12 · Samples: 79\n\nAnalyst: Dana Lee · Received: 2026-03-01\n");
    expect(grid.facts).toMatchObject({ table_count: 0 });
  });

  it("reads a running header once, where it first appears, and leaves page numbers out, saying so in the facts", async () => {
    const page = (n: number, body: string[]): PdfRun[] => [
      { text: "Example Co. - Field report", x: 72, y: 750, size: 9 },
      ...pdfLines(body),
      { text: `Page ${n} of 3`, x: 280, y: 40, size: 9 },
    ];
    const r = await read([
      page(1, ["Crews plan the week on Friday.", "The office learns of it on Monday."]),
      page(2, ["Vans leave the yard at seven.", "Most jobs start by eight."]),
      page(3, ["Nobody called it a crisis.", "It has been this way for years."]),
    ]);
    expect(r.markdown).toBe(
      "# Page 1\n\nExample Co. - Field report\n\nCrews plan the week on Friday.\n\nThe office learns of it on Monday.\n\n" +
        "# Page 2\n\nVans leave the yard at seven.\n\nMost jobs start by eight.\n\n# Page 3\n\nNobody called it a crisis.\n\nIt has been this way for years.\n",
    );
    expect(r.facts).toMatchObject({ page_count: 3, headers_and_footers: ["Example Co. - Field report", "Page 1 of 3"], headers_and_footers_left_out: 5 });
  });

  it("finds a running line missing from a title page, in two parts, or up the margin, and keeps one apart from its page number", async () => {
    const body = (n: number) => pdfLines([`Section ${n} opens with a plain sentence.`, `It goes on about crew ${n} for a line.`], { top: 700 });
    const footer = (n: number): PdfRun[] => [{ text: "Example Co. - Confidential", x: 72, y: 40, size: 8 }, { text: String(n), x: 530, y: 40, size: 8 }];
    const stamp: PdfRun = { text: "DRAFT - not for circulation", x: 580, y: 300, size: 8, turned: true };
    const r = await read([
      [...pdfLines(["Field report"], { top: 600, size: 20 }), ...footer(1), stamp],
      ...[1, 2, 3].map((n) => [{ text: "Field report", x: 72, y: 760, size: 8 }, ...body(n), ...footer(n + 1), stamp]),
    ]);
    expect(r.markdown).toBe(
      "# Page 1\n\nField report\n\nExample Co. - Confidential\n\nDRAFT - not for circulation\n\n" +
        "# Page 2\n\nField report\n\nSection 1 opens with a plain sentence.\n\nIt goes on about crew 1 for a line.\n\n" +
        "# Page 3\n\nSection 2 opens with a plain sentence.\n\nIt goes on about crew 2 for a line.\n\n" +
        "# Page 4\n\nSection 3 opens with a plain sentence.\n\nIt goes on about crew 3 for a line.\n",
    );
    expect(r.facts).toMatchObject({ headers_and_footers: ["Example Co. - Confidential · 1", "DRAFT - not for circulation", "Field report"], headers_and_footers_left_out: 8 });
  });

  it("keeps lines that are not running lines: a page's own heading, a line set close to the text, a page of one line", async () => {
    // Headings that name each page's week differ, and a line repeated within the text is the text.
    const weeks = await read([1, 2, 3].map((n) => [{ text: `Week ${12 + n} summary`, x: 72, y: 740, size: 14 }, ...pdfLines([`The crews finished ${n + 4} jobs.`, "Nothing else changed."], { top: 710 })]));
    expect(weeks.markdown.match(/Nothing else changed\./g)).toHaveLength(3);
    expect(weeks.markdown).toContain("Week 14 summary");
    expect(weeks.facts).toMatchObject({ headers_and_footers: [], headers_and_footers_left_out: 0 });
    const single = await read([[{ text: "Crews plan the week on Friday.", x: 72, y: 720 }], [{ text: "Crews plan the week on Friday.", x: 72, y: 720 }]]);
    expect(single.markdown).toBe("# Page 1\n\nCrews plan the week on Friday.\n\n# Page 2\n\nCrews plan the week on Friday.\n");
  });

  it("leaves a table's header row in each page's table, and its page numbers out", async () => {
    const head: PdfRun[] = [{ text: "Date", x: 72, y: 720, bold: true }, { text: "Crew", x: 180, y: 720, bold: true }, { text: "Jobs", x: 300, y: 720, bold: true }];
    const rows = (from: number): PdfRun[] =>
      [0, 1, 2].flatMap((i) => [{ text: `2026-03-0${from + i}`, x: 72, y: 704 - i * 16 }, { text: ["North", "South", "East"][i]!, x: 180, y: 704 - i * 16 }, { text: String(3 + i), x: 300, y: 704 - i * 16 }]);
    const r = await read([[...head, ...rows(1), { text: "Page 1 of 2", x: 280, y: 40, size: 9 }], [...head, ...rows(4), { text: "Page 2 of 2", x: 280, y: 40, size: 9 }]]);
    expect(r.markdown).toBe(
      "# Page 1\n\n| Date | Crew | Jobs |\n| --- | --- | --- |\n| 2026-03-01 | North | 3 |\n| 2026-03-02 | South | 4 |\n| 2026-03-03 | East | 5 |\n\n" +
        "# Page 2\n\n| Date | Crew | Jobs |\n| --- | --- | --- |\n| 2026-03-04 | North | 3 |\n| 2026-03-05 | South | 4 |\n| 2026-03-06 | East | 5 |\n",
    );
    expect(r.facts).toMatchObject({ table_count: 2, headers_and_footers: ["Page 1 of 2"], headers_and_footers_left_out: 2 });
  });

  it("reads paragraphs and two columns of prose as it did, a heading on its own, and a list's items apart", async () => {
    const prose = await read([
      pdfLines([
        "We visited six crews in the north region over two weeks and",
        "watched how each of them planned the week ahead. Most of them",
        "planned on Friday afternoon, in the yard, with paper.",
        "The crew leads said the office rarely knew the plan.",
      ]),
    ]);
    expect(prose.markdown).toBe(
      "# Page 1\n\nWe visited six crews in the north region over two weeks and watched how each of them planned the week ahead. Most of them planned on Friday afternoon, in the yard, with paper.\n\nThe crew leads said the office rarely knew the plan.\n",
    );
    // Two columns on one set of baselines, drawn a column at a time, or a line across both at a time.
    const left = ["The crews plan the week on Friday, in", "the yard, with a paper board that the", "lead fills in by hand. Nobody in the", "office sees it until Monday morning,", "when the lead texts a photo of it."];
    const right = ["The office keeps its own schedule in a", "spreadsheet, which it updates from the", "photos. The two rarely agree for long,", "and the crews trust their own board", "over the copy the office keeps."];
    const COLUMNS =
      "# Page 1\n\nThe crews plan the week on Friday, in the yard, with a paper board that the lead fills in by hand. Nobody in the office sees it until Monday morning, when the lead texts a photo of it.\n\n" +
      "The office keeps its own schedule in a spreadsheet, which it updates from the photos. The two rarely agree for long, and the crews trust their own board over the copy the office keeps.\n";
    expect((await read([[...pdfLines(left), ...pdfLines(right, { x: 320 })]])).markdown).toBe(COLUMNS);
    const across = await read([left.flatMap((l, i) => [{ text: l, x: 72, y: 700 - i * 14 }, { text: right[i]!, x: 320, y: 700 - i * 14 }])]);
    expect(across.markdown).toBe(COLUMNS);
    expect(across.facts).toMatchObject({ table_count: 0 });
    // A heading set larger than the text stands on its own; a list's items stand apart, and a bullet set apart by a hanging indent stays with its words.
    const list = await read([
      [
        { text: "Findings", x: 72, y: 720, size: 14, bold: true },
        ...pdfLines(["The crews said three things."], { top: 700 }),
        ...["They plan on Fridays", "They use paper boards", "They text photos"].flatMap((t, i) => [{ text: "•", x: 72, y: 684 - i * 14 }, { text: t, x: 90, y: 684 - i * 14 }]),
      ],
    ]);
    expect(list.markdown).toBe("# Page 1\n\n## Findings\n\nThe crews said three things.\n\n• They plan on Fridays\n\n• They use paper boards\n\n• They text photos\n");
    expect(list.segments.find((g) => g.text === "## Findings")).toMatchObject({ heading_level: 2, page: 1 });
  });

  it("reads a line set clearly larger than its page's text as a heading of its own, its level following its size", async () => {
    const r = await read([
      [
        { text: "Field report", x: 72, y: 740, size: 20 },
        { text: "Findings", x: 72, y: 700, size: 14 },
        ...pdfLines(["The crews plan the week on Friday afternoon, in the yard, with a", "paper board that the lead fills in by hand before anyone leaves."], { top: 680 }),
        { text: "What does the office see?", x: 72, y: 640, size: 13 },
        ...pdfLines(["Nobody in the office sees the board until Monday."], { top: 622 }),
        // A heading's lines in its size join, and a number set apart by a hanging indent stays with its words.
        { text: "2", x: 72, y: 590, size: 14 }, { text: "A heading that runs on over two", x: 90, y: 590, size: 14 }, { text: "lines in the same size", x: 90, y: 574, size: 14 },
        ...pdfLines(["Then the text goes on, as it did before."], { top: 556 }),
      ],
      // The same size is the same level on every page.
      [{ text: "Next steps:", x: 72, y: 720, size: 14 }, ...pdfLines(["The office will read the board on Fridays.", "The crews will send a photo of it."], { top: 700 })],
    ]);
    expect(r.markdown).toBe(
      "# Page 1\n\n## Field report\n\n### Findings\n\nThe crews plan the week on Friday afternoon, in the yard, with a paper board that the lead fills in by hand before anyone leaves.\n\n" +
        "#### What does the office see?\n\nNobody in the office sees the board until Monday.\n\n### 2 A heading that runs on over two lines in the same size\n\nThen the text goes on, as it did before.\n\n" +
        "# Page 2\n\n### Next steps:\n\nThe office will read the board on Fridays.\n\nThe crews will send a photo of it.\n",
    );
    expect(r.segments.filter((g) => g.heading_level! > 1).map((g) => [g.heading_level, g.page])).toEqual([[2, 1], [3, 1], [4, 1], [3, 1], [3, 2]]);
    // A heading's words are text the layer holds.
    expect(r.facts["text_layer_chars"]).toBeGreaterThan(r.markdown.replace(/^#+ Page \d+$|^#+ |\s/gm, "").length - 20);
  });

  it("reads what is set large but no heading as text: a line barely larger, prose set large, a list item, a number, a table's row", async () => {
    const r = await read([
      [
        // Not clearly larger than the text: it runs on, as it did.
        { text: "A line a little larger", x: 72, y: 740, size: 12 },
        ...pdfLines(["than the text, which goes on under it."], { top: 724 }),
        // Prose set large, as a pull quote is, ends as prose does.
        { text: "Crews trust the paper board.", x: 72, y: 690, size: 18 },
        // A list item set large stays an item, and a number alone is no heading: the words under it go on from it.
        { text: "• Boards by the gate", x: 72, y: 660, size: 16 },
        { text: "87%", x: 72, y: 630, size: 30 },
        ...pdfLines(["of the crews said so."], { top: 610 }),
        // A large word on a line of the text is not a line set large.
        { text: "Crews", x: 72, y: 580, size: 16 }, { text: "plan the week on Friday.", x: 125, y: 580 },
        ...pdfLines(["The office plans it on Monday."], { top: 562 }),
      ],
      // More lines set large than a heading takes read as the paragraph they make, and it ends where the size does.
      [
        ...pdfLines(["The crews plan the week", "on Friday afternoon", "in the yard with a", "paper board"], { top: 720, size: 16, leading: 20 }),
        ...pdfLines(["Nobody in the office sees the board until Monday morning, when the", "lead texts a photo of it to the office, which copies it out by hand."], { top: 620 }),
      ],
      // A table's first row set larger is the table's, and a page all in one size has no heading.
      [
        { text: "Sample", x: 72, y: 700, size: 14 }, { text: "Result", x: 200, y: 700, size: 14 },
        { text: "Lead", x: 72, y: 680 }, { text: "0.002 mg/L", x: 200, y: 680 },
        { text: "Copper", x: 72, y: 664 }, { text: "0.4 mg/L", x: 200, y: 664 },
        ...pdfLines(["The results are within the limits."], { top: 630 }),
      ],
      pdfLines(["Large print notes", "The crews plan on Friday."], { size: 18, leading: 24 }),
    ]);
    expect(r.markdown).toBe(
      "# Page 1\n\nA line a little larger than the text, which goes on under it.\n\nCrews trust the paper board.\n\n• Boards by the gate\n\n87% of the crews said so.\n\nCrews plan the week on Friday.\n\nThe office plans it on Monday.\n\n" +
        "# Page 2\n\nThe crews plan the week on Friday afternoon in the yard with a paper board\n\nNobody in the office sees the board until Monday morning, when the lead texts a photo of it to the office, which copies it out by hand.\n\n" +
        "# Page 3\n\n| Sample | Result |\n| --- | --- |\n| Lead | 0.002 mg/L |\n| Copper | 0.4 mg/L |\n\nThe results are within the limits.\n\n" +
        "# Page 4\n\nLarge print notes\n\nThe crews plan on Friday.\n",
    );
    expect(r.segments.filter((g) => g.heading_level! > 1)).toEqual([]);
  });

  it("sets a line's cells apart when it is no table's row, and reads a line of justified prose stretched wide as prose", async () => {
    const row = await read([[{ text: "Quarterly report", x: 72, y: 720, size: 14 }, { text: "March 2026", x: 470, y: 720, size: 10 }, ...pdfLines(["The quarter went well."], { top: 690 })]]);
    expect(row.markdown).toBe("# Page 1\n\nQuarterly report · March 2026\n\nThe quarter went well.\n");
    const words = ["Nobody", "in", "the", "office", "sees", "it"];
    const loose = await read([
      [
        ...pdfLines(["The crews plan the week on Friday afternoon, in the yard, with a", "paper board that the lead fills in by hand before anyone leaves."], { top: 700 }),
        ...words.map((text, i) => ({ text, x: [72, 150, 200, 260, 340, 395][i]!, y: 672 })),
        ...pdfLines(["until Monday morning, when the lead texts a photo of the board."], { top: 658 }),
      ],
    ]);
    expect(loose.markdown).toBe(
      "# Page 1\n\nThe crews plan the week on Friday afternoon, in the yard, with a paper board that the lead fills in by hand before anyone leaves.\n\nNobody in the office sees it until Monday morning, when the lead texts a photo of the board.\n",
    );
  });

  describe("a line that ends no sentence", () => {
    const WIDE = "We visited six crews in the north region over two weeks and watched";

    it("ends its paragraph where it stops short of its column's width, whatever follows it", async () => {
      const r = await read([
        pdfLines([
          "Attendees",
          "Dana Lee",
          "Next steps for the crews",
          WIDE,
          "how each of them planned the week ahead, in the yard, with paper.",
          "This one ends without a full stop as somebody left it off here",
          "The next paragraph starts with a capital letter and it goes on",
          "over more than one line, as a paragraph does.",
        ]),
      ]);
      expect(r.markdown).toBe(
        `# Page 1\n\nAttendees\n\nDana Lee\n\nNext steps for the crews\n\n${WIDE} how each of them planned the week ahead, in the yard, with paper.\n\nThis one ends without a full stop as somebody left it off here\n\nThe next paragraph starts with a capital letter and it goes on over more than one line, as a paragraph does.\n`,
      );
    });

    it("reads on where the next word would not have fitted, a capital or a number starting the line under it", async () => {
      // Each line holds as much as its width takes: the names and the number could not have gone on the line above.
      const r = await read([
        pdfLines([
          "The crews plan the week on Friday afternoon, in the yard, with a board that",
          "Priya Natarajan fills in by hand, and the office sees it on the Monday after",
          "Dana sends a photo of the board, which takes them about an hour of the work",
          "12 crews said they would keep, and which nobody in the office has asked for.",
        ]),
      ]);
      expect(r.markdown).toBe(
        "# Page 1\n\nThe crews plan the week on Friday afternoon, in the yard, with a board that Priya Natarajan fills in by hand, and the office sees it on the Monday after Dana sends a photo of the board, which takes them about an hour of the work 12 crews said they would keep, and which nobody in the office has asked for.\n",
      );
    });

    it("reads a paragraph on when every line starts with a capital, as a language's nouns may", async () => {
      const r = await read([
        pdfLines([
          "Die Kolonnen planen die Woche am Freitag im Hof mit einer grossen",
          "Tafel, die der Vorarbeiter von Hand ausfuellt, bevor alle Leute am",
          "Nachmittag gehen, und das Buero erfaehrt davon erst am naechsten",
          "Montag, wenn jemand ein Foto schickt.",
        ]),
      ]);
      expect(r.markdown).toBe(
        "# Page 1\n\nDie Kolonnen planen die Woche am Freitag im Hof mit einer grossen Tafel, die der Vorarbeiter von Hand ausfuellt, bevor alle Leute am Nachmittag gehen, und das Buero erfaehrt davon erst am naechsten Montag, wenn jemand ein Foto schickt.\n",
      );
    });

    it("parts lower case only where the line stops well short, and keeps a large figure with the words under it", async () => {
      const r = await read([
        [
          ...pdfLines(["Short closing note", "and a paragraph that opens with no capital at all, as notes often do, and", "goes on for long enough to wrap at the right edge of its column."]),
          { text: "87%", x: 72, y: 600, size: 30 },
          ...pdfLines(["of the crews said so"], { top: 570 }),
        ],
      ]);
      expect(r.markdown).toBe(
        "# Page 1\n\nShort closing note\n\nand a paragraph that opens with no capital at all, as notes often do, and goes on for long enough to wrap at the right edge of its column.\n\n87% of the crews said so\n",
      );
    });

    it("measures a quote set narrower than the text by its own lines", async () => {
      const r = await read([
        [
          ...pdfLines(["We asked the crews how the board is used, and the lead of the north yard said the", "same as most of the others, in nearly the same words as they had."], { top: 700 }),
          ...pdfLines(["The crews plan the week on a Friday, in the yard, with", "Dana filling in a paper board by hand, and keeping a", "Photo of it on the phone until the Monday."], { x: 108, top: 660 }),
          ...pdfLines(["A closing paragraph after the quote, which goes on for long enough that it wraps at", "the right edge of the column it is set in."], { top: 610 }),
        ],
      ]);
      expect(r.markdown).toBe(
        "# Page 1\n\nWe asked the crews how the board is used, and the lead of the north yard said the same as most of the others, in nearly the same words as they had.\n\nThe crews plan the week on a Friday, in the yard, with Dana filling in a paper board by hand, and keeping a Photo of it on the phone until the Monday.\n\nA closing paragraph after the quote, which goes on for long enough that it wraps at the right edge of the column it is set in.\n",
      );
    });

    it("parts a line as wide as its column from a capital under it by white space alone", async () => {
      const full = "A title that fills the whole line of its column and ends no sentence at all as it is";
      const under = "The crews plan the week on Friday afternoon, in the yard, with a paper board";
      const after = "that the lead fills in by hand before anyone leaves for the weekend.";
      const close = await read([pdfLines([full, under, after])]);
      expect(close.markdown).toBe(`# Page 1\n\n${full} ${under} ${after}\n`);
      const apart = await read([[...pdfLines([under, after], { top: 720 }), ...pdfLines([full], { top: 680 }), ...pdfLines([under, after], { top: 660 })]]);
      expect(apart.markdown).toBe(`# Page 1\n\n${under} ${after}\n\n${full}\n\n${under} ${after}\n`);
    });

    it("keeps every list item apart, and its wrapped lines with it", async () => {
      const bullets = await read([
        [
          ...pdfLines(["Three things came up again and again, in this order"], { top: 720 }),
          { text: "•", x: 72, y: 700 }, { text: "They use paper boards in the yard, which the lead fills in by hand before", x: 90, y: 700 },
          { text: "anyone leaves, and which nobody in the office sees", x: 90, y: 686 },
          { text: "•", x: 72, y: 672 }, { text: "They text photos", x: 90, y: 672 },
          ...pdfLines(["The office copies them out by hand, which takes it most of the morning."], { top: 650 }),
        ],
      ]);
      expect(bullets.markdown).toBe(
        "# Page 1\n\nThree things came up again and again, in this order\n\n• They use paper boards in the yard, which the lead fills in by hand before anyone leaves, and which nobody in the office sees\n\n• They text photos\n\nThe office copies them out by hand, which takes it most of the morning.\n",
      );
      for (const markers of [["1.", "2.", "3."], ["1)", "2)", "3)"], ["(a)", "(b)", "(c)"], ["i.", "ii.", "iii."], ["-", "-", "-"]]) {
        const items = await read([pdfLines([`${markers[0]} Vans leave the yard at seven`, `${markers[1]} Most jobs start by eight in the north`, `${markers[2]} Nobody calls it a crisis`])]);
        expect(items.segments.slice(1).map((g) => g.text), markers.join(" ")).toEqual([`${markers[0]} Vans leave the yard at seven`, `${markers[1]} Most jobs start by eight in the north`, `${markers[2]} Nobody calls it a crisis`]);
      }
      // A dash or a number at the start of a full line of prose goes on from the line above.
      const prose = await read([
        pdfLines([
          "The crews plan the week on Friday afternoon, in the yard, with a paper board that",
          "- as the lead put it - nobody else reads, and they counted the boards in the yard at",
          "12. Then the office was asked about them, and it had not seen any of the boards.",
        ]),
      ]);
      expect(prose.segments.slice(1)).toHaveLength(1);
    });

    it("reads the same whichever order two columns are drawn in, each with short lines of its own", async () => {
      const left = ["The crews plan the week on Friday, in", "the yard, with a paper board that the", "lead fills in by hand before they go.", "Observed on site", "The office keeps its own schedule in a"];
      const right = ["spreadsheet, which it updates from the", "photos. The two rarely agree for long,", "and the crews trust their board more.", "Open questions", "Who owns the board once the lead goes?"];
      const WANT =
        "# Page 1\n\nThe crews plan the week on Friday, in the yard, with a paper board that the lead fills in by hand before they go.\n\nObserved on site\n\n" +
        "The office keeps its own schedule in a spreadsheet, which it updates from the photos. The two rarely agree for long, and the crews trust their board more.\n\nOpen questions\n\nWho owns the board once the lead goes?\n";
      const down = await read([[...pdfLines(left), ...pdfLines(right, { x: 320 })]]);
      expect(down.markdown).toBe(WANT);
      expect(down.facts).toMatchObject({ table_count: 0 });
      const across = await read([left.flatMap((l, i) => [{ text: l, x: 72, y: 700 - i * 14 }, { text: right[i]!, x: 320, y: 700 - i * 14 }])]);
      expect(across.markdown).toBe(WANT);
      expect(across.facts).toMatchObject({ table_count: 0 });
    });

    it("reads a line each where it holds a table's numbers and no columns can be found", async () => {
      const rows = ["Lead 0.002 mg/L 0.01", "Copper dissolved in water 0.4", "Nitrate 2.1 mg/L per litre 10"];
      const r = await read([pdfLines(rows)]);
      expect(r.segments.slice(1).map((g) => g.text)).toEqual(rows);
    });

    it("reads a stamp up the margin as a line apart from the note beside it", async () => {
      const r = await read([[...pdfLines(["The text of the page goes here, as a sentence does."]), { text: "Sample", x: 500, y: 300, size: 9, turned: true }, { text: "Result", x: 514, y: 300, size: 9, turned: true }, { text: "Limit", x: 528, y: 300, size: 9, turned: true }]]);
      expect(r.segments.slice(1).map((g) => g.text)).toEqual(["The text of the page goes here, as a sentence does.", "Sample", "Result", "Limit"]);
    });

    const blocksOf = (runs: TextRun[]) => pageBlocks(layoutPage(runs, [], 0, 792), 1, new Map()).blocks.map((b) => b.text);
    const run = (text: string, x: number, y: number, width: number, rtl = false): TextRun => ({ text, x, y, width, size: 11, order: y === 0 ? 0 : 1000 - y, rtl });

    it("reads a line written from the right by where it stops on the left", () => {
      const lines = [run("אאאא בבבב גגגג דדדד הההה וווו זזזז חחחח", 72, 700, 468, true), run("טטטט ייי כככ", 400, 686, 140, true), run("לללל ממממ ננננ סססס עעעע פפפפ צצצצ קקקק", 72, 672, 468, true), run("רררר שששש תתתת.", 340, 658, 200, true)];
      expect(blocksOf(lines)).toEqual(["אאאא בבבב גגגג דדדד הההה וווו זזזז חחחח טטטט ייי כככ", "לללל ממממ ננננ סססס עעעע פפפפ צצצצ קקקק רררר שששש תתתת."]);
    });

    it("breaks writing without spaces between any two characters, so a short line stops its paragraph", () => {
      const lines = [run("各班は金曜日の午後に中庭で紙のボードを使って翌週の計画を立て", 72, 700, 330), run("班長が記入します", 72, 686, 88), run("参加者", 72, 672, 33), run("車両は七時に出発し、ほとんどの作業は八時に始まります。北部の", 72, 658, 330), run("長い作業は早く始まります。", 72, 644, 143)];
      expect(blocksOf(lines)).toEqual(["各班は金曜日の午後に中庭で紙のボードを使って翌週の計画を立て 班長が記入します", "参加者", "車両は七時に出発し、ほとんどの作業は八時に始まります。北部の 長い作業は早く始まります。"]);
    });

    it("says nothing of a line the file gives no width to, which goes on as it did", () => {
      expect(blocksOf([run("Attendees", 72, 700, 0), run("Dana Lee", 72, 686, 0), run("Sam Okafor went home.", 72, 672, 0)])).toEqual(["Attendees Dana Lee Sam Okafor went home."]);
    });

    it("keeps a word broken at the end of a line with its other half", async () => {
      const r = await read([pdfLines(["Pre-", "fabricated boards are what the crews said they wanted to keep, in the yard."])]);
      expect(r.segments.slice(1)).toHaveLength(1);
    });
  });

  describe("a table set tight", () => {
    const TIGHT = [["Sample", "Result", "Limit"], ["Lead", "0.002 mg/L", "0.01"], ["Copper", "0.4 mg/L", "1.3"], ["Nitrate", "2.1 mg/L", "10"]];
    const TIGHT_TABLE = "| Sample | Result | Limit |\n| --- | --- | --- |\n| Lead | 0.002 mg/L | 0.01 |\n| Copper | 0.4 mg/L | 1.3 |\n| Nitrate | 2.1 mg/L | 10 |";
    const read2 = async (pages: PdfRun[][], options: { tagged?: boolean } = {}) => {
      const r = await derive(makePdfPages(pages, options), "report.pdf");
      expect(r.status).toBe("ready");
      expectOffsetsExact(r);
      return r;
    };

    it("keeps its rows and columns at every gap, though pdf.js reads some of its cells as one run", async () => {
      // Below 0.6 of an em pdf.js holds two cells as one run, wherever a row's cells stand closest.
      for (const gap of [0.2, 0.3, 0.39, 0.41, 0.5, 0.59, 0.61, 0.8, 1, 2]) {
        const r = await read2([[...pdfLines(["Results by test:"], { top: 730 }), ...pdfTable(TIGHT, { gap, top: 710 }), ...pdfLines(["The results are within the limits."], { top: 640 })]]);
        expect(r.markdown, `gap ${gap}`).toBe(`# Page 1\n\nResults by test:\n\n${TIGHT_TABLE}\n\nThe results are within the limits.\n`);
        expect(r.facts, `gap ${gap}`).toMatchObject({ table_count: 1 });
      }
    });

    it("reads a table a tagged file parts cell by cell at gaps narrower than a word's", async () => {
      for (const gap of [0.18, 0.25, 0.35]) {
        const r = await read2([pdfTable(TIGHT, { gap })], { tagged: true });
        expect(r.markdown, `gap ${gap}`).toBe(`# Page 1\n\n${TIGHT_TABLE}\n`);
      }
    });

    it("finds a first row and rows the file reads whole, by the rows it parts", async () => {
      // The numbers are all one width, so nothing parts them, and the widths of the first column part only some rows.
      const rows = [["Week", "North", "South", "East"], ["W10", "12.50", "13.75", "14.00"], ["W11", "11.25", "12.00", "15.50"], ["W12", "10.75", "13.25", "16.00"], ["W13", "12.00", "14.50", "13.25"]];
      const WANT = "| Week | North | South | East |\n| --- | --- | --- | --- |\n| W10 | 12.50 | 13.75 | 14.00 |\n| W11 | 11.25 | 12.00 | 15.50 |\n| W12 | 10.75 | 13.25 | 16.00 |\n| W13 | 12.00 | 14.50 | 13.25 |";
      for (const right of [[], [1, 2, 3]]) {
        const r = await read2([pdfTable(rows, { gap: 0.25, right })]);
        expect(r.markdown, `right ${right}`).toBe(`# Page 1\n\n${WANT}\n`);
      }
    });

    it("sets a column of right-aligned numbers apart, whatever their widths, signs and currencies", async () => {
      const rows = [["Item", "Q1", "Q2", "Change"], ["Vans", "$1,200", "$1,450", "+20.8%"], ["Fuel", "$12,300", "$11,950", "-2.8%"], ["Boards", "$75", "$80", "+6.7%"], ["Total", "$13,575", "$13,480", "-0.7%"]];
      const r = await read2([pdfTable(rows, { gap: 0.3, right: [1, 2, 3] })]);
      expect(r.markdown).toBe("# Page 1\n\n| Item | Q1 | Q2 | Change |\n| --- | --- | --- | --- |\n| Vans | $1,200 | $1,450 | +20.8% |\n| Fuel | $12,300 | $11,950 | -2.8% |\n| Boards | $75 | $80 | +6.7% |\n| Total | $13,575 | $13,480 | -0.7% |\n");
    });

    it("keeps words of a cell together where another row parts its column", async () => {
      const rows = [["Crew", "Lead", "Region", "Plan day"], ["North yard", "Dana Lee", "North region", "Friday"], ["South depot", "Sam Okafor", "South region", "Thursday"], ["East gate", "Priya Nair", "East region", "Friday"], ["West dock", "Lee Tan", "West region", "Monday"]];
      const WANT = "# Page 1\n\n| Crew | Lead | Region | Plan day |\n| --- | --- | --- | --- |\n| North yard | Dana Lee | North region | Friday |\n| South depot | Sam Okafor | South region | Thursday |\n| East gate | Priya Nair | East region | Friday |\n| West dock | Lee Tan | West region | Monday |\n";
      expect((await read2([pdfTable(rows, { gap: 0.25 })])).markdown).toBe(WANT);
      expect((await read2([pdfTable(rows, { gap: 0.25 })], { tagged: true })).markdown).toBe(WANT);
    });

    it("joins a cell's wrapped line to its row, as a table set wider does", async () => {
      const at = (text: string, x: number, y: number): PdfRun => ({ text, x, y });
      const wide = pdfTextWidth("Pricing came up twice, and the team");
      const x1 = 72 + pdfTextWidth("Interview") + 2.5;
      const x2 = x1 + wide + 2.5;
      const r = await read2(
        [[at("Source", 72, 700), at("What we heard", x1, 700), at("Weight", x2, 700), at("Interview", 72, 686), at("Pricing came up twice, and the team", x1, 686), at("High", x2, 686), at("said it blocks the rollout", x1, 672), at("Survey", 72, 658), at("Mixed responses on the price", x1, 658), at("Low", x2, 658), at("Visit", 72, 644), at("Crews asked about the price", x1, 644), at("Medium", x2, 644)]],
        { tagged: true },
      );
      expect(r.markdown).toBe("# Page 1\n\n| Source | What we heard | Weight |\n| --- | --- | --- |\n| Interview | Pricing came up twice, and the team said it blocks the rollout | High |\n| Survey | Mixed responses on the price | Low |\n| Visit | Crews asked about the price | Medium |\n");
    });

    it("leaves out of a table a title above it and a line of text under it, though their words may stand in its columns", async () => {
      const r = await read2([[...pdfLines(["Table 1 Results by test in the north yard"], { top: 714 }), ...pdfTable(TIGHT, { gap: 0.25 }), ...pdfLines(["Source: the crews", "The note under the table has no full stop"], { top: 644 })]]);
      expect(r.markdown).toBe(`# Page 1\n\nTable 1 Results by test in the north yard\n\n${TIGHT_TABLE}\n\nSource: the crews\n\nThe note under the table has no full stop\n`);
    });

    it("reads a number set in thousands as one number, and a form set tight as a form", async () => {
      const r = await read2([pdfTable([["Region", "Jobs"], ["North", "12 500"], ["South", "9 750"], ["East", "11 200"]], { gap: 0.3, right: [1] })]);
      expect(r.markdown).toBe("# Page 1\n\n| Region | Jobs |\n| --- | --- |\n| North | 12 500 |\n| South | 9 750 |\n| East | 11 200 |\n");
      const form = await read2([pdfTable([["Client:", "Example Co."], ["Sample ID:", "S-0001"], ["Received:", "2026-03-01"]], { gap: 0.25 })], { tagged: true });
      expect(form.markdown).toBe("# Page 1\n\nClient: Example Co.\n\nSample ID: S-0001\n\nReceived: 2026-03-01\n");
      expect(form.facts).toMatchObject({ table_count: 0 });
    });

    it("reads rows a line each where nothing shows their columns, claiming no table", async () => {
      // Words only, each row one run: no gap parts them, and no number does.
      const rows = [["Dana", "Lead", "North"], ["Samir", "Crew", "South"], ["Kai", "Crew", "North"], ["Lee", "Lead", "South"]];
      const r = await read2([rows.map((row, i) => ({ text: row.join(" "), x: 72, y: 700 - i * 14 }))]);
      expect(r.segments.slice(1).map((g) => g.text)).toEqual(rows.map((row) => row.join(" ")));
      expect(r.facts).toMatchObject({ table_count: 0 });
      // Numbers after names of different widths stand nowhere near one another.
      const names = await read2([pdfLines(["Dana Lee 34", "Sam Okafor 28", "Priya Nair 41"])]);
      expect(names.segments.slice(1).map((g) => g.text)).toEqual(["Dana Lee 34", "Sam Okafor 28", "Priya Nair 41"]);
      expect(names.facts).toMatchObject({ table_count: 0 });
    });

    it("keeps prose prose: words in other fonts, parted runs, numbers, a list with its markers set close", async () => {
      // A word in another font is another run; a run breaks inside a word at a ligature, as browsers' files do.
      const lines = ["The crews plan the week on Friday afternoon, in the yard, with a paper", "board that 12 of them fill in by hand before anyone leaves for the weekend,", "and that 7 of the leads keep a photo of on the phone until Monday morning,", "when 21 of them text it to the office, which copies it out into a sheet."];
      const parted = lines.flatMap((l, i): PdfRun[] => {
        const y = 700 - i * 14;
        const words = l.split(" ");
        const cut = 2 + i * 3;
        const head = words.slice(0, cut).join(" ");
        const tail = words.slice(cut).join(" ");
        return [{ text: head, x: 72, y }, { text: tail, x: 72 + pdfTextWidth(head) + 3, y, bold: true }];
      });
      const r = await read2([parted]);
      expect(r.facts).toMatchObject({ table_count: 0 });
      expect(r.segments.slice(1)).toHaveLength(1);
      const ligature = (y: number, a: string, b: string, c: string): PdfRun[] => [{ text: a, x: 72, y }, { text: b, x: 72 + pdfTextWidth(a), y }, { text: c, x: 72 + pdfTextWidth(a + b), y }];
      const words = await read2([[...ligature(700, "The crew leads said the of", "fi", "ce rarely knew the plan until Monday,"), ...ligature(686, "and the of", "fi", "ce copied it out by hand into a sheet."), ...ligature(672, "Then the of", "fi", "ce read it.")]], { tagged: true });
      expect(words.markdown).toBe("# Page 1\n\nThe crew leads said the office rarely knew the plan until Monday, and the office copied it out by hand into a sheet.\n\nThen the office read it.\n");
      const list = await read2([["1.", "2.", "3."].flatMap((n, i): PdfRun[] => [{ text: n, x: 72, y: 700 - i * 14 }, { text: ["Vans leave the yard at seven", "Most jobs start by eight", "Nobody calls it a crisis"][i]!, x: 72 + pdfTextWidth(n) + 3, y: 700 - i * 14 }])], { tagged: true });
      expect(list.segments.slice(1).map((g) => g.text)).toEqual(["1. Vans leave the yard at seven", "2. Most jobs start by eight", "3. Nobody calls it a crisis"]);
      expect(list.facts).toMatchObject({ table_count: 0 });
    });

    it("reads as it did a table whose columns are plain to see, a word of a cell in another font and all", async () => {
      const r = await read2([
        [
          { text: "Source", x: 72, y: 700 }, { text: "What we heard", x: 170, y: 700 }, { text: "Weight", x: 430, y: 700 },
          { text: "Interview", x: 72, y: 686 }, { text: "Pricing", x: 170, y: 686, bold: true }, { text: "came up twice", x: 170 + pdfTextWidth("Pricing") + 7, y: 686 }, { text: "High", x: 430, y: 686 },
          { text: "Survey", x: 72, y: 672 }, { text: "Mixed", x: 170, y: 672 }, { text: "Low", x: 430, y: 672 },
        ],
      ]);
      expect(r.markdown).toBe("# Page 1\n\n| Source | What we heard | Weight |\n| --- | --- | --- |\n| Interview | Pricing came up twice | High |\n| Survey | Mixed | Low |\n");
    });

    it("reads no table from text written down the page, whose characters stand in columns", () => {
      const runs: TextRun[] = [];
      for (const [i, y] of [700, 688, 676, 664].entries()) for (const [j, x] of [100, 113, 126, 139].entries()) runs.push({ text: String.fromCodePoint(0x4e00 + i * 4 + j), x, y, width: 11, size: 11, order: i * 4 + j, rtl: false });
      expect(layoutPage(runs, [], 0, 792).lines.some((l) => l.table)).toBe(false);
    });
  });

  it("reads a page whose text is turned a quarter turn as it reads upright", async () => {
    // A landscape table drawn up the page: each line's baseline runs up, and its lines stand left to right.
    const turned = results.flatMap((r, i) => r.map((text, j): PdfRun => ({ text, x: 100 + i * 16, y: 100 + columns[j]!, turned: true })));
    const r = await read([turned]);
    expect(r.markdown).toBe(`# Page 1\n\n${TABLE}\n`);
  });
});

describe("recording duration", () => {
  it("reads an M4A's mvhd, before or after the media data, in version 0 or 1", async () => {
    const late = await derive(makeMp4({ timescale: 44100, duration: 44100 * 147 + 11025 }), "call.m4a");
    expect(late).toMatchObject({ status: "needs_transcript", duration_ms: 147250, segments: [] });
    expect((await derive(makeMp4({ timescale: 1000, duration: 2 ** 33, version: 1, fastStart: true }), "long.mp4")).duration_ms).toBe(2 ** 33);
  });

  it("finds a late moov without reading the media data", async () => {
    const bytes = makeMp4({ timescale: 600, duration: 600 * 90, mdatBytes: 5_000_000 });
    let read = 0;
    const ms = await recordingDurationMs(async (s, e) => {
      const b = await bytesReader(bytes)(s, e);
      read += b.byteLength;
      return b;
    }, bytes.byteLength);
    expect(ms).toBe(90_000);
    expect(read).toBeLessThan(200);
  });

  it("reads WAV, FLAC, and constant and variable bitrate MP3", async () => {
    expect((await derive(makeWav(32_000, 16_000), "room.wav")).duration_ms).toBe(2000);
    expect((await derive(makeFlac(44_100, 441_000), "room.flac")).duration_ms).toBe(10_000);
    expect((await derive(makeMp3(100), "memo.mp3")).duration_ms).toBe(2606);
    expect((await derive(makeMp3(3, 1000), "memo.mp3")).duration_ms).toBe(26_122);
  });

  it("gives no duration for a container it cannot read", async () => {
    expect((await derive(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), "call.m4a")).duration_ms).toBeNull();
    expect((await derive(utf8("OggS and more bytes than that"), "call.ogg")).duration_ms).toBeNull();
    expect((await derive(makeMp4({ timescale: 0, duration: 10 }), "call.m4a")).duration_ms).toBeNull();
  });
});

describe("statuses", () => {
  it("marks recordings as needing a transcript", async () => {
    const r = await derive(new Uint8Array(10), "call.m4a");
    expect(r.status).toBe("needs_transcript");
    expect(r.duration_ms).toBeNull();
  });
  it("marks unknown formats unsupported", async () => {
    const r = await derive(new Uint8Array(10), "slides.pptx");
    expect(r.status).toBe("unsupported");
    expect(r.status_detail).toBe("no parser reads .pptx files");
  });
  it("marks an image unsupported, saying how an agent gives it its words", async () => {
    for (const [name, type] of [["board.png", null], ["photo", "image/jpeg"]] as const) {
      expect(await derive(new Uint8Array(10), name, { mediaType: type })).toMatchObject({ status: "unsupported", status_detail: IMAGE_DETAIL });
    }
    expect(IMAGE_DETAIL).toMatch(/^WhatBuild reads no words from an image, as it performs no OCR; an agent that can see it should describe it in the source's summary/);
  });
  it("marks oversized files too large without parsing", async () => {
    const r = await derive(new Uint8Array(11), "a.txt", { parseCapBytes: 10 });
    expect(r.status).toBe("too_large");
    expect(r.status_detail).toBe("the file is 11 bytes; files over 10 bytes are stored but not read");
  });
  it("says from a file's name, type and size alone what its reading will find, when they settle it", async () => {
    const settled = (name: string, size: number, mediaType?: string) => settledReading(name, { mediaType, size, parseCapBytes: 100 });
    expect(settled("call.m4a", 50)).toEqual({ status: "needs_transcript", status_detail: RECORDING_DETAIL });
    expect(settled("board.png", 50)).toEqual({ status: "unsupported", status_detail: IMAGE_DETAIL });
    expect(settled("deck.key", 50)).toEqual({ status: "unsupported", status_detail: "no parser reads .key files" });
    // Too large first, as a reading finds it, whatever the format.
    expect(settled("board.png", 101)).toEqual({ status: "too_large", status_detail: "the file is 101 bytes; files over 100 bytes are stored but not read" });
    // Only the bytes say how a readable format reads.
    expect(settled("notes.txt", 50)).toBeUndefined();
    expect(settled("scan.pdf", 50)).toBeUndefined();
    expect(settled("export", 50, "text/csv")).toBeUndefined();
    // And the reading says the same.
    for (const name of ["call.m4a", "board.png", "deck.key"]) {
      const r = await derive(new Uint8Array(50), name, { parseCapBytes: 100 });
      expect({ status: r.status, status_detail: r.status_detail }).toEqual(settled(name, 50));
    }
  });
  it("says a reading an earlier version made as this one would", () => {
    expect(currentReading("needs_transcript", "a recording is stored and playable but has no text; add a transcript as a new source")).toEqual({ status: "needs_transcript", status_detail: RECORDING_DETAIL });
    expect(currentReading("failed", "the PDF has no text layer (a scan?); no OCR is performed")).toEqual({ status: "unsupported", status_detail: SCAN_DETAIL });
    expect(currentReading("unsupported", "no parser reads .png files")).toEqual({ status: "unsupported", status_detail: IMAGE_DETAIL });
    // Anything else is said as it was.
    expect(currentReading("unsupported", "no parser reads .key files")).toEqual({ status: "unsupported", status_detail: "no parser reads .key files" });
    expect(currentReading("failed", "Error: bad XRef entry")).toEqual({ status: "failed", status_detail: "Error: bad XRef entry" });
    expect(currentReading("ready", null)).toEqual({ status: "ready", status_detail: null });
  });
});

describe("null characters", () => {
  it("drops U+0000, which Postgres text cannot hold, and says in the facts how many", async () => {
    const txt = await derive(utf8("Crews plan\u0000 the week\u0000 on Friday.\n"), "notes.txt");
    expect(txt).toMatchObject({ status: "ready", markdown: "Crews plan the week on Friday.\n", facts: { null_characters_dropped: 2 } });
    expect(txt.text).not.toContain("\u0000");
    expectOffsetsExact(txt);
    // A Markdown file keeps its own text, without them.
    const md = await derive(utf8("# Visit\n\nCrews\u0000 plan the week.\n"), "visit.md");
    expect(md).toMatchObject({ status: "ready", parser_version: "5", markdown: "# Visit\n\nCrews plan the week.\n", facts: { null_characters_dropped: 1 } });
    // A table's cell is counted once, though its row repeats it.
    const csv = await derive(utf8("Item,Cost\nVans\u0000,1200\n"), "costs.csv");
    expect(csv).toMatchObject({ status: "ready", parser_version: "4", markdown: "| Row | Item | Cost |\n| --- | --- | --- |\n| 2 | Vans | 1200 |\n", facts: { null_characters_dropped: 1 } });
    for (const r of [txt, md, csv]) expect(JSON.stringify(r)).not.toContain("\\u0000");
    // A file without one says nothing of them.
    expect((await derive(utf8("Crews plan the week.\n"), "notes.txt")).facts).not.toHaveProperty("null_characters_dropped");
  });

  it("fails a text file that is almost all null characters, as one whose parse kept almost nothing", async () => {
    const r = await derive(new Uint8Array(4096).map((_, i) => (i % 64 === 0 ? 0x41 : 0)), "dump.txt");
    expect(r).toMatchObject({ status: "failed", status_detail: "the parse kept only 64 of 4096 characters", facts: { null_characters_dropped: 4032 } });
  });
});

describe("the readable text", () => {
  it("runs a speaker's cues on as one turn, with who spoke and when", async () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Dana>We export everything\n\n00:00:03.000 --> 00:00:05.000\n<v Dana>to a spreadsheet every Friday.\n\n00:00:05.000 --> 00:00:07.000\n<v Sam>Why Friday?\n\n01:02:03.000 --> 01:02:05.000\nNobody named.\n";
    const r = await derive(utf8(vtt), "call.vtt");
    expect(r.markdown).toBe("**Dana** (0:01): We export everything to a spreadsheet every Friday.\n\n**Sam** (0:05): Why Friday?\n\n(1:02:03) Nobody named.\n");
  });

  it("names a transcript's speaker once per turn, not on every paragraph of it", async () => {
    const txt = "Dana: We plan on Fridays.\nSam: Why?\nDana: The numbers close then.\nSam: Who decides?\nDana: The ops lead.\n";
    const r = await derive(utf8(txt), "interview.txt");
    expect(r.markdown).toBe("**Dana:** We plan on Fridays.\n\n**Sam:** Why?\n\n**Dana:** The numbers close then.\n\n**Sam:** Who decides?\n\n**Dana:** The ops lead.\n");
    expect(r.markdown.split("\n\n").length).toBe(r.segments.length);
  });

  it("keeps headings and lays a table out whole", async () => {
    const html = "<h1>Plan</h1><p>Two plans were tried.</p><table><tr><th>Plan</th><th>Reached | saved</th></tr><tr><td>A</td><td>4 of 5</td></tr><tr><td>B</td><td>0 of 5</td></tr></table>";
    const r = await derive(utf8(html), "plans.html");
    expect(r.markdown).toBe("# Plan\n\nTwo plans were tried.\n\n| Plan | Reached \\| saved |\n| --- | --- |\n| A | 4 of 5 |\n| B | 0 of 5 |\n");
  });

  it("lays a spreadsheet out as a table numbered by its rows", async () => {
    const r = await derive(utf8("Quarterly crews\nName,Crew\nDana,North\nSam,\n"), "crews.csv");
    expect(r.markdown).toBe("[row 1] Quarterly crews\n\n| Row | Name | Crew |\n| --- | --- | --- |\n| 3 | Dana | North |\n| 4 | Sam |  |\n");
  });

  it("keeps a plain-text file's lines as its author broke them", async () => {
    const txt =
      "Meeting recorder export\r\nCall: Crew lead interview, Example Co\r\nRecorded: 14 August 2026, 2 minutes\r\n\r\n" +
      "Attendees\nDana Lee\nSam Ortiz\n\ncall dana\nsend price sheet\n\n" +
      "Crews text the office every morning to say which jobs they will reach today.\nThe office copies the messages into a spreadsheet by hand.\nNobody called it a crisis.\n";
    const r = await derive(utf8(txt), "notes.txt");
    expect(r.parser_version).toBe("8");
    // Each line stays a line: a Markdown hard break, two spaces before the line end.
    expect(r.markdown).toBe(
      "Meeting recorder export  \nCall: Crew lead interview, Example Co  \nRecorded: 14 August 2026, 2 minutes\n\n" +
        "Attendees  \nDana Lee  \nSam Ortiz\n\ncall dana  \nsend price sheet\n\n" +
        "Crews text the office every morning to say which jobs they will reach today.  \nThe office copies the messages into a spreadsheet by hand.  \nNobody called it a crisis.\n",
    );
    expectOffsetsExact(r);
  });

  it("keeps list markers: Markdown's bullets and numbers as lists, nested as indented, other bullets as written", async () => {
    const txt = [
      "Steps",
      "1. Plan the week",
      "2. Text the crews",
      "",
      "1) Call the depot",
      "2) Book the van",
      "",
      "- Scheduling",
      "  - double bookings",
      "      - on Mondays",
      "  - wrong addresses",
      "* Pricing",
      "Thanks, Sam",
      "",
      "Observations",
      "• Crews text the office",
      "– Nobody called it a crisis",
      "☐ Ask about gate codes",
      "•\tScheduling",
      "o\tdouble bookings",
    ].join("\n");
    const r = await derive(utf8(txt), "visit.txt");
    expect(r.markdown).toBe(
      "Steps\n1. Plan the week\n2. Text the crews\n\n1) Call the depot\n2) Book the van\n\n" +
        // A list ends where an unindented line follows it, so that line is not taken into its last item.
        "- Scheduling\n  - double bookings\n    - on Mondays\n  - wrong addresses\n* Pricing\n\nThanks, Sam\n\n" +
        "Observations  \n• Crews text the office  \n– Nobody called it a crisis  \n☐ Ask about gate codes  \n• Scheduling  \no double bookings\n",
    );
    // A numbered line inside a paragraph is not a list Markdown would start there, and stays a line.
    expect((await derive(utf8("The year was\n2019. It stayed a line.\n"), "a.txt")).markdown).toBe("The year was  \n2019. It stayed a line.\n");
    expectOffsetsExact(r);
  });

  it("opens a list under a line that ends in a colon, whatever number it starts at", async () => {
    const laid = async (txt: string) => (await derive(utf8(txt), "notes.txt")).markdown;
    // Markdown lets only a list numbered 1 interrupt a paragraph: the list is set apart by a blank line.
    expect(await laid("Dispatcher:\n3. Call the depot\n4. Book the van\n5. Text the crews\n")).toBe("Dispatcher:\n\n3. Call the depot\n4. Book the van\n5. Text the crews\n");
    expect(await laid("Visit notes\nDispatcher:\n3. Call the depot\n4. Book the van\nThanks, Sam\n")).toBe(
      "Visit notes  \nDispatcher:\n\n3. Call the depot\n4. Book the van\n\nThanks, Sam\n",
    );
    expect(await laid("Next steps:\n1. Call the depot\n2. Book the van\n")).toBe("Next steps:\n\n1. Call the depot\n2. Book the van\n");
    expect(await laid("Dispatcher:\n- Call the depot\n- Book the van\n")).toBe("Dispatcher:\n\n- Call the depot\n- Book the van\n");
    // A bullet Markdown does not read stays a line, as written.
    expect(await laid("Dispatcher:\n• Call the depot\n• Book the van\n")).toBe("Dispatcher:  \n• Call the depot  \n• Book the van\n");
    // A speaker's words that end in a colon open the list in the turn.
    const turns = await derive(utf8("Dana: Here is the plan:\n3. Call the depot\n4. Book the van\nSam: Fine.\nDana: Good.\nSam: Done.\n"), "call.txt");
    expect(turns.markdown).toBe("**Dana:** Here is the plan:\n\n3. Call the depot\n4. Book the van\n\n**Sam:** Fine.\n\n**Dana:** Good.\n\n**Sam:** Done.\n");
  });

  it("keeps a numbered line under a sentence that ends in a colon a line, unless the next line numbers on", async () => {
    const laid = async (txt: string) => (await derive(utf8(txt), "notes.txt")).markdown;
    expect(await laid("The count on the day was:\n2019. That was the year the vans came.\n")).toBe("The count on the day was:  \n2019. That was the year the vans came.\n");
    // Numbers that do not run on are not a list, which Markdown would number 2019, 2020.
    expect(await laid("We met twice:\n2019. The first visit.\n2021. The second visit.\n")).toBe("We met twice:  \n2019. The first visit.  \n2021. The second visit.\n");
    // Notes whose lines end in colons keep their lines.
    expect(await laid("Visit notes:\ncall dana\nsend price sheet\nNext:\nbook the van\nTotal:\n12 vans\n")).toBe(
      "Visit notes:  \ncall dana  \nsend price sheet  \nNext:  \nbook the van  \nTotal:  \n12 vans\n",
    );
  });

  it("reflows hard-wrapped prose, and joins a line that wraps a sentence onto the next", async () => {
    const wrapped = [
      "Hi team, following up on the call with Dana from Example Co yesterday. She",
      "said the crews plan by the week, and that the Friday export is the part",
      "that hurts. I asked whether they had tried the scheduling tool again and",
      "she said no. Next steps: send her the price sheet and book a follow-up",
      "for October.",
    ].join("\n");
    const r = await derive(utf8(wrapped + "\n"), "email.txt");
    expect(r.markdown).toBe(wrapped.replace(/\n/g, " ") + "\n");
    // An item wrapped onto an indented line reads as one item.
    const items = await derive(utf8("- Crews text the office every morning to say which jobs they will reach\n  today, and the office copies them.\n- Nobody called it a crisis.\n"), "items.txt");
    expect(items.markdown).toBe("- Crews text the office every morning to say which jobs they will reach today, and the office copies them.\n- Nobody called it a crisis.\n");
    expect(wraps("Crews text the office every morning to say which jobs they", "will reach today.", 60)).toBe(true);
    // Not after a sentence's end or before a capital, and never in a paragraph of short lines.
    expect(wraps("Crews text the office every morning to say which jobs.", "will reach today.", 60)).toBe(false);
    expect(wraps("Crews text the office every morning to say which jobs they", "Will reach today.", 60)).toBe(false);
    expect(wraps("call dana", "send price sheet", 16)).toBe(false);
    // Nor where the next line's first word would have fitted on the line: that break was the author's.
    expect(wraps("Crews text the office", "every morning", 60)).toBe(false);
  });

  it("keeps notes and a log's lines as written, however their lengths fall, and joins only prose", async () => {
    const laid = async (lines: string[]) => (await derive(utf8(lines.join("\n") + "\n"), "notes.txt")).markdown;
    const asWritten = (lines: string[]) => lines.join("  \n") + "\n";
    // A line that starts with a label is a line of its own, as in a log.
    const log = ["error: could not reach the depot printer (retrying in 5s)", "warning: the van checklist was not synced before the crews left"];
    expect(await laid(log)).toBe(asWritten(log));
    expect(wraps("The printer at the depot could not be reached this morning and the", "warning: the van checklist was not synced.", 70)).toBe(false);
    // Notes end no sentence, so the longest line is not taken for a wrap onto the next.
    const notes = ["call the depot about the van checklist", "ask dana whether the crews can start at the yard at six", "send sam the price sheet and the revised schedule today"];
    expect(await laid(notes)).toBe(asWritten(notes));
    // Nor when the last ends with a full stop, as a break before it is no wrap.
    const stopped = [...notes.slice(0, 2), `${notes[2]}.`];
    expect(await laid(stopped)).toBe(asWritten(stopped));
    // One sentence that wraps at every break is prose, and joins.
    expect(await laid(["Let me know if you have any questions about the schedule or the price", "sheet for the north crews."])).toBe(
      "Let me know if you have any questions about the schedule or the price sheet for the north crews.\n",
    );
  });

  it("keeps rules and underlines on their own, and a marker alone as itself", async () => {
    const r = await derive(utf8("Notes\n=====\nWe met Dana.\n-\nNext\n-----\nEnd\n#\n"), "a.txt");
    expect(r.markdown).toBe("Notes\n\n=====\n\nWe met Dana.\n\n\\-\n\nNext\n\n-----\n\nEnd  \n\\#\n");
  });

  it("ends a quoted message before the reply under it, as a list ends before the line after it", async () => {
    const r = await derive(utf8("On Monday, Dana wrote:\n> We plan by the week.\n> Crews text the office.\nThanks, noted.\n"), "reply.txt");
    // Without the blank line, Markdown would read the reply into the quote.
    expect(r.markdown).toBe("On Monday, Dana wrote:  \n> We plan by the week.  \n> Crews text the office.\n\nThanks, noted.\n");
  });

  it("never joins a quoted line to the line after it or before it, whatever its case", async () => {
    const quote = [
      "> We plan by the week, and the crews text the office every morning.",
      "> They say which jobs they will reach, and we start in the spring",
      "> once the vans are back from the depot and the yard is ready for spring",
    ];
    // A reply in lower case under the longest quoted line looks like a wrap, but is not one.
    const reply = await derive(utf8([...quote, "thanks, that is great news for the whole team.", ""].join("\n")), "reply.txt");
    expect(reply.markdown).toBe(`${quote.join("  \n")}\n\nthanks, that is great news for the whole team.\n`);
    // Nor is a quote under hard-wrapped prose taken into it.
    const prose = [
      "Dana wrote back this morning about the crews and the schedule, and what",
      "she said about the vans and the depot is worth keeping in mind before we",
      "plan the spring, since the crews will want to know where the vans are and",
      "when the yard opens again. Here it is, as she wrote it to the crews today",
    ];
    const above = await derive(utf8([...prose, "> the vans are back from the depot in March, and the yard opens then", ""].join("\n")), "above.txt");
    expect(above.markdown).toBe(`${prose.join(" ")}  \n> the vans are back from the depot in March, and the yard opens then\n`);
  });

  it("puts a speaker's label above a list in a transcript of timed labels", async () => {
    const txt = "Dana (14:02 UTC):\nPlan the week first.\nThen the crews.\n\nSam (14:03 UTC):\n- Week plan drafted\n- Crews next\n\nDana (14:05 UTC):\nGood.\n\nSam (14:09 UTC):\nDone.\n";
    const r = await derive(utf8(txt), "session.txt");
    expect(r.markdown).toBe("**Dana:** Plan the week first.  \nThen the crews.\n\n**Sam:**\n\n- Week plan drafted\n- Crews next\n\n**Dana:** Good.\n\n**Sam:** Done.\n");
    expect(r.segments.filter((s) => s.speaker).map((s) => s.speaker)).toEqual(["Dana", "Sam", "Dana", "Sam"]);
    // A list that starts at 3 cannot interrupt a paragraph in Markdown: the label is a paragraph of its own.
    const numbered = await derive(utf8(txt.replace("- Week plan drafted\n- Crews next", "3. Week plan drafted\n4. Crews next")), "session.txt");
    expect(numbered.markdown).toContain("**Sam:**\n\n3. Week plan drafted\n4. Crews next\n\n**Dana:** Good.");
  });

  it("keeps a Markdown file as it was written", async () => {
    const md = "# Plan\r\n\r\n**Dana:** We *always* plan on Fridays.\r\n\r\n| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\n";
    const r = await derive(utf8(md), "plan.md");
    expect(r.markdown).toBe("# Plan\n\n**Dana:** We *always* plan on Fridays.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
  });

  it("says a time the way people write it", () => {
    expect([0, 5_000, 65_000, 3_599_000, 3_723_000].map(clock)).toEqual(["0:00", "0:05", "1:05", "59:59", "1:02:03"]);
  });
});
