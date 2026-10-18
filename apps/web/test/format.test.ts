import { describe, expect, it } from "vitest";
import { fileTypeName, nestQuotes, quotedAtEnd, untilTime } from "../src/lib/format.ts";

describe("untilTime", () => {
  const now = Date.parse("2026-09-29T10:00:00Z");
  it("says how long until a moment, coarsely", () => {
    expect(untilTime("2026-09-29T10:00:20Z", now)).toBe("in a moment");
    expect(untilTime("2026-09-29T10:25:00Z", now)).toBe("in 25 min");
    expect(untilTime("2026-09-29T15:10:00Z", now)).toBe("in 5 h");
    expect(untilTime("2026-10-02T10:00:00Z", now)).toBe("in 3 d");
    expect(untilTime(null, now)).toBe("—");
  });
});

describe("nestQuotes", () => {
  it("leaves text without quotation marks alone", () => {
    expect(nestQuotes("Two hours if nothing's weird.")).toBe("Two hours if nothing's weird.");
  });
  it("drops the marks around a text that is one quotation", () => {
    expect(nestQuotes('"The link is slow."')).toBe("The link is slow.");
    expect(nestQuotes("“The link is slow.”")).toBe("The link is slow.");
  });
  it("turns inner quotation marks into single ones", () => {
    expect(nestQuotes('Sam: "The link is slow…"')).toBe("Sam: ‘The link is slow…’");
    expect(nestQuotes('He said "yes" and then "no".')).toBe("He said ‘yes’ and then ‘no’.");
    expect(nestQuotes("A “CONFIRMED” column")).toBe("A ‘CONFIRMED’ column");
  });
});

describe("quotedAtEnd", () => {
  it("ends a sentence after words in quotation marks with a full stop", () => {
    expect(`Deleted ${quotedAtEnd("Crew planning")} The activity log records who, when and why.`).toBe("Deleted “Crew planning”. The activity log records who, when and why.");
  });
  it("lets words that end with their own stop end the sentence, so the punctuation is never doubled", () => {
    expect(quotedAtEnd("Crews plan by the day.")).toBe("“Crews plan by the day.”");
    expect(quotedAtEnd("Do crews plan by the day?")).toBe("“Do crews plan by the day?”");
    expect(quotedAtEnd("Crews plan by the day…")).toBe("“Crews plan by the day…”");
    expect(quotedAtEnd('Crews call it "slow."')).toBe("“Crews call it ‘slow.’”");
    expect(quotedAtEnd("  Crews plan by the day.  ")).toBe("“Crews plan by the day.”");
  });
});

describe("fileTypeName", () => {
  it("names common office and text formats", () => {
    expect(fileTypeName("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("Word document");
    expect(fileTypeName("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("PowerPoint presentation");
    expect(fileTypeName("text/plain; charset=utf-8")).toBe("Plain text");
    expect(fileTypeName("text/vtt")).toBe("WebVTT transcript");
  });
  it("falls back to the family, then the extension, then the media type", () => {
    expect(fileTypeName("audio/mpeg")).toBe("Audio (MPEG)");
    expect(fileTypeName("application/octet-stream", "notes.key")).toBe("KEY file");
    expect(fileTypeName("application/x-thing")).toBe("application/x-thing");
    expect(fileTypeName(null)).toBe("Unknown type");
  });
});
