import { findCount, findPattern, findWords } from "@whatbuild/core/find-in-text";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/lib/markdown.tsx";

// Plain search counts a source's matches as its Find in the text marks them (core's findCount), so
// "N matches" on a result and the find's "1 of N" agree. The count follows this renderer: these
// texts hold what makes the shown words differ from the written ones.

const marks = (source: string, pattern: RegExp) => renderToStaticMarkup(<Markdown source={source} className="prose source-text" headingShift={1} mark={pattern} />).match(/<mark class="text-find">/g)?.length ?? 0;

const TEXTS = [
  "The crew lead texts the crew. Crews plan by the job, and crewing is hard.",
  "# Crew plans\n\n**Dana** (0:05): The crew message goes out at six.  \nThe crew\nmessage is read at noon.",
  "- The crew message\n- crew\n  message\n- [x] crew checked\n\n> The crew\n> message, quoted.",
  "See [the crew page](https://example.com/crew/message) and ![crew photo](crew.png), or https://example.com/crew today.",
  "<b>crew</b> and <span title='crew'>message</span>, &amp; the crew&#39;s message; \\*crew\\* too.",
  "```crew\nthe crew message, in code\n```\n\n~~~crew\nmore crew\n~~~\n\n    indented crew message",
  "| Crew | Message |\n|---|---|\n| crew lead | crew message |\n| **crew** | message |",
  "pre**crew**s and **cr**ew and crew_message and my_crew, then _crew message_.",
  "Ticket CB26-20734 for the crane; 2026-05-01 again; tickets 20734 and cb26.",
  "<!-- crew note -->\n\n<div>crew message</div>\n\n<script>crew()</script>",
  "Pricing: prices were priced, and repricing is not. The PRICE list.",
];

describe("counting what a find marks", () => {
  it("comes to the marks the text's Markdown draws, for words, phrases and ids", () => {
    const finds = ["crew", "crew message", '"crew message"', '"the crew"', "crew lead", "message", "cb26-20734", "20734", "pricing", '"crew lead" message'];
    for (const text of TEXTS)
      for (const find of finds) {
        const pattern = findPattern(find)!;
        expect(findCount(text, pattern), `${find} in ${JSON.stringify(text)}`).toBe(marks(text, pattern));
      }
  });

  it("takes the words a plain search read, phrases in quotes, as the web app links them", () => {
    expect(findWords([{ text: "crew", phrase: false }, { text: "crew message", phrase: true }])).toBe('crew "crew message"');
  });
});
