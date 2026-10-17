import { strFromU8 } from "fflate";
import { looksLikeTranscript, speakerTurn } from "./speakers.ts";
import { tableBlocks as rowBlocks } from "./tables.ts";
import { DEFAULT_PARSE_CAP_BYTES, type Block, type FormatParser } from "./types.ts";
import { descendants, elements, first, parseXml, textOf, type XmlElement } from "./xml.ts";
import { unzipParts } from "./zip.ts";

/** A heading style: the document title, its subtitle, or a numbered heading. */
export type HeadingStyle = { kind: "title" } | { kind: "subtitle" } | { kind: "heading"; n: number };

/** One level of a Word list: its number format (`decimal`, `bullet`, …), start and label pattern. */
interface ListLevel {
  format: string;
  start: number;
  text: string;
}

/**
 * A `w:num`. Lists that share an abstract definition continue one count, as Word numbers them,
 * unless the list restarts it with a start override.
 */
interface WordList {
  levels: Map<number, ListLevel>;
  counter: string;
}

interface DocxState {
  headingByStyle: Map<string, HeadingStyle>;
  /** The list numbering a paragraph style carries (Word's "List Number"), by style id. */
  numPrByStyle: Map<string, XmlElement>;
  /** Lists by `numId`: their levels by `ilvl`, and the counter they share. */
  lists: Map<string, WordList>;
  /** The running count of each counter's levels. */
  listCounts: Map<string, number[]>;
  trackedInsertions: number;
  trackedDeletions: number;
  tableCount: number;
}

function isBoldRun(r: XmlElement): boolean {
  const rPr = first(r, "w:rPr");
  if (!rPr) return false;
  const b = first(rPr, "w:b");
  if (b && !["0", "false", "off"].includes(b.attrs["w:val"] ?? "")) return true;
  return /strong|bold/i.test(first(rPr, "w:rStyle")?.attrs["w:val"] ?? "");
}

/**
 * Text of a paragraph in its accepted view: inserted runs kept, deleted runs and field codes
 * dropped. A bold "Name:" lead run is kept apart from the words after it, as a speaker label.
 */
function paragraphText(p: XmlElement, st: DocxState): string {
  let out = "";
  let leading = true;
  let boldLeadEnd = 0;
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      if (typeof c === "string") continue;
      switch (c.name) {
        case "w:r": {
          const before = out.length;
          walk(c);
          if (leading && out.length > before) {
            if (isBoldRun(c)) boldLeadEnd = out.length;
            else leading = false;
          }
          break;
        }
        case "w:t":
          out += textOf(c);
          break;
        case "w:tab":
          out += " ";
          break;
        case "w:br":
        case "w:cr":
          out += " ";
          break;
        case "w:del":
          st.trackedDeletions++;
          break;
        case "w:ins":
          st.trackedInsertions++;
          walk(c);
          break;
        case "w:instrText":
        case "w:delText":
        case "w:pPr":
        case "w:rPr":
          break;
        default:
          walk(c);
      }
    }
  };
  walk(p);
  if (boldLeadEnd > 0 && /:\s*$/.test(out.slice(0, boldLeadEnd)) && /^\S/.test(out.slice(boldLeadEnd)))
    out = `${out.slice(0, boldLeadEnd)} ${out.slice(boldLeadEnd)}`;
  return out.replace(/\s+/g, " ").trim();
}

function headingStyle(p: XmlElement, st: DocxState): HeadingStyle | undefined {
  const pPr = first(p, "w:pPr");
  const style = pPr && first(pPr, "w:pStyle");
  const id = style?.attrs["w:val"];
  if (!id) return undefined;
  const byStyle = st.headingByStyle.get(id);
  if (byStyle) return byStyle;
  const m = id.match(/^(?:heading|Heading)\s*([1-6])$/);
  if (m?.[1]) return { kind: "heading", n: Number(m[1]) };
  if (/^title$/i.test(id)) return { kind: "title" };
  if (/^subtitle$/i.test(id)) return { kind: "subtitle" };
  return undefined;
}

/**
 * The outline level of a heading style. A document with a Title keeps it above its sections, as a
 * Markdown `#` title sits above `##` sections: Title 1, Subtitle 2, Heading n at n + 1 (at most 6).
 * Without a Title, Heading n is level n.
 */
export function levelOf(style: HeadingStyle, hasTitle: boolean): number {
  if (style.kind === "title") return 1;
  if (style.kind === "subtitle") return 2;
  return hasTitle ? Math.min(style.n + 1, 6) : style.n;
}

/** The lists of `word/numbering.xml`: each `w:num` resolved to its abstract definition's levels. */
function readLists(xml: Uint8Array | undefined): Map<string, WordList> {
  const lists = new Map<string, WordList>();
  if (!xml) return lists;
  const numbering = parseXml(strFromU8(xml));
  const abstracts = new Map<string, Map<number, ListLevel>>();
  for (const a of descendants(numbering, "w:abstractNum")) {
    const levels = new Map<number, ListLevel>();
    for (const lvl of elements(a, "w:lvl"))
      levels.set(Number(lvl.attrs["w:ilvl"] ?? 0), {
        format: first(lvl, "w:numFmt")?.attrs["w:val"] ?? "decimal",
        start: Number(first(lvl, "w:start")?.attrs["w:val"] ?? 1),
        text: first(lvl, "w:lvlText")?.attrs["w:val"] ?? "",
      });
    abstracts.set(a.attrs["w:abstractNumId"] ?? "", levels);
  }
  for (const num of descendants(numbering, "w:num")) {
    const abstractId = first(num, "w:abstractNumId")?.attrs["w:val"] ?? "";
    const base = abstracts.get(abstractId);
    if (!base) continue;
    const numId = num.attrs["w:numId"] ?? "";
    const levels = new Map(base);
    let restarts = false;
    for (const o of elements(num, "w:lvlOverride")) {
      const ilvl = Number(o.attrs["w:ilvl"] ?? 0);
      const start = first(o, "w:startOverride")?.attrs["w:val"];
      const lvl = levels.get(ilvl);
      if (lvl && start !== undefined) {
        levels.set(ilvl, { ...lvl, start: Number(start) });
        restarts = true;
      }
    }
    lists.set(numId, { levels, counter: restarts ? `num:${numId}` : `abstract:${abstractId}` });
  }
  return lists;
}

/**
 * The number of a paragraph in a decimal Word list (`1.`, `2.1.`), counted in document order, or
 * "" for bullets, other number formats and paragraphs outside a list. As in Markdown, a bullet's
 * marker is dropped and a number is kept.
 */
function listNumber(p: XmlElement, st: DocxState): string {
  const pPr = first(p, "w:pPr");
  const styleId = pPr && first(pPr, "w:pStyle")?.attrs["w:val"];
  const numPr = (pPr && first(pPr, "w:numPr")) ?? (styleId ? st.numPrByStyle.get(styleId) : undefined);
  if (!numPr) return "";
  const list = st.lists.get(first(numPr, "w:numId")?.attrs["w:val"] ?? "");
  if (!list) return "";
  const { levels } = list;
  const ilvl = Number(first(numPr, "w:ilvl")?.attrs["w:val"] ?? 0);
  const counts = st.listCounts.get(list.counter) ?? [];
  st.listCounts.set(list.counter, counts);
  for (let i = 0; i <= ilvl; i++) if (counts[i] === undefined) counts[i] = (levels.get(i)?.start ?? 1) - (i < ilvl ? 0 : 1);
  counts[ilvl]!++;
  counts.length = ilvl + 1;
  const lvl = levels.get(ilvl);
  if (lvl?.format !== "decimal") return "";
  const label = (lvl.text || `%${ilvl + 1}.`).replace(/%([1-9])/g, (_m, k: string) => String(counts[Number(k) - 1] ?? 1));
  return /\d/.test(label) ? label.trim() : "";
}

function cellText(tc: XmlElement, st: DocxState): string {
  const parts: string[] = [];
  for (const el of elements(tc)) {
    if (el.name === "w:p") {
      const n = listNumber(el, st);
      const t = paragraphText(el, st);
      if (t) parts.push(n ? `${n} ${t}` : t);
    } else if (el.name === "w:tbl") {
      // Nested tables are flattened into their cell.
      for (const row of elements(el, "w:tr")) {
        const cells = elements(row, "w:tc").map((c) => cellText(c, st)).filter(Boolean);
        if (cells.length) parts.push(cells.join(" | "));
      }
    }
  }
  return parts.join(" ");
}

function tableBlocks(tbl: XmlElement, st: DocxState): Block[] {
  st.tableCount++;
  return rowBlocks(elements(tbl, "w:tr").map((tr) => elements(tr, "w:tc").map((tc) => cellText(tc, st))));
}

/**
 * DOCX: headings, paragraphs, decimal list numbers, tables (one segment per row, header repeated as
 * `header: cell` pairs), the accepted view of tracked changes, and reviewer comments appended at
 * the end. A
 * document whose paragraphs are mostly "Name: words" turns is read as a transcript, with speakers.
 */
export const docxParser: FormatParser = {
  name: "docx",
  version: "8",
  parse(bytes, _fileName, options = {}) {
    const files = unzipParts(
      bytes,
      (name) => ["word/document.xml", "word/styles.xml", "word/comments.xml", "word/numbering.xml"].includes(name),
      options.maxBytes ?? DEFAULT_PARSE_CAP_BYTES,
    );
    const docXml = files["word/document.xml"];
    if (!docXml) throw new Error("not a Word document: word/document.xml is missing");
    const st: DocxState = {
      headingByStyle: new Map(),
      numPrByStyle: new Map(),
      lists: readLists(files["word/numbering.xml"]),
      listCounts: new Map(),
      trackedInsertions: 0,
      trackedDeletions: 0,
      tableCount: 0,
    };
    const stylesXml = files["word/styles.xml"];
    if (stylesXml) {
      const styles = parseXml(strFromU8(stylesXml));
      for (const s of descendants(styles, "w:style")) {
        const id = s.attrs["w:styleId"];
        const name = first(s, "w:name")?.attrs["w:val"]?.toLowerCase() ?? "";
        const stylePPr = first(s, "w:pPr");
        const numPr = stylePPr && first(stylePPr, "w:numPr");
        if (id && numPr) st.numPrByStyle.set(id, numPr);
        const m = name.match(/^heading\s*([1-6])$/);
        if (id && m?.[1]) st.headingByStyle.set(id, { kind: "heading", n: Number(m[1]) });
        else if (id && name === "title") st.headingByStyle.set(id, { kind: "title" });
        else if (id && name === "subtitle") st.headingByStyle.set(id, { kind: "subtitle" });
      }
    }
    const doc = parseXml(strFromU8(docXml));
    const body = descendants(doc, "w:body")[0];
    if (!body) throw new Error("the document has no body");
    const blocks: Block[] = [];
    // Heading levels wait until the whole body is read (a Title moves every heading down one), and
    // body paragraphs are kept aside to decide whether the document is a transcript.
    const headings: { block: Block; style: HeadingStyle }[] = [];
    const paragraphs: Block[] = [];
    const walkBody = (el: XmlElement) => {
      for (const c of elements(el)) {
        if (c.name === "w:p") {
          const n = listNumber(c, st);
          const text = paragraphText(c, st);
          if (!text) continue;
          const style = headingStyle(c, st);
          const block: Block = { text: n ? `${n} ${text}` : text };
          if (style) headings.push({ block, style });
          else paragraphs.push(block);
          blocks.push(block);
        } else if (c.name === "w:tbl") {
          for (const b of tableBlocks(c, st)) blocks.push(b);
        } else if (c.name === "w:sdt") {
          const content = first(c, "w:sdtContent");
          if (content) walkBody(content);
        }
      }
    };
    walkBody(body);
    const hasTitle = headings.some((h) => h.style.kind === "title");
    for (const { block, style } of headings) {
      block.heading_level = levelOf(style, hasTitle);
      block.text = `${"#".repeat(block.heading_level)} ${block.text}`;
    }
    // "Name: words" paragraphs are speaker turns, decided exactly as for a plain-text transcript.
    let turns = 0;
    if (looksLikeTranscript(paragraphs.map((b) => b.text))) {
      for (const block of paragraphs) {
        const t = speakerTurn(block.text);
        if (!t) continue;
        block.speaker = t.speaker;
        block.text = t.text;
        turns++;
      }
    }
    let commentCount = 0;
    const commentsXml = files["word/comments.xml"];
    if (commentsXml) {
      const comments = descendants(parseXml(strFromU8(commentsXml)), "w:comment");
      const lines = comments
        .map((c) => {
          const text = elements(c, "w:p").map((p) => paragraphText(p, st)).filter(Boolean).join(" ");
          return text ? `${c.attrs["w:author"] ?? "Reviewer"}: ${text}` : "";
        })
        .filter(Boolean);
      commentCount = lines.length;
      if (lines.length) {
        blocks.push({ text: "# Review comments", heading_level: 1 });
        for (const l of lines) blocks.push({ text: l });
      }
    }
    return {
      blocks,
      facts: {
        table_count: st.tableCount,
        comment_count: commentCount,
        had_tracked_changes: st.trackedInsertions + st.trackedDeletions > 0,
        tracked_insertions: st.trackedInsertions,
        tracked_deletions: st.trackedDeletions,
        ...(turns ? { transcript_turns: turns } : {}),
      },
    };
  },
};
