import { parse } from "parse5";
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
]);
const HEADING = /^h([1-6])$/;

/**
 * HTML: main-content text with headings. Scripts, styles and navigation are dropped; headings
 * become heading segments and block elements become paragraphs.
 */
export const htmlParser: FormatParser = {
  name: "html",
  version: "2",
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
      const isBlock = tag !== undefined && BLOCK.has(tag);
      if (isBlock) flush();
      for (const child of node.childNodes ?? []) walk(child);
      if (tag === "template" && node.content) walk(node.content);
      if (isBlock) flush();
    };
    walk(doc);
    flush();
    return { blocks };
  },
};

function collectText(node: Node): string {
  if (node.nodeName === "#text") return node.value ?? "";
  const tag = node.tagName?.toLowerCase();
  if (tag && DROP.has(tag)) return "";
  if (tag === "br") return " ";
  return (node.childNodes ?? []).map(collectText).join("");
}
