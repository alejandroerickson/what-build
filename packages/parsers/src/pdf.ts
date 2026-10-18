import { TooLargeError, type Block, type FormatParser } from "./types.ts";

type TextItem = { str: string; hasEOL?: boolean; transform?: number[] };

/**
 * PDFs with more pages are stored but not parsed. Reading a page costs time even when it is empty,
 * so a small file of tens of thousands of blank pages would otherwise occupy the parse for minutes.
 */
export const MAX_PDF_PAGES = 2000;

/**
 * PDF: the text layer only, per page — a `# Page N` heading segment, then that page's text.
 * No OCR: a PDF with no text layer, a scan's pages being pictures, reports `unsupported`, as an
 * image does (index.ts).
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
    const blocks: Block[] = [];
    let textChars = 0;
    let numPages = 0;
    try {
      const doc = await task.promise;
      numPages = doc.numPages;
      if (numPages > MAX_PDF_PAGES) throw new TooLargeError(`the PDF has ${numPages} pages; PDFs over ${MAX_PDF_PAGES} pages are stored but not parsed`);
      for (let pageNo = 1; pageNo <= numPages; pageNo++) {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent();
        const lines: string[] = [];
        let line = "";
        let lastY: number | null = null;
        for (const raw of content.items as TextItem[]) {
          if (typeof raw.str !== "string") continue;
          const y = raw.transform?.[5] ?? null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line.trim()) {
            lines.push(line.trim());
            line = "";
          }
          line += raw.str;
          if (raw.hasEOL) {
            if (line.trim()) lines.push(line.trim());
            line = "";
          }
          lastY = y;
        }
        if (line.trim()) lines.push(line.trim());
        blocks.push({ text: `# Page ${pageNo}`, heading_level: 1, page: pageNo });
        // Group lines into paragraphs: a line ending in sentence punctuation closes a paragraph.
        let para: string[] = [];
        const flush = () => {
          const t = para.join(" ").replace(/\s+/g, " ").trim();
          if (t) {
            blocks.push({ text: t, page: pageNo });
            textChars += t.length;
          }
          para = [];
        };
        for (const l of lines) {
          para.push(l);
          if (/[.!?:;]["')\]]?$/.test(l)) flush();
        }
        flush();
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }
    return { blocks, facts: { page_count: numPages, text_layer_chars: textChars } };
  },
};
