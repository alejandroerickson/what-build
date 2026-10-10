import type { Block, FormatParser } from "./types.ts";

type TextItem = { str: string; hasEOL?: boolean; transform?: number[] };

/**
 * PDF: the text layer only, per page — a `# Page N` heading segment, then that page's text.
 * No OCR: a scanned PDF with no text layer keeps almost nothing and reports `failed`.
 */
export const pdfParser: FormatParser = {
  name: "pdf",
  version: "2",
  async parse(bytes) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const doc = await task.promise;
    const blocks: Block[] = [];
    let textChars = 0;
    try {
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
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
    return { blocks, facts: { page_count: doc.numPages, text_layer_chars: textChars } };
  },
};
