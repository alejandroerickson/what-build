/**
 * What the sandbox around an agent-written page allows, by surface: the CSP `sandbox` directive on
 * every response that serves the page (story-html.ts) and the `sandbox` attribute of the web app's
 * frame that shows it, which must agree. Never `allow-same-origin`: a page runs in an opaque origin.
 * Also the name the canvas gives a page's frame, which the frame script reads (story-theme.ts).
 * Kept free of imports so the web app can take it as `@whatbuild/core/page-sandbox`.
 */

/** A Story page, and a style's specimen: its scripts, and links that open a new tab. No forms: the Story is for reading. */
export const STORY_PAGE_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/**
 * A mockup page, on its canvas and on the Story: the same, and forms, so a prototype's submit
 * handler runs. A submission still goes nowhere, since every response that serves a page says
 * `form-action 'none'`.
 */
export const MOCKUP_PAGE_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";

/**
 * An Idea card's front: scripts, for the one script WhatBuild adds (it tells the app how tall the
 * card is). The card's own HTML holds none, and every response that serves a card runs only that
 * script, by its nonce. No popups and no forms: a card is a picture.
 */
export const IDEA_CARD_SANDBOX = "allow-scripts";

/**
 * What a frame is answered when its call is refused for the minute's calls: WhatBuild's own few words
 * and the one script that tells the app. No popups and no forms, so nothing about it is wider than
 * any frame it lands in. A preview's frame, which runs no script, gets the same words with none.
 */
export const REFUSED_FRAME_SANDBOX = "allow-scripts";

/**
 * The name the canvas gives each page's frame. The frame script reads it as soon as the page runs,
 * so a page on the canvas keeps a pinch or ⌘/Ctrl with scroll from zooming the browser from the
 * start, before the app has greeted it. A prototype's next document in the same frame keeps it too.
 */
export const CANVAS_FRAME_NAME = "whatbuild-canvas-page";

/** What a mockup's pages can do once they are saved and opened outside this sandbox: said with every download, and in the ZIP's index.html. */
export const OUTSIDE_THE_SANDBOX = "These pages can run their own code when opened outside WhatBuild. Only open them if you trust where they came from.";

/** The least and most a mockup page's frame is tall, in CSS pixels, given or measured. */
export const PAGE_HEIGHT_MIN = 240;
export const PAGE_HEIGHT_MAX = 4000;

/**
 * A mockup page whose height is "auto" takes its content's: the frame opens PAGE_HEIGHT_MIN tall, the
 * frame script reports the document's height (`page-height`), and the frame grows to it, up to
 * PAGE_HEIGHT_MAX. It only grows, since a document is never reported shorter than its frame. A page
 * that grew by what its frame last grew, or twice that, as a page with one or two sections 100vh
 * tall does, stops it growing: such a page outgrows any frame, so the frame keeps the height it had.
 * Content that grows by itself, as a script draws more, is followed.
 */
export function nextAutoHeight(frame: number, reported: number, last: { from: number; to: number; reported: number } | null): { height: number; stop?: true } | null {
  if (last && frame === last.to && last.to > last.from) {
    const grew = last.to - last.from;
    const times = Math.round((reported - last.reported) / grew);
    if (times >= 1 && Math.abs(reported - last.reported - times * grew) <= 2) return { height: frame, stop: true };
  }
  const height = Math.min(PAGE_HEIGHT_MAX, Math.max(PAGE_HEIGHT_MIN, Math.ceil(reported)));
  return height > frame ? { height } : null;
}

/** A mockup page's height as answers give it: its frame's, or "auto" for its content's. */
export const shownHeight = (p: { height: number; height_auto: boolean }): number | "auto" => (p.height_auto ? "auto" : p.height);
