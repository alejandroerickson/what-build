/**
 * What the sandbox around an agent-written page allows, by surface: the CSP `sandbox` directive on
 * every response that serves the page (story-html.ts) and the `sandbox` attribute of the web app's
 * frame that shows it, which must agree. Never `allow-same-origin`: a page runs in an opaque origin.
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
