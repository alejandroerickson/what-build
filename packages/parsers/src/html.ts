import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from "parse5";
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
/**
 * Whether a piece of text ends in whitespace. Callers remember this for the text they build up
 * rather than asking it of the whole: /\s$/ scans the string, and even reading the last character
 * of a string built by appending copies it, so a long paragraph would take quadratic time.
 */
const endsInSpace = (s: string) => /\s/.test(s.charAt(s.length - 1));

/** How deep elements may nest. Browsers stop nesting at about this depth too. */
export const MAX_HTML_DEPTH = 512;

/** A page beyond what `parseHtml` reads: nested too deep, or making far more elements than it has tags. */
export class HtmlLimitError extends Error {
  override name = "HtmlLimitError";
}

type TreeNode = DefaultTreeAdapterMap["node"];

/**
 * Parse HTML with parse5 within bounds a hostile page cannot stretch. parse5 spends time in
 * proportion to the nesting depth on every tag, and re-opens unclosed formatting elements after
 * each block, so a page of a few kilobytes could stall the server for minutes or make millions of
 * elements and exhaust its memory. Here elements nest at most `MAX_HTML_DEPTH` deep, and a page
 * makes at most one element for every two characters, plus a margin; past either, it throws
 * `HtmlLimitError`.
 */
export function parseHtml(source: string): DefaultTreeAdapterMap["document"] {
  const maxElements = 10_000 + Math.floor(source.length / 2);
  let elements = 0;
  // A template's content is a fragment with no parent; its depth continues from the template.
  const templateOf = new WeakMap<TreeNode, TreeNode>();
  const checkDepth = (parent: TreeNode) => {
    let depth = 0;
    for (let n: TreeNode | null | undefined = parent; n; n = ("parentNode" in n ? n.parentNode : null) ?? templateOf.get(n)) {
      if (++depth > MAX_HTML_DEPTH) throw new HtmlLimitError(`the HTML nests elements more than ${MAX_HTML_DEPTH} deep`);
    }
  };
  return parse(source, {
    treeAdapter: {
      ...defaultTreeAdapter,
      createElement(tagName, namespaceURI, attrs) {
        if (++elements > maxElements) throw new HtmlLimitError(`the HTML makes more than ${maxElements} elements, far more than it has tags`);
        return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
      },
      appendChild(parentNode, newNode) {
        if ("tagName" in newNode) checkDepth(parentNode);
        defaultTreeAdapter.appendChild(parentNode, newNode);
      },
      insertBefore(parentNode, newNode, referenceNode) {
        if ("tagName" in newNode) checkDepth(parentNode);
        // From the end: content fostered out of a table goes just before it, and the table is near the end.
        parentNode.childNodes.splice(parentNode.childNodes.lastIndexOf(referenceNode), 0, newNode);
        newNode.parentNode = parentNode;
      },
      setTemplateContent(templateElement, contentElement) {
        templateOf.set(contentElement, templateElement);
        defaultTreeAdapter.setTemplateContent(templateElement, contentElement);
      },
    },
  });
}

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
  version: "6",
  parse(bytes) {
    const doc = parseHtml(decodeText(bytes)) as unknown as Node;
    const blocks: Block[] = [];
    let buf = "";
    let bufEndsInSpace = false;
    const flush = () => {
      const t = buf.replace(/\s+/g, " ").trim();
      if (t) blocks.push({ text: t });
      buf = "";
      bufEndsInSpace = false;
    };
    const walk = (node: Node) => {
      const tag = node.tagName?.toLowerCase();
      if (tag && DROP.has(tag)) return;
      if (node.nodeName === "#text") {
        const value = node.value ?? "";
        if (value) {
          buf += value;
          bufEndsInSpace = endsInSpace(value);
        }
        return;
      }
      if (node.nodeName === "#comment") return;
      if (tag === "br" || tag === "hr") {
        buf += " ";
        bufEndsInSpace = true;
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
        for (const b of tableBlocks(tableRows(node))) blocks.push(b);
        return;
      }
      const isBlock = tag !== undefined && BLOCK.has(tag);
      if (isBlock) flush();
      let prevElement = false;
      for (const child of node.childNodes ?? []) {
        if (child.nodeName === "#comment") continue;
        if (isElement(child) && prevElement && buf && !bufEndsInSpace) {
          buf += " ";
          bufEndsInSpace = true;
        }
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
  let outEndsInSpace = false;
  let prevElement = false;
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === "#comment") continue;
    const text = collectText(child);
    const block = BLOCK.has(child.tagName?.toLowerCase() ?? "");
    if (isElement(child) && (prevElement || block) && out && !outEndsInSpace && text && !/^\s/.test(text)) out += " ";
    if (text) {
      out += text;
      outEndsInSpace = endsInSpace(text);
    }
    if (block) {
      out += " ";
      outEndsInSpace = true;
    }
    prevElement = isElement(child);
  }
  return out;
}
