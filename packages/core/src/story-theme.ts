/**
 * What the server adds to a stored Story page for one response, when the web app shows it. The
 * stored HTML is never changed.
 */

/**
 * The attribute the app sets on a Story page's <html> when it shows the page, so the page follows
 * the app's chosen theme rather than only the system's. Without it the page follows the system.
 */
export const THEME_ATTRIBUTE = "data-wb-theme";

/**
 * Mark a stored Story page with the viewer's theme for one response: adds the theme attribute to the
 * page's <html> start tag (or opens one after any doctype and leading comments when the page has
 * none). Only "light" and "dark" are ever written.
 */
export function withStoryTheme(html: string, theme: "light" | "dark"): string {
  const attr = ` ${THEME_ATTRIBUTE}="${theme}"`;
  const lead = /^(?:﻿)?(?:\s+|<!doctype[^>]*>|<!--[\s\S]*?-->)*/i.exec(html)![0];
  const rest = html.slice(lead.length);
  if (/^<html(?=[\s>/])/i.test(rest)) return `${lead}<html${attr}${rest.slice(5)}`;
  return `${lead}<html${attr}>${rest}`;
}

/**
 * The script the app's frame adds to a page it shows. It runs inside the page's sandbox, in the
 * page's opaque origin, and does three things:
 *
 * - Passes F and Esc to the app (focus mode), since keys pressed inside a frame never reach the
 *   page around it. Only the key's name is sent; the app checks the message came from its frame.
 * - Hands a plain click on a link to another page of the same Story to the app, which shows that
 *   page in place: a Story is a set of pages, and a reader moving between them should not collect
 *   tabs. The app tells the frame where its Story lives; only a page's slug is sent back, and the
 *   app checks it. A click with a modifier key, or on any other link, is left alone.
 * - Opens a link that would replace the page inside the frame in a new tab instead, so an ordinary
 *   link to evidence works, and the app never shows another address inside its own frame.
 */
export const FRAME_SCRIPT =
  "(function(){" +
  "var story=null;" +
  "function typing(t){return t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));}" +
  'addEventListener("message",function(e){' +
  'if(e.source===parent&&e.data&&e.data.whatbuild==="story-base"&&typeof e.data.base==="string")story=e.data.base;});' +
  'addEventListener("keydown",function(e){' +
  "if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||typing(e.target))return;" +
  'var k=e.key==="Escape"?"Escape":(e.key==="f"||e.key==="F")?"f":null;' +
  'if(k)parent.postMessage({whatbuild:"story-key",key:k},"*");});' +
  'addEventListener("click",function(e){' +
  'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;' +
  'if(!a||a.getAttribute("href").charAt(0)==="#")return;' +
  'if(story&&!e.defaultPrevented&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&!a.hasAttribute("download")&&a.href.indexOf(story)===0){' +
  "var m=/^([a-z0-9][a-z0-9-]{0,79})\\/?(?:[?#].*)?$/.exec(a.href.slice(story.length));" +
  'if(m){e.preventDefault();parent.postMessage({whatbuild:"story-page",page:m[1]},"*");return;}}' +
  'var t=(a.getAttribute("target")||"").toLowerCase();' +
  'if(!t||t==="_self"||t==="_parent"||t==="_top"){a.setAttribute("target","_blank");a.setAttribute("rel","noopener noreferrer");}' +
  "},true);" +
  "})();";

/** A stored page as the app's frame shows it: its theme, and the frame script at the end of the document. */
export function withStoryFrame(html: string, theme: "light" | "dark" | undefined): string {
  return `${theme ? withStoryTheme(html, theme) : html}\n<script>${FRAME_SCRIPT}</script>`;
}
