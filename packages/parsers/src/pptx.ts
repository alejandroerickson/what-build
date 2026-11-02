import { strFromU8 } from "fflate";
import { tableBlocks } from "./tables.ts";
import { DEFAULT_PARSE_CAP_BYTES, type Block, type FormatParser } from "./types.ts";
import { descendants, elements, first, parseXml, textOf, type XmlElement } from "./xml.ts";
import { unzipParts } from "./zip.ts";

const PRESENTATION = "ppt/presentation.xml";
const PRESENTATION_RELS = "ppt/_rels/presentation.xml.rels";
const THEME = "ppt/theme/theme1.xml";
/** Where a package keeps the picture of itself, as PowerPoint writes it (and some other tools a PNG). */
const THUMBNAILS = ["docProps/thumbnail.jpeg", "docProps/thumbnail.jpg", "docProps/thumbnail.png"];
/** All a deck's facts may unpack to: a picture, its first slide, and how it is put together. */
const FACTS_MAX_BYTES = 32 * 1024 * 1024;

const relsOf = (xml: Uint8Array | undefined): Map<string, { type: string; target: string }> => {
  const out = new Map<string, { type: string; target: string }>();
  if (!xml) return out;
  for (const r of descendants(parseXml(strFromU8(xml)), "Relationship")) {
    const id = r.attrs["Id"];
    const target = r.attrs["Target"];
    if (id && target) out.set(id, { type: r.attrs["Type"] ?? "", target });
  }
  return out;
};

/** A relationship's target as a name in the package, from the folder of the part that names it. */
function partName(from: string, target: string): string {
  const parts = target.startsWith("/") ? [] : from.split("/");
  for (const p of target.replace(/^\//, "").split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

/** The deck's slides as parts of the package, in the order it shows them. */
function slideOrder(presentation: Uint8Array | undefined, rels: Uint8Array | undefined): string[] {
  if (!presentation) throw new Error("not a PowerPoint deck: ppt/presentation.xml is missing");
  const targets = relsOf(rels);
  const ids = descendants(parseXml(strFromU8(presentation)), "p:sldId");
  return ids.flatMap((s) => {
    const target = targets.get(s.attrs["r:id"] ?? "")?.target;
    return target ? [partName("ppt", target)] : [];
  });
}

/** A paragraph's words: its runs, fields and line breaks. */
function paragraphText(p: XmlElement): string {
  let out = "";
  for (const c of elements(p)) {
    if (c.name === "a:r" || c.name === "a:fld") out += first(c, "a:t") ? textOf(first(c, "a:t")!) : "";
    else if (c.name === "a:br") out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

const placeholderOf = (sp: XmlElement) => {
  const nv = first(sp, "p:nvSpPr");
  const nvPr = nv && first(nv, "p:nvPr");
  return nvPr && first(nvPr, "p:ph");
};
const isTitle = (sp: XmlElement) => ["title", "ctrTitle"].includes(placeholderOf(sp)?.attrs["type"] ?? "");

/** A slide's title and what else it says, in the order its shapes are stacked. */
function readSlide(xml: Uint8Array): { title: string | null; blocks: Block[] } {
  const slide = parseXml(strFromU8(xml));
  let title: string | null = null;
  const blocks: Block[] = [];
  const shape = (sp: XmlElement) => {
    const body = first(sp, "p:txBody");
    if (!body) return;
    const paragraphs = elements(body, "a:p");
    if (isTitle(sp) && title === null) {
      title = paragraphs.map(paragraphText).filter(Boolean).join(" ") || null;
      return;
    }
    const listed = Boolean(placeholderOf(sp));
    for (const p of paragraphs) {
      const text = paragraphText(p);
      if (!text) continue;
      const pPr = first(p, "a:pPr");
      const level = Number(pPr?.attrs["lvl"] ?? 0);
      const bullet = !pPr || !first(pPr, "a:buNone");
      blocks.push(listed && bullet ? { text: `${"  ".repeat(Number.isFinite(level) ? level : 0)}- ${text}`, opensWithList: true } : { text });
    }
  };
  const walk = (tree: XmlElement) => {
    for (const c of elements(tree)) {
      if (c.name === "p:sp") shape(c);
      else if (c.name === "p:grpSp") walk(c);
      else if (c.name === "p:graphicFrame") {
        for (const table of descendants(c, "a:tbl")) {
          const rows = elements(table, "a:tr").map((tr) => elements(tr, "a:tc").map((tc) => descendants(tc, "a:p").map(paragraphText).filter(Boolean).join(" ")));
          blocks.push(...tableBlocks(rows));
        }
      }
    }
  };
  const tree = descendants(slide, "p:spTree")[0];
  if (tree) walk(tree);
  return { title, blocks };
}

/** A slide's speaker notes: the body of the notes page its relationships name. */
function notesOf(slide: string, files: Record<string, Uint8Array>): string {
  const folder = slide.split("/").slice(0, -1).join("/");
  const rels = relsOf(files[`${folder}/_rels/${slide.split("/").pop()}.rels`]);
  for (const r of rels.values()) {
    if (!r.type.endsWith("/notesSlide")) continue;
    const xml = files[partName(folder, r.target)];
    if (!xml) continue;
    const notes = parseXml(strFromU8(xml));
    return descendants(notes, "p:sp")
      .filter((sp) => placeholderOf(sp)?.attrs["type"] === "body")
      .flatMap((sp) => descendants(sp, "a:p").map(paragraphText))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** Reads a deck's slides, as Markdown under a heading each, with its speaker notes. Never its pictures. */
export const pptxParser: FormatParser = {
  name: "pptx",
  version: "1",
  parse(bytes, _fileName, options = {}) {
    const files = unzipParts(bytes, (name) => /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/|notesSlides\/)/.test(name), options.maxBytes ?? DEFAULT_PARSE_CAP_BYTES);
    const slides = slideOrder(files[PRESENTATION], files[PRESENTATION_RELS]);
    const blocks: Block[] = [];
    let notes = 0;
    slides.forEach((name, i) => {
      const xml = files[name];
      if (!xml) return;
      const slide = readSlide(xml);
      blocks.push({ text: `## Slide ${i + 1}${slide.title ? `: ${slide.title}` : ""}`, heading_level: 2 });
      blocks.push(...slide.blocks);
      const said = notesOf(name, files);
      if (said) {
        notes++;
        blocks.push({ text: `Notes: ${said}` });
      }
    });
    return { blocks, facts: { slide_count: slides.length, slides_with_notes: notes } };
  },
};

/** How light a colour is, from 0 to 1. */
function lightness(hex: string): number {
  const channel = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** A colour of the deck's theme that white words can be read on: its second dark, else its first accent. */
function themeColour(theme: Uint8Array | undefined): string | null {
  if (!theme) return null;
  const scheme = descendants(parseXml(strFromU8(theme)), "a:clrScheme")[0];
  if (!scheme) return null;
  for (const name of ["a:dk2", "a:accent1"]) {
    const slot = first(scheme, name);
    const hex = slot && first(slot, "a:srgbClr")?.attrs["val"];
    if (hex && /^[0-9a-fA-F]{6}$/.test(hex) && lightness(hex) < 0.2) return hex.toLowerCase();
  }
  return null;
}

/** What a deck's picture needs: the picture it carries of itself, its first slide's title, a colour of its theme and how many slides it has. */
export function deckFacts(bytes: Uint8Array): { thumbnail: Uint8Array | null; title: string | null; colour: string | null; slides: number } {
  const files = unzipParts(bytes, (name) => name === PRESENTATION || name === PRESENTATION_RELS || name === THEME || THUMBNAILS.includes(name), FACTS_MAX_BYTES);
  const slides = slideOrder(files[PRESENTATION], files[PRESENTATION_RELS]);
  const firstSlide = slides[0];
  const slide = firstSlide ? unzipParts(bytes, (name) => name === firstSlide, FACTS_MAX_BYTES)[firstSlide] : undefined;
  const read = slide ? readSlide(slide) : null;
  // With no title placeholder, what the slide says first stands for it.
  const title = read?.title ?? read?.blocks[0]?.text.replace(/^\s*- /, "") ?? null;
  return {
    thumbnail: THUMBNAILS.map((n) => files[n]).find(Boolean) ?? null,
    title: title ? title.slice(0, 200) : null,
    colour: themeColour(files[THEME]),
    slides: slides.length,
  };
}
