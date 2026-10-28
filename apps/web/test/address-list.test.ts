import { describe, expect, it } from "vitest";
import { readAddressList } from "../src/lib/address-list.ts";

const read = (text: string) => readAddressList(text).addresses.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email));

describe("reading a pasted list of addresses", () => {
  it("reads addresses separated by commas, semicolons, spaces, tabs and new lines", () => {
    expect(read("ana@example.com, ben@example.com;cy@example.com dee@example.com\teli@example.com\nfay@example.com\r\ngus@example.com")).toEqual([
      "ana@example.com",
      "ben@example.com",
      "cy@example.com",
      "dee@example.com",
      "eli@example.com",
      "fay@example.com",
      "gus@example.com",
    ]);
  });

  it("reads names as Gmail and Apple Mail copy them", () => {
    expect(read("Ana Lima <ana@example.com>, Ben Ito <ben@example.com>, cy@example.com")).toEqual(["Ana Lima <ana@example.com>", "Ben Ito <ben@example.com>", "cy@example.com"]);
  });

  it("reads Outlook's names, quoted or not, with the comma in them", () => {
    expect(read('"Lima, Ana" <ana@example.com>; "Ito, Ben" <ben@example.com>')).toEqual(["Lima, Ana <ana@example.com>", "Ito, Ben <ben@example.com>"]);
    expect(read("Lima, Ana <ana@example.com>; Ito, Ben <ben@example.com>;")).toEqual(["Lima, Ana <ana@example.com>", "Ito, Ben <ben@example.com>"]);
  });

  it("reads a spreadsheet's name and address columns, leaving its header row out", () => {
    expect(read("Name\tEmail\nAna Lima\tana@example.com\nBen Ito\tben@example.com\n")).toEqual(["Ana Lima <ana@example.com>", "Ben Ito <ben@example.com>"]);
    // An address column first: the name after it on the line is no other row's.
    expect(read("ana@example.com,Ana Lima\nben@example.com,Ben Ito")).toEqual(["ana@example.com", "ben@example.com"]);
  });

  it("reads mailto: links, quotes and brackets around an address, and a name in parentheses after it", () => {
    expect(read("mailto:ana@example.com, 'ben@example.com', [cy@example.com], {dee@example.com}")).toEqual(["ana@example.com", "ben@example.com", "cy@example.com", "dee@example.com"]);
    expect(read("ana@example.com (Ana Lima), ben@example.com")).toEqual(["Ana Lima <ana@example.com>", "ben@example.com"]);
  });

  it("keeps an apostrophe, a plus and a dot inside an address, and takes off a sentence's full stop", () => {
    expect(read("o'brien@example.com, ana+wb@mail.example, ben.ito@example.com. Thanks!")).toEqual(["o'brien@example.com", "ana+wb@mail.example", "ben.ito@example.com"]);
  });

  it("lists an address once, whatever its case, keeping the name it was given anywhere", () => {
    const r = readAddressList("ana@example.com, Ana Lima <ANA@example.com>, ben@example.com, ben@example.com");
    expect(r.addresses).toEqual([
      { email: "ana@example.com", name: "Ana Lima" },
      { email: "ben@example.com", name: null },
    ]);
    expect(r.repeated).toBe(2);
  });

  it("says what has an @ but isn't an address, and reads the rest", () => {
    const r = readAddressList("ana@example.com, ben@, @cy, dee@example, eli@@example.com, fay@example.com");
    expect(r.addresses.map((a) => a.email)).toEqual(["ana@example.com", "fay@example.com"]);
    expect(r.unreadable).toEqual(["ben@", "@cy", "dee@example", "eli@@example.com"]);
  });

  it("takes no name from a sentence, an address, or text without a letter", () => {
    expect(read("<ana@example.com>, 123 <ben@example.com>, \"cy@example.com\" <cy@example.com>")).toEqual(["ana@example.com", "ben@example.com", "cy@example.com"]);
  });

  it("reads nothing from text without an address", () => {
    expect(readAddressList("")).toEqual({ addresses: [], repeated: 0, unreadable: [] });
    expect(readAddressList("Ana, Ben and Cy").addresses).toEqual([]);
  });
});
