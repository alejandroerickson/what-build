import { SaxesParser } from "saxes";

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

/** Parse an XML document into a small element tree. Namespaced names keep their prefix (`w:p`). */
export function parseXml(source: string): XmlElement {
  const parser = new SaxesParser({ xmlns: false });
  const root: XmlElement = { name: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  parser.on("opentag", (tag) => {
    const el: XmlElement = { name: tag.name, attrs: {}, children: [] };
    for (const [k, v] of Object.entries(tag.attributes as Record<string, string | { value: string }>))
      el.attrs[k] = typeof v === "string" ? v : v.value;
    stack[stack.length - 1]!.children.push(el);
    if (!tag.isSelfClosing) stack.push(el);
  });
  parser.on("closetag", (tag) => {
    if (!tag.isSelfClosing) stack.pop();
  });
  parser.on("text", (t) => {
    stack[stack.length - 1]!.children.push(t);
  });
  parser.on("cdata", (t) => {
    stack[stack.length - 1]!.children.push(t);
  });
  parser.write(source).close();
  return root;
}

export function elements(node: XmlElement, name?: string): XmlElement[] {
  return node.children.filter((c): c is XmlElement => typeof c !== "string" && (!name || c.name === name));
}

export function first(node: XmlElement, name: string): XmlElement | undefined {
  return elements(node, name)[0];
}

export function descendants(node: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (n: XmlElement) => {
    for (const c of n.children) {
      if (typeof c === "string") continue;
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function textOf(node: XmlElement): string {
  return node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}
