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
 * page's opaque origin, and does five things:
 *
 * - Passes F and Esc (focus mode), the left and right arrows (flipping through the Story's
 *   mockup pages) and 2 and 3 (fitting a mockup page to the screen or filling its width) to the app, since keys pressed inside a frame never reach the page around
 *   it. Only the key's name is sent; the app checks the message came from its frame. A key the
 *   page itself handled (its default prevented) is not passed on.
 * - Hands a plain click on a link to another page of the same Story to the app, which shows that
 *   page in place: a Story is a set of pages, and a reader moving between them should not collect
 *   tabs. The app tells the frame where its Story lives; only a page's slug is sent back, and the
 *   app checks it. A click with a modifier key, or on any other link, is left alone.
 * - Points a link into the product being read, written with another deployment's address, at this
 *   one (the app tells the frame its product's address), so a page on a copy of a deployment never
 *   sends the reader to the original's records. A root-relative link (/t/…) goes to the app too:
 *   on a page served from a content site it would otherwise open that site.
 * - Opens a link that would replace the page inside the frame in a new tab instead, so an ordinary
 *   link to evidence works, and the app never shows another address inside its own frame.
 * - On a mockup's canvas (the app says so), passes on the canvas's keys too, Space held and let go
 *   (and keeps it from scrolling the page), a pinch or ⌘/Ctrl with scroll (and keeps the browser from
 *   zooming), and a press on the page, which selects it: once a person works inside a page, the
 *   canvas around it would otherwise hear nothing.
 *
 * Says it has loaded (frame-ready), once its document's load event comes, so the app tells the
 * documents it framed from whatever replaced them: a page that sends its frame elsewhere while it
 * is still loading never reaches its own load event, and the app puts it back.
 *
 * In a mockup's prototype (frameScript with its address), a link into the prototype is left to
 * navigate the frame, as the prototype's own links do at home; on the app's origin one with a
 * target opens in the frame too, since a prototype's document is never served at the top level
 * there. Each of its documents says it has loaded in the same way.
 *
 * On a canvas a relative link names another of its pages, as files side by side in a folder do
 * (canvas-links.ts): the script sends the page's name and the app checks it against the version's
 * pages, then moves there. A mockup page shown alone on the Story does the same when the app says so
 * (page-links), and the app takes the name to the Story page that shows it. A click with a modifier key does the same, since a new tab would have
 * no address for another page of the canvas. In a prototype, a link to a document another canvas page enters does the
 * same; any other link stays in the frame.
 *
 * Says, at most every half minute, that someone is using the frame (frame-active): a page they read
 * or press in a frame shows the app nothing, and a tab no one is using stops listening for changes
 * (apps/web/src/lib/live.tsx).
 */
export function frameScript(prototype?: { base: string; inPlace: boolean }): string {
  const proto = prototype ? JSON.stringify(prototype.base).replace(/</g, "\\u003c") : "null";
  return (
  "(function(){" +
  `var story=null,canvas=false,pages=false,entries=null,home=null,proto=${proto},inPlace=${prototype?.inPlace ? "true" : "false"};` +
  "function typing(t){return t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));}" +
  'function relative(u){u=u.trim();return !!u&&u.charAt(0)!=="#"&&u.charAt(0)!=="/"&&!/^[a-z][a-z0-9+.-]*:/i.test(u);}' +
  'function send(m){parent.postMessage(m,"*");}' +
  'var used=0;function using(){var n=Date.now();if(n-used<30000)return;used=n;send({whatbuild:"frame-active"});}' +
  '["pointerdown","keydown","wheel","touchstart","scroll"].forEach(function(t){addEventListener(t,using,{capture:true,passive:true});});' +
  'addEventListener("message",function(e){' +
  "if(e.source!==parent||!e.data)return;" +
  'if(e.data.whatbuild==="story-base"&&typeof e.data.base==="string")story=e.data.base;' +
  'if(e.data.whatbuild==="app-home"&&typeof e.data.home==="string")home=/^(https?:\\/\\/[^\\/?#]+)(\\/[^?#]*)$/i.exec(e.data.home);' +
  'if(e.data.whatbuild==="page-links")pages=true;' +
  'if(e.data.whatbuild==="canvas-host"){canvas=true;if(e.data.entries&&typeof e.data.entries==="object")entries=e.data.entries;}' +
  'if(e.data.whatbuild==="canvas-hash"&&typeof e.data.hash==="string"){var at=document.getElementById(e.data.hash);if(at)at.scrollIntoView();}});' +
  'addEventListener("keydown",function(e){' +
  "if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||typing(e.target))return;" +
  'var k=e.key==="Escape"||e.key==="ArrowLeft"||e.key==="ArrowRight"||e.key==="2"||e.key==="3"?e.key:(e.key==="f"||e.key==="F")?"f":canvas&&/^[ hHvV01+=_-]$/.test(e.key)?e.key:null;' +
  "if(!k)return;" +
  'if(k===" ")e.preventDefault();' +
  'send({whatbuild:"story-key",key:k});});' +
  'addEventListener("keyup",function(e){if(canvas&&e.key===" ")send({whatbuild:"canvas-keyup",key:" "});});' +
  'addEventListener("wheel",function(e){' +
  "if(!canvas||!(e.ctrlKey||e.metaKey))return;" +
  "e.preventDefault();" +
  'send({whatbuild:"canvas-zoom",x:e.clientX,y:e.clientY,dy:e.deltaY,line:e.deltaMode===1,pinch:e.ctrlKey&&!e.metaKey});},{passive:false});' +
  'addEventListener("pointerdown",function(){if(canvas)send({whatbuild:"canvas-select"});},true);' +
  // On a canvas a link to another of its pages is the canvas's to follow, unless the page dealt with the click itself: after every handler the page has.
  'addEventListener("click",function(e){' +
  'if(!(canvas||pages)||e.defaultPrevented||e.button!==0)return;' +
  'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;' +
  'if(!a||a.hasAttribute("download"))return;' +
  'var r=a.getAttribute("href"),h=r.split("#")[1]||"",n=null;' +
  'if(proto){if(!entries||a.href.indexOf(proto)!==0)return;var p=a.href.slice(proto.length).split(/[?#]/)[0];try{p=decodeURIComponent(p);}catch(_){return;}n=Object.prototype.hasOwnProperty.call(entries,p)?entries[p]:null;if(!n)return;}' +
  'else{if(!relative(r))return;n=r.split(/[?#]/)[0].split("/").pop().replace(/\\.html?$/i,"");if(!n)return;}' +
  'e.preventDefault();send({whatbuild:"canvas-page",page:n,hash:h});});' +
  // A new tab has no address for another page of a canvas: the frame's own would be an error.
  'addEventListener("auxclick",function(e){' +
  'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;' +
  'if((canvas||pages)&&!proto&&a&&e.button===1&&relative(a.getAttribute("href")))e.preventDefault();});' +
  'addEventListener("click",function(e){' +
  'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;' +
  'if(!a||a.getAttribute("href").charAt(0)==="#")return;' +
  'if(proto&&a.href.indexOf(proto)===0){if(inPlace&&a.hasAttribute("target"))a.setAttribute("target","_self");return;}' +
  'if((canvas||pages)&&!proto&&relative(a.getAttribute("href")))return;' +
  'var h=home&&/^(https?:\\/\\/[^\\/?#]+)(\\/[^?#]*)?/i.exec(a.href);' +
  'if(h&&h[1].toLowerCase()!==home[1].toLowerCase()&&(h[2]===home[2]||(h[2]||"").indexOf(home[2]+"/")===0))a.href=home[1]+a.href.slice(h[1].length);' +
  'var r=a.getAttribute("href");' +
  'if(home&&r.charAt(0)==="/"&&r.charAt(1)!=="/")a.href=home[1]+r;' +
  'if(story&&!e.defaultPrevented&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&!a.hasAttribute("download")&&a.href.indexOf(story)===0){' +
  "var m=/^([a-z0-9][a-z0-9-]{0,79})\\/?(?:[?#].*)?$/.exec(a.href.slice(story.length));" +
  'if(m){e.preventDefault();parent.postMessage({whatbuild:"story-page",page:m[1]},"*");return;}}' +
  'var t=(a.getAttribute("target")||"").toLowerCase();' +
  'if(!t||t==="_self"||t==="_parent"||t==="_top"){a.setAttribute("target","_blank");a.setAttribute("rel","noopener noreferrer");}' +
  "},true);" +
  // Said once this document has loaded: a document that replaced it while it loaded never says so, and is put back.
  'addEventListener("load",function(){send({whatbuild:"frame-ready"});},true);' +
  "})();"
  );
}

/** The script the app's frame adds to a page it shows (frameScript, without a prototype). */
export const FRAME_SCRIPT = frameScript();

/** A stored page as the app's frame shows it: its theme, and the frame script at the end of the document. */
export function withStoryFrame(html: string, theme: "light" | "dark" | undefined): string {
  return `${theme ? withStoryTheme(html, theme) : html}\n<script>${FRAME_SCRIPT}</script>`;
}

/** A prototype's HTML document as the prototype route serves it: the frame script for its address at the end. */
export function withPrototypeFrame(html: string, base: string, inPlace: boolean): string {
  return `${html}\n<script>${frameScript({ base, inPlace })}</script>`;
}
