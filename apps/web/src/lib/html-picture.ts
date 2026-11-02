import { canvasAsBase64 } from "./video-frame.ts";

/** A picture is drawn of a page this wide and tall, as a window would show its top. */
const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 960;
/** Past this a page is not drawn: it would take the tab a while, and the picture only shows its top. */
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const DRAW_WAIT_MS = 5000;
/** How much a picture's colours must vary, out of 255, for it to show anything. A page that draws white needed what it loads from elsewhere. */
const BLANK_BELOW = 3;
/** What can't draw in a picture, or has no business trying. Nothing here runs or loads anyway: see below. */
const LEFT_OUT = "script, noscript, iframe, frame, frameset, object, embed, applet, link, meta, base, video, audio, source, track, template";

/**
 * A picture of an uploaded HTML page, drawn in the browser, as a JPEG in base64; null when it can't
 * be, or it would be blank. Nothing of the page runs here: `DOMParser` makes an inert document, and
 * a browser draws an SVG used as an image with no scripts and no network. What comes out is only ever
 * pixels, which the server makes its own copies from. The page itself is only ever shown in its
 * sandboxed frame (`attachmentViewUrl`).
 */
export async function pictureOfHtml(html: string): Promise<string | null> {
  if (html.length > PAGE_MAX_BYTES) return null;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const el of doc.querySelectorAll(LEFT_OUT)) el.remove();
    for (const el of doc.body.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const elsewhere = ["src", "srcset", "href", "xlink:href", "background", "poster", "action", "formaction"].includes(name) && !attr.value.startsWith("data:image/");
        if (name.startsWith("on") || elsewhere) el.removeAttribute(attr.name);
      }
    }
    const xml = new XMLSerializer();
    const styles = [...doc.querySelectorAll("style")].map((s) => {
      const text = s.textContent ?? "";
      s.remove();
      // Rules for the page's own root have no root here but this wrapper.
      return `<style xmlns="http://www.w3.org/1999/xhtml">${text.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</style>`;
    });
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}"><foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_WIDTH}px;min-height:${PAGE_HEIGHT}px;background:#fff;color:#000;font:16px serif">${styles.join("")}${xml.serializeToString(doc.body)}</div>` +
      `</foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error("too slow")), DRAW_WAIT_MS))]);
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH;
    canvas.height = PAGE_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.drawImage(image, 0, 0);
    if (isBlank(canvas)) return null;
    return await canvasAsBase64(canvas);
  } catch {
    // Some browsers won't let a page read back what an SVG drew; the page just has no picture.
    return null;
  }
}

function isBlank(canvas: HTMLCanvasElement): boolean {
  const small = document.createElement("canvas");
  small.width = 64;
  small.height = 48;
  const context = small.getContext("2d");
  if (!context) return true;
  context.drawImage(canvas, 0, 0, small.width, small.height);
  const { data } = context.getImageData(0, 0, small.width, small.height);
  let sum = 0;
  let squares = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const v = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    sum += v;
    squares += v * v;
  }
  return Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2)) < BLANK_BELOW;
}
