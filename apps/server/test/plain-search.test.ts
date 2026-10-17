import { closestWord, excerpt, matchText, parseFind, wordRoot } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPorts } from "../src/app.ts";
import { seed } from "../src/seed.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

describe("how plain search reads a query", () => {
  it("forgives endings, so one root is a prefix of every form", () => {
    expect(wordRoot("pricing")).toBe("pric");
    expect(wordRoot("prices")).toBe("pric");
    expect(wordRoot("price")).toBe("pric");
    expect(wordRoot("scheduling")).toBe("schedul");
    expect(wordRoot("planning")).toBe("plan");
    expect(wordRoot("integrations")).toBe("integr");
    // Short words are not cut into prefixes of unrelated ones.
    expect(wordRoot("pays")).toBe("pays");
    expect(wordRoot("used")).toBe("used");
  });

  it("matches the word being typed as a prefix, skips small words, and takes a kind as a hint", () => {
    expect(parseFind("how do crews plan the wee")).toMatchObject({
      terms: [
        { text: "crews", root: "crew", prefix: true },
        { text: "plan", root: "plan", prefix: true },
        { text: "wee", root: "wee", prefix: true },
      ],
      ignored: ["how", "do", "the"],
      kind: null,
    });
    expect(parseFind("mockups for the day planner ")).toMatchObject({ terms: [{ root: "day", prefix: false }, { root: "plan" }], kind: "mockup" });
    // A query of only small words or a kind still searches for them.
    expect(parseFind("the").terms).toHaveLength(1);
    expect(parseFind("mockups").terms).toMatchObject([{ text: "mockups" }]);
  });

  it("matches quoted words as a phrase", () => {
    expect(parseFind('"group chat" sunday')).toMatchObject({ terms: [{ text: "sunday", prefix: true }, { text: "group chat", phrase: true }] });
    // A quote still open while typing is a phrase so far.
    expect(parseFind('"group ch').terms).toMatchObject([{ text: "group ch", phrase: true }]);
  });

  it("marks matches whatever the case or accents, and cuts an excerpt around the densest run", () => {
    const m = matchText("Café pricing: the PRICE was right.", parseFind("cafe price ").terms);
    expect(m.found).toEqual([true, true]);
    expect(m.ranges).toEqual([[0, 4], [5, 12], [18, 23]]);
    const long = `${"filler words here ".repeat(30)}the crew lead texts the office ${"more filler ".repeat(30)}`;
    const e = excerpt(long, matchText(long, parseFind("crew office ").terms).ranges, 120);
    expect(e.text.startsWith("…")).toBe(true);
    expect(e.marks.map(([a, b]) => e.text.slice(a, b))).toEqual(["crew", "office"]);
  });

  it("finds the word a misspelling meant among the product's own words", () => {
    const texts = ["The approval went through.", "Approvals take a week.", "We approved it."];
    expect(closestWord("aproval", texts, false)).toBe("approval");
    expect(closestWord("schedlue", ["the schedule changed"], false)).toBe("schedule");
    expect(closestWord("zzzz", texts, false)).toBeNull();
    // A word still being typed is compared with the start of each word.
    expect(closestWord("aprov", texts, true)).toBe("approval");
  });
});

let h: Harness;
let sam: Browser;
let S: string;

beforeAll(async () => {
  h = await startHarness();
  await seed({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer) }, h.worker, () => {});
  sam = await h.signIn("sam@example.com", "Sam Okafor");
  const products = await sam.api("GET", "/api/v1/me/products");
  S = `/api/v1/p/${products.body.items.find((p: { name: string }) => p.name === "Crewboard").path}`;
});
afterAll(async () => h?.close());

const find = async (q: string, extra = "") => {
  const r = await sam.api("GET", `${S}/search?mode=plain&query=${encodeURIComponent(q)}${extra}`);
  expect(r.status).toBe(200);
  return r.body;
};

describe("plain search over the sample product", () => {
  const titles = (r: { results: { kind: string; title: string }[] }) => r.results.map((x) => `${x.kind}: ${x.title}`);

  it("finds every kind of thing in one search, a matching title first", async () => {
    const r = await find("crew message");
    expect(titles(r)[0]).toBe("story: Crew message");
    expect(new Set(r.results.map((x: { kind: string }) => x.kind))).toEqual(new Set(["story", "source", "mockup"]));
    // A source appears once, with its best passages, each read by its seq.
    const greenline = r.results.find((x: { title: string }) => x.title.startsWith("Crew lead interview"));
    expect(greenline.hit_count).toBe(4);
    expect(greenline.hits).toHaveLength(3);
    expect(greenline.hits[0]).toMatchObject({ seq: expect.any(Number), speaker: "Marisol" });
    const h = greenline.hits[0];
    expect(h.marks.map(([a, b]: [number, number]) => h.text.slice(a, b).toLowerCase())).toEqual(expect.arrayContaining(["crew", "message"]));
  });

  it("forgives endings, and matches the word being typed as a prefix", async () => {
    const r = await find("pricing");
    expect(titles(r)).toEqual(["source: Owner interview — Oak & Ash Grounds, Aug 2026"]);
    expect(r.results[0].hits[0].text).toContain("a price the same day");
    expect(titles(await find("greenl"))).toContain("source: Crew lead interview — Greenline Landscaping, Aug 2026");
  });

  it("corrects a word that matches nothing, says so, and searches as typed when asked", async () => {
    const r = await find("quoet");
    expect(r.corrections).toEqual([{ from: "quoet", to: "quote" }]);
    expect(titles(r)).toEqual(["source: Owner interview — Oak & Ash Grounds, Aug 2026"]);
    const strict = await find("quoet", "&strict=true");
    expect(strict).toMatchObject({ corrections: [], results: [], partial: false });
    expect((await find("owners plan the wek")).corrections).toEqual([{ from: "wek", to: "week" }]);
  });

  it("skips small words, brings a named kind first, and opens a mockup on the page that matches", async () => {
    const r = await find("how do owners plan the week");
    expect(r.ignored).toEqual(["how", "do", "the"]);
    expect(r.partial).toBe(false);
    const m = await find("mockups jobs");
    expect(m.kind_hint).toBe("mockup");
    expect(m.results[0]).toMatchObject({ kind: "mockup", meta: { page_id: "jobs-board" } });
  });

  it("shows what holds most of the words when nothing holds all of them, naming what is missing", async () => {
    const r = await find("zebra pricing ");
    expect(r.partial).toBe(true);
    expect(r.results[0].missing).toEqual(["zebra"]);
  });

  it("narrows to one source's passages, every one of them", async () => {
    const all = await find("crew message");
    const id = all.results.find((x: { kind: string }) => x.kind === "source").id;
    const one = await find("crew", `&record_id=${id}`);
    expect(one.results).toHaveLength(1);
    expect(one.results[0].hits).toHaveLength(one.results[0].hit_count);
  });

  it("takes no passage filters, and keeps its own options to itself", async () => {
    expect((await sam.api("GET", `${S}/search?mode=plain&query=crew&tags=interview`)).body).toMatchObject({ error: { code: "invalid_filter" } });
    expect((await sam.api("GET", `${S}/search?query=crew&strict=true`)).body).toMatchObject({ error: { code: "invalid_filter" } });
  });

  it("is open to viewers and closed to someone who reads only the Story", async () => {
    const jordan = await h.signIn("jordan@example.com");
    expect((await jordan.api("GET", `${S}/search?mode=plain&query=crew`)).status).toBe(403);
  });
});
