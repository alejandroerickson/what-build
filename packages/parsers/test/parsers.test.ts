import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { derive, recordingDurationMs, sliceCodePoints, type ParseResult } from "../src/index.ts";
import { bytesReader } from "../src/media.ts";
import { splitLong } from "../src/text.ts";
import { stripInlineMarkdown } from "../src/plaintext.ts";
import { dateFormatOf } from "../src/xlsx.ts";
import { makeDocx, makeDocxList, makeDocxParagraphs, makeFlac, makeMp3, makeMp4, makePdf, makeWav, makeXlsx, makeXlsxSheet, utf8 } from "./fixtures.ts";
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

  it("splits plain-text bullets too", async () => {
    const r = await derive(utf8("Follow-ups:\n- call Dana\n- send the price sheet\n"), "note.txt");
    expect(r.segments.map((s) => s.text)).toEqual(["Follow-ups:", "call Dana", "send the price sheet"]);
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
    expect(withTitle.outline).toBe("- # Planning notes (segment 0)\n  - ## Agenda (segment 1)\n    - ### Item (segment 2)\n");
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
    expect(r.outline).toContain("Why crews call the office");
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
    expect(r.parser_version).toBe("2");
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
    expect(r.parser_version).toBe("4");
  });

  it("renders numbers in date and time formats as ISO dates and times, and other numbers as numbers", async () => {
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
      "[Register, row 2] Permit: EL 101 | Granted: 2019-04-10 | Expiry: 2026-04-10 | Checked: 2026-02-02 12:00 | Meeting: 13:30 | Lead time: 12.5 | Logged: 30:00:00 | Renewed: 2026-03-05 | Share: 0.25",
      "[Register, row 3] Permit: EL 102 | Granted: 1900-01-01 | Expiry: 1900-02-29 | Checked: 1900-03-01 | Meeting: -3 | Lead time: 0.5 | Logged: 2026-04-10 | Renewed: 45000 | Share: 2023-01-01 18:00:00",
    ]);
  });

  it("counts dates from 1904 when the workbook uses the 1904 date system", async () => {
    const r = await derive(makeXlsxSheet([["Permit", "Expiry"], ["EL 101", [44660, 1]], ["EL 102", [0, 1]]], { numFmts: ["yyyy-mm-dd"], xfs: [0, 164], date1904: true }), "register.xlsx");
    expect(r.segments.slice(2).map((s) => s.text)).toEqual(["[Register, row 2] Permit: EL 101 | Expiry: 2026-04-10", "[Register, row 3] Permit: EL 102 | Expiry: 1904-01-01"]);
  });

  it("tells date formats from number formats", () => {
    expect(dateFormatOf("General")).toBeUndefined();
    expect(dateFormatOf("#,##0.00")).toBeUndefined();
    expect(dateFormatOf('0" days"')).toBeUndefined();
    expect(dateFormatOf("0.00E+00")).toBeUndefined();
    expect(dateFormatOf("[Red]0.0%")).toBeUndefined();
    expect(dateFormatOf("_-* #,##0_-;-* #,##0_-")).toBeUndefined();
    expect(dateFormatOf("mmm-yy")).toMatchObject({ date: true, time: false });
    expect(dateFormatOf("h:mm AM/PM")).toMatchObject({ date: false, time: true, seconds: false });
    expect(dateFormatOf("mm:ss")).toMatchObject({ date: false, time: true, seconds: true });
    expect(dateFormatOf('yyyy-mm-dd"T"hh:mm')).toMatchObject({ date: true, time: true, seconds: false });
    expect(dateFormatOf("[h]:mm")).toMatchObject({ elapsed: "h" });
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
    expect(r.status_detail).toContain(".pptx");
  });
  it("marks oversized files too large without parsing", async () => {
    const r = await derive(new Uint8Array(11), "a.txt", { parseCapBytes: 10 });
    expect(r.status).toBe("too_large");
  });
});
