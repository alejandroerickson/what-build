import { strFromU8, unzipSync } from "fflate";
import type { Block, FormatParser } from "./types.ts";
import { descendants, elements, first, parseXml, textOf, type XmlElement } from "./xml.ts";

interface DocxState {
  headingByStyle: Map<string, number>;
  trackedInsertions: number;
  trackedDeletions: number;
  tableCount: number;
}

/** Text of a paragraph in its accepted view: inserted runs kept, deleted runs and field codes dropped. */
function paragraphText(p: XmlElement, st: DocxState): string {
  let out = "";
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      if (typeof c === "string") continue;
      switch (c.name) {
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
  return out.replace(/\s+/g, " ").trim();
}

function headingLevel(p: XmlElement, st: DocxState): number | undefined {
  const pPr = first(p, "w:pPr");
  const style = pPr && first(pPr, "w:pStyle");
  const id = style?.attrs["w:val"];
  if (!id) return undefined;
  const byStyle = st.headingByStyle.get(id);
  if (byStyle) return byStyle;
  const m = id.match(/^(?:heading|Heading)\s*([1-6])$/);
  if (m?.[1]) return Number(m[1]);
  if (/^title$/i.test(id)) return 1;
  if (/^subtitle$/i.test(id)) return 2;
  return undefined;
}

function cellText(tc: XmlElement, st: DocxState): string {
  const parts: string[] = [];
  for (const el of elements(tc)) {
    if (el.name === "w:p") {
      const t = paragraphText(el, st);
      if (t) parts.push(t);
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
  const rows = elements(tbl, "w:tr").map((tr) => elements(tr, "w:tc").map((tc) => cellText(tc, st)));
  if (!rows.length) return [];
  const header = rows[0]!;
  const blocks: Block[] = [];
  const headerUsable = rows.length > 1 && header.every((h) => h.trim().length > 0);
  if (!headerUsable) {
    for (const r of rows) {
      const t = r.filter(Boolean).join(" | ");
      if (t) blocks.push({ text: t });
    }
    return blocks;
  }
  blocks.push({ text: header.join(" | ") });
  for (const r of rows.slice(1)) {
    const pairs = r.map((cell, i) => (cell ? `${header[i] ?? `Column ${i + 1}`}: ${cell}` : "")).filter(Boolean);
    if (pairs.length) blocks.push({ text: pairs.join(" | ") });
  }
  return blocks;
}

/**
 * DOCX: headings, paragraphs, tables (one segment per row, header repeated as `header: cell`
 * pairs), the accepted view of tracked changes, and reviewer comments appended at the end.
 */
export const docxParser: FormatParser = {
  name: "docx",
  version: "3",
  parse(bytes) {
    const files = unzipSync(bytes, {
      filter: (f) => ["word/document.xml", "word/styles.xml", "word/comments.xml"].includes(f.name),
    });
    const docXml = files["word/document.xml"];
    if (!docXml) throw new Error("not a Word document: word/document.xml is missing");
    const st: DocxState = { headingByStyle: new Map(), trackedInsertions: 0, trackedDeletions: 0, tableCount: 0 };
    const stylesXml = files["word/styles.xml"];
    if (stylesXml) {
      const styles = parseXml(strFromU8(stylesXml));
      for (const s of descendants(styles, "w:style")) {
        const id = s.attrs["w:styleId"];
        const name = first(s, "w:name")?.attrs["w:val"]?.toLowerCase() ?? "";
        const m = name.match(/^heading\s*([1-6])$/);
        if (id && m?.[1]) st.headingByStyle.set(id, Number(m[1]));
        else if (id && name === "title") st.headingByStyle.set(id, 1);
        else if (id && name === "subtitle") st.headingByStyle.set(id, 2);
      }
    }
    const doc = parseXml(strFromU8(docXml));
    const body = descendants(doc, "w:body")[0];
    if (!body) throw new Error("the document has no body");
    const blocks: Block[] = [];
    const walkBody = (el: XmlElement) => {
      for (const c of elements(el)) {
        if (c.name === "w:p") {
          const text = paragraphText(c, st);
          if (!text) continue;
          const level = headingLevel(c, st);
          blocks.push(level ? { text: `${"#".repeat(level)} ${text}`, heading_level: level } : { text });
        } else if (c.name === "w:tbl") {
          blocks.push(...tableBlocks(c, st));
        } else if (c.name === "w:sdt") {
          const content = first(c, "w:sdtContent");
          if (content) walkBody(content);
        }
      }
    };
    walkBody(body);
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
      },
    };
  },
};
