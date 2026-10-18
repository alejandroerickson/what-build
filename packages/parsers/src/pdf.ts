import { layoutPage, pageBlocks, repeatedLines, type PageLayout, type TextRun } from "./pdf-layout.ts";
import { TooLargeError, type Block, type FormatParser } from "./types.ts";

type TextItem = { str?: string; dir?: string; width?: number; transform?: number[] };

/**
 * PDFs with more pages are stored but not parsed. Reading a page costs time even when it is empty,
 * so a small file of tens of thousands of blank pages would otherwise occupy the parse for minutes.
 */
export const MAX_PDF_PAGES = 2000;

/** The repeated lines the facts name, at most, and the characters of each. */
const MAX_REPEATED_SAID = 20;
const MAX_REPEATED_CHARS = 200;

/**
 * A run's angle, from its text matrix: how far its baseline turns from upright, in radians, and
 * which quarter turn that is (0 upright, 1 reading up the page), or null between quarters.
 */
function angleOf(t: number[]): { angle: number; quarter: number | null } {
  const angle = Math.atan2(t[1] ?? 0, t[0] ?? 1);
  const q = Math.round(angle / (Math.PI / 2));
  return { angle, quarter: Math.abs(angle - (q * Math.PI) / 2) <= 0.02 ? ((q % 4) + 4) % 4 : null };
}

/** A point turned back by `angle`, into the frame of text drawn at that angle. */
function unturn(x: number, y: number, angle: number): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos + y * sin, -x * sin + y * cos];
}

/**
 * A page's runs of text: those at the angle most of its text is drawn at, in the frame they stand
 * upright in, and those at other angles, each angle's in a frame of its own; and the page's
 * bottom and top in the first frame.
 */
function runsOf(items: TextItem[], view: number[]): { upright: TextRun[]; others: TextRun[][]; bottom: number; top: number } {
  const read: { text: string; t: number[]; item: TextItem; angle: number; key: string; order: number }[] = [];
  const weight = new Map<string, number>();
  items.forEach((item, order) => {
    const text = item.str;
    const t = item.transform;
    if (typeof text !== "string" || !text.trim() || !t) return;
    const { angle, quarter } = angleOf(t);
    // A vertical font's runs go down the page whatever their matrix says: they are read apart.
    const key = item.dir === "ttb" ? "ttb" : quarter !== null ? `q${quarter}` : `a${Math.round((angle * 180) / Math.PI)}`;
    read.push({ text, t, item, angle: quarter !== null ? (quarter * Math.PI) / 2 : angle, key, order });
    weight.set(key, (weight.get(key) ?? 0) + text.length);
  });
  let main = "q0";
  for (const [key, w] of weight) if (key !== "ttb" && w > (weight.get(main) ?? 0)) main = key;
  const groups = new Map<string, TextRun[]>();
  for (const { text, t, item, angle, key, order } of read) {
    const [x, y] = unturn(t[4] ?? 0, t[5] ?? 0, key === "ttb" ? 0 : angle);
    const run: TextRun = { text, x, y, width: Math.abs(item.width ?? 0), size: Math.hypot(t[2] ?? 0, t[3] ?? 0) || 1, order, rtl: item.dir === "rtl" };
    const g = groups.get(key);
    if (g) g.push(run);
    else groups.set(key, [run]);
  }
  const angle = read.find((r) => r.key === main)?.angle ?? 0;
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view;
  const ys = [unturn(x0, y0, angle), unturn(x0, y1, angle), unturn(x1, y0, angle), unturn(x1, y1, angle)].map(([, y]) => y);
  return {
    upright: groups.get(main) ?? [],
    others: [...groups].filter(([key]) => key !== main).map(([, runs]) => runs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

/**
 * PDF: the text layer only, per page — a `# Page N` heading, then that page's text laid out as a
 * person reads it (pdf-layout.ts): paragraphs, a table's rows as a table, a label beside its
 * value, and a running header or footer read once, its page numbers left out. No OCR: a PDF with
 * no text layer, a scan's pages being pictures, reports `unsupported`, as an image does (index.ts).
 */
export const pdfParser: FormatParser = {
  name: "pdf",
  version: "5",
  async parse(bytes) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // pdf.js has no limit on what a compressed stream decodes to. It is given the limits it has,
    // and images, which text extraction never needs, are off; the memory and time limits of the
    // thread the server parses in bound the rest.
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      disableFontFace: true,
      maxImageSize: 0,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      useWasm: false,
      enableXfa: false,
      verbosity: 0,
    });
    const pages: PageLayout[] = [];
    let numPages = 0;
    try {
      const doc = await task.promise;
      numPages = doc.numPages;
      if (numPages > MAX_PDF_PAGES) throw new TooLargeError(`the PDF has ${numPages} pages; PDFs over ${MAX_PDF_PAGES} pages are stored but not parsed`);
      for (let pageNo = 1; pageNo <= numPages; pageNo++) {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent();
        const runs = runsOf(content.items as TextItem[], page.view);
        pages.push(layoutPage(runs.upright, runs.others, runs.bottom, runs.top));
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }
    // Headers and footers are known only once every page is read.
    const repeated = repeatedLines(pages);
    const blocks: Block[] = [];
    let textChars = 0;
    let tables = 0;
    pages.forEach((p, i) => {
      blocks.push({ text: `# Page ${i + 1}`, heading_level: 1, page: i + 1 });
      const out = pageBlocks(p, i + 1, repeated.lines);
      for (const b of out.blocks) blocks.push(b);
      textChars += out.chars;
      tables += out.tables;
    });
    return {
      blocks,
      facts: {
        page_count: numPages,
        text_layer_chars: textChars,
        table_count: tables,
        headers_and_footers: repeated.said.slice(0, MAX_REPEATED_SAID).map((s) => (s.length > MAX_REPEATED_CHARS ? `${Array.from(s.slice(0, 2 * MAX_REPEATED_CHARS)).slice(0, MAX_REPEATED_CHARS).join("")}…` : s)),
        headers_and_footers_left_out: repeated.leftOut,
      },
    };
  },
};
