import { describe, expect, it } from "vitest";
import { fileTypeName, nestQuotes } from "../src/lib/format.ts";

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
