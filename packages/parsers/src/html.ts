import { parse } from "parse5";
import { tableBlocks } from "./tables.ts";
import { decodeText } from "./text.ts";
import type { Block, FormatParser } from "./types.ts";

type Node = {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: Node[];
  content?: Node;
};

const DROP = new Set(["script", "style", "nav", "noscript", "template", "svg", "head", "iframe", "object", "button", "form"]);
const BLOCK = new Set([
  "p", "li", "dd", "dt", "blockquote", "pre", "td", "th", "caption", "figcaption", "div", "section",
  "article", "main", "header", "footer", "aside", "tr", "table", "ul", "ol", "dl", "figure", "address",
  "thead", "tbody", "tfoot", "details", "summary", "menu", "hgroup", "fieldset", "legend",
]);
const HEADING = /^h([1-6])$/;

const isElement = (n: Node) => n.tagName !== undefined;

/** A table's rows of cell text, through thead, tbody and tfoot; a nested table stays inside its cell. */
function tableRows(table: Node): string[][] {
  const rows: string[][] = [];
  const visit = (n: Node) => {
    for (const c of n.childNodes ?? []) {
      const tag = c.tagName?.toLowerCase();
      if (tag === "tr") {
        rows.push(
          (c.childNodes ?? [])
            .filter((cell) => ["td", "th"].includes(cell.tagName?.toLowerCase() ?? ""))
            .map((cell) => collectText(cell).replace(/\s+/g, " ").trim()),
        );
      } else if (tag === "thead" || tag === "tbody" || tag === "tfoot") visit(c);
    }
  };
  visit(table);
  return rows;
}

/**
 * HTML: main-content text with headings. Scripts, styles and navigation are dropped; headings
 * become heading segments, block elements become paragraphs, and a table becomes one segment per
 * row with header pairs, as in DOCX. Adjacent elements (labels, breadcrumbs) are kept apart by a
 * space rather than run together.
 */
export const htmlParser: FormatParser = {
  name: "html",
  version: "3",
  parse(bytes) {
    const doc = parse(decodeText(bytes)) as unknown as Node;
    const blocks: Block[] = [];
    let buf = "";
    const flush = () => {
      const t = buf.replace(/\s+/g, " ").trim();
      if (t) blocks.push({ text: t });
      buf = "";
    };
    const walk = (node: Node) => {
      const tag = node.tagName?.toLowerCase();
      if (tag && DROP.has(tag)) return;
      if (node.nodeName === "#text") {
        buf += node.value ?? "";
        return;
      }
      if (node.nodeName === "#comment") return;
      if (tag === "br" || tag === "hr") {
        buf += " ";
        return;
      }
      const h = tag?.match(HEADING);
      if (h?.[1]) {
        flush();
        const text = collectText(node).replace(/\s+/g, " ").trim();
        if (text) blocks.push({ text: `${"#".repeat(Number(h[1]))} ${text}`, heading_level: Number(h[1]) });
        return;
      }
      if (tag === "table") {
        flush();
        for (const c of node.childNodes ?? []) {
          if (c.tagName?.toLowerCase() !== "caption") continue;
          const caption = collectText(c).replace(/\s+/g, " ").trim();
          if (caption) blocks.push({ text: caption });
        }
        blocks.push(...tableBlocks(tableRows(node)));
        return;
      }
      const isBlock = tag !== undefined && BLOCK.has(tag);
      if (isBlock) flush();
      let prevElement = false;
      for (const child of node.childNodes ?? []) {
        if (child.nodeName === "#comment") continue;
        if (isElement(child) && prevElement && buf && !/\s$/.test(buf)) buf += " ";
        walk(child);
        prevElement = isElement(child);
      }
      if (tag === "template" && node.content) walk(node.content);
      if (isBlock) flush();
    };
    walk(doc);
    flush();
    return { blocks };
  },
};

/** Text under a node; adjacent elements and block elements are separated by a space. */
function collectText(node: Node): string {
  if (node.nodeName === "#text") return node.value ?? "";
  const tag = node.tagName?.toLowerCase();
  if (tag && DROP.has(tag)) return "";
  if (tag === "br" || tag === "hr") return " ";
  let out = "";
  let prevElement = false;
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === "#comment") continue;
    const text = collectText(child);
    const block = BLOCK.has(child.tagName?.toLowerCase() ?? "");
    if (isElement(child) && (prevElement || block) && out && !/\s$/.test(out) && text && !/^\s/.test(text)) out += " ";
    out += text;
    if (block) out += " ";
    prevElement = isElement(child);
  }
  return out;
}
