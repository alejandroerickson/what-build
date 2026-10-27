/**
 * An Idea card: the product concept, or one outcome. Its front is a picture of the idea that people
 * see first and a newcomer takes in at a glance; its back is the concept's or the outcome's text,
 * which agents read in depth and people open under the card's title with More info, above the
 * picture. Agents write both sides together.
 *
 * A front is agent-written HTML, only the markup inside the card (html-rules.ts holds it to its
 * rules at write). This module is what WhatBuild puts around it when the app shows it: a document
 * with the card kit (the stylesheet whose parts a front is drawn from, in the app's own type and
 * greys), the pictograms the front names, the viewer's theme, and one script of WhatBuild's own
 * that tells the app how tall the card is. The kit, its reference for agents, the advice a write
 * returns and the frame sizes live here too, so the stylesheet and what agents are told about it
 * never drift apart.
 */

import { readFileSync } from "node:fs";
import { CARD_ICONS } from "./idea-card-icons.ts";
import { CARD_HTML_MAX, inspectCardHtml } from "./html-rules.ts";
import { PERMISSIONS_POLICY, escapeHtml } from "./story-html.ts";
import { THEME_ATTRIBUTE } from "./story-theme.ts";
import { invalid } from "./errors.ts";

export { CARD_HTML_MAX };

/** The names a front may give data-icon. */
export const CARD_ICON_NAMES: ReadonlySet<string> = new Set(Object.keys(CARD_ICONS));

/** Check a front at write: every problem, or none. */
export function inspectIdeaCard(html: string): string[] {
  return inspectCardHtml(html, CARD_ICON_NAMES);
}

/** Refuse a front that breaks the rules, listing every problem at once. */
export function checkIdeaCard(html: string | undefined, what: string) {
  if (!html) return;
  const problems = inspectIdeaCard(html);
  if (problems.length)
    throw invalid("invalid_card", `${what}'s front breaks ${problems.length === 1 ? "a rule" : `${problems.length} rules`}: ${problems.join(" ")}`, { problems });
}

/**
 * The two sides of a card change together. A write that changes the back (the text agents read)
 * sends the front too, and one that changes the front sends the back, each unchanged if it still
 * agrees, so whoever changes one has looked at the other. A card with no front yet may have its back
 * changed alone.
 */
export function checkCardSides(
  sides: { back: string; front: string },
  input: { back?: string; front?: string },
  names: { what: string; back: string; read: string },
) {
  const backChanged = input.back !== undefined && input.back !== sides.back;
  const frontChanged = input.front !== undefined && input.front !== sides.front;
  if (backChanged && input.front === undefined && sides.front)
    throw invalid(
      "card_sides_together",
      `${names.what}'s card has two sides, written together: this changes the back (${names.back}) but does not send the front (card_html). Send card_html too, unchanged if it still agrees with the new text; ${names.read} returns both.`,
      { missing: "card_html" },
    );
  if (frontChanged && input.back === undefined)
    throw invalid(
      "card_sides_together",
      `${names.what}'s card has two sides, written together: this changes the front (card_html) but does not send the back (${names.back}). Send ${names.back} too, unchanged if it still agrees with the new front; ${names.read} returns both.`,
      { missing: names.back },
    );
}

/**
 * The room a front has: the width it shows at on a desktop, the narrowest and widest it shows at
 * (a phone; a narrow window), and the most height it shows before it scrolls inside its card. Every
 * card on the Idea screen is the content's width, one under another. The web app's Idea screen
 * keeps to the same heights.
 */
export const CARD_FRAMES = {
  concept: { width: 900, min_width: 340, max_width: 900, max_height: 560 },
  outcome: { width: 900, min_width: 340, max_width: 900, max_height: 560 },
} as const;

/** About how many words of text a front holds before it reads as a paragraph rather than a picture. */
const FRONT_WORDS = { concept: 80, outcome: 40 } as const;

/** The words a front shows: its text, without markup, styles or comments. */
function frontWords(html: string): string[] {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** What sets a front's colours: its style blocks, style attributes and SVG paint, without data: URIs. */
function styling(html: string): string {
  const found = [
    ...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi),
    ...html.matchAll(/\s(?:style|fill|stroke|color|stop-color|flood-color|lighting-color)\s*=\s*("[^"]*"|'[^']*')/gi),
  ].map((m) => m[1]!);
  return found.join(" ").replace(/data:[^"')\s]+/gi, "");
}

/** Text compared loosely: lower case, letters and digits only. */
function loose(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Advice on a card that was written: what the guidance asks that WhatBuild can check, and the card
 * misses. It never refuses a write; the response carries it as card_advice, for the agent to fix
 * with an update.
 */
export function adviseIdeaCard(card: { kind: "concept" | "outcome"; front: string; back?: string; title?: string }): string[] {
  const { kind, front, back } = card;
  if (!front.trim()) return [];
  const advice: string[] = [];
  const words = frontWords(front).length;
  const most = FRONT_WORDS[kind];
  if (words > most * 1.5)
    advice.push(`The front has ${words} words, which people read as a paragraph rather than take in at a glance; ${kind === "concept" ? "the concept's" : "an outcome's"} front holds about ${most}. Keep labels to two to five words and move the rest to the back.`);
  if (kind === "outcome" && card.title && loose(card.title).length >= 12 && loose(frontWords(front).join(" ")).includes(loose(card.title)))
    advice.push("The front repeats the outcome's title, which the card's head already shows. Use the room for the picture.");
  if (!/class\s*=\s*["'][^"']*\bwb-/i.test(front))
    advice.push("The front uses none of the kit's parts (wb-…), so it does not look like the other cards. Draw it with them; card_guidance lists them.");
  if (kind === "concept" && !/\bwb-pitch\b/.test(front)) advice.push("The concept's front has no wb-pitch: lead with the product's promise in one line.");
  const hues = new Set([...front.matchAll(/data-hue\s*=\s*["']?([a-z]+)/gi)].map((m) => m[1]!.toLowerCase()).filter((h) => h !== "slate" && h !== "rose"));
  if (hues.size > 1)
    advice.push(`The front uses ${hues.size} hues (${[...hues].join(", ")}). Keep to one for the product's way, with slate for today and rose only for what hurts.`);
  if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i.test(styling(front)))
    advice.push("The front sets fixed colours, which do not follow the reader's light or dark theme. Use data-hue and the kit's variables (var(--hue-ink), var(--hue-fill), var(--hue-line), var(--muted)).");
  if (back !== undefined && !back.trim())
    advice.push(`The back is empty, so agents have nothing to work from and More info shows nothing. Write the ${kind === "concept" ? "concept" : "outcome"} in depth in ${kind === "concept" ? "concept" : "description"}.`);
  return advice;
}

/* ---- The kit's palette ------------------------------------------------------------------------- */

/**
 * The hues a part may take with data-hue, each as a soft fill, ink for text and pictograms on it
 * (4.5:1 or more on its fill and on the card), a line, and a solid for marks and filled nodes. Slate
 * is the neutral one, for how things are today. The default hue is indigo, the app's accent.
 */
const HUES = ["indigo", "teal", "amber", "rose", "green", "sky", "slate"] as const;
type Hue = (typeof HUES)[number];
type Swatch = { fill: string; ink: string; line: string; solid: string };

const LIGHT: { base: Record<string, string>; hues: Record<Hue, Swatch> } = {
  base: { bg: "#ffffff", ink: "#1e1e1e", muted: "#555555", faint: "#666666", line: "#e6e6e6", "line-2": "#d5d5d5", wash: "#f4f4f4", "on-solid": "#ffffff" },
  hues: {
    indigo: { fill: "#ecebfd", ink: "#3a33b8", line: "#bdb9f7", solid: "#5a53e8" },
    teal: { fill: "#dcf2ee", ink: "#0b5d54", line: "#9fd7cd", solid: "#0d7f70" },
    amber: { fill: "#fcefd8", ink: "#7a4700", line: "#efcb8d", solid: "#9a6100" },
    rose: { fill: "#fce6e8", ink: "#9a2234", line: "#f2b6be", solid: "#c93d52" },
    green: { fill: "#e1f3e6", ink: "#0f6a3a", line: "#a9dab8", solid: "#167c44" },
    sky: { fill: "#e1eefb", ink: "#164f86", line: "#abcef0", solid: "#2470bd" },
    slate: { fill: "#f0f0f0", ink: "#3b3b3b", line: "#cfcfcf", solid: "#5f5f5f" },
  },
};

const DARK: typeof LIGHT = {
  base: { bg: "#2a2a2a", ink: "#ededed", muted: "#bdbdbd", faint: "#adadad", line: "#383838", "line-2": "#474747", wash: "#323232", "on-solid": "#1b1b1b" },
  hues: {
    indigo: { fill: "#2e2d47", ink: "#c9c6ff", line: "#4a4790", solid: "#8b85ff" },
    teal: { fill: "#1d3b37", ink: "#8fe0d2", line: "#2f6b62", solid: "#4fc8b6" },
    amber: { fill: "#3d3120", ink: "#f0c87e", line: "#6e5530", solid: "#f0b95e" },
    rose: { fill: "#45262b", ink: "#ffadb8", line: "#7a3f48", solid: "#ff8b9a" },
    green: { fill: "#1f3a29", ink: "#8ddcaa", line: "#33664a", solid: "#62d394" },
    sky: { fill: "#1f3347", ink: "#9cc9f3", line: "#345a80", solid: "#7db8f0" },
    slate: { fill: "#363636", ink: "#dedede", line: "#555555", solid: "#9a9a9a" },
  },
};

function themeVars(t: typeof LIGHT): string {
  const base = Object.entries(t.base).map(([k, v]) => `--${k}:${v};`).join("");
  const hues = HUES.map((h) => Object.entries(t.hues[h]).map(([k, v]) => `--${h}-${k}:${v};`).join("")).join("");
  return base + hues;
}

/* ---- Pictograms -------------------------------------------------------------------------------- */

function iconUrl(inner: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The marks the kit itself draws: arrows between parts, a comparison's yes, no and partly, a quote. */
const KIT_MARKS: Record<string, string> = {
  "arrow-right": CARD_ICONS["arrow-right"]!,
  "arrow-down": CARD_ICONS["arrow-down"]!,
  yes: CARD_ICONS["check"]!,
  no: CARD_ICONS["x"]!,
  partly: '<path d="M5 12h14"/>',
  quote: CARD_ICONS["quote"]!,
  note: CARD_ICONS["corner-down-right"]!,
};

/** A dashed ring with four clockwise heads, the track a loop's stages sit on, drawn as a mask. */
const RING = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="50" cy="50" r="40" stroke-dasharray="2.4 3.2"/>' +
    '<path d="M76.3 20.1l2.3 4.1-4.6.4M79.9 76.3l-4.1 2.3-.4-4.6M23.7 79.9l-2.3-4.1 4.6-.4M20.1 23.7l4.1-2.3.4 4.6"/></svg>',
)}")`;

/** Rules giving --wb-icon to each element whose data-icon names one of these pictograms. */
function iconRules(names: Iterable<string>): string {
  return [...names].filter((n) => CARD_ICONS[n]).map((n) => `[data-icon="${n}"]{--wb-icon:${iconUrl(CARD_ICONS[n]!)}}`).join("\n");
}

/** The pictograms a front names, so a card carries only those. */
export function cardIconsNamed(html: string): string[] {
  return [...new Set([...html.matchAll(/data-icon\s*=\s*["']?([a-z0-9-]+)/gi)].map((m) => m[1]!.toLowerCase()))].filter((n) => CARD_ICONS[n]);
}

/* ---- The kit ----------------------------------------------------------------------------------- */

const FONT_STACK = `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/**
 * The card kit. Every part is a class (wb-…) on ordinary elements; data-hue on any element sets the
 * hue it and what it holds are drawn in; data-icon gives an element a pictogram, which .wb-icon and
 * the parts with a node (flow steps, people, chips) draw. Widths answer to the card itself: the
 * card's frame is the viewport, so a part restacks when the card is narrow.
 */
export const CARD_KIT_CSS = `
:root{${themeVars(LIGHT)}color-scheme:light;
--hue-fill:var(--indigo-fill);--hue-ink:var(--indigo-ink);--hue-line:var(--indigo-line);--hue-solid:var(--indigo-solid);
--gap:16px;--pad:22px;--font:${FONT_STACK};
${Object.entries(KIT_MARKS).map(([k, v]) => `--wb-mark-${k}:${iconUrl(v)};`).join("")}--wb-ring:${RING};}
html[${THEME_ATTRIBUTE}="dark"]{${themeVars(DARK)}color-scheme:dark}
@media (prefers-color-scheme:dark){html:not([${THEME_ATTRIBUTE}="light"]){${themeVars(DARK)}color-scheme:dark}}
${HUES.map((h) => `[data-hue="${h}"]{--hue-fill:var(--${h}-fill);--hue-ink:var(--${h}-ink);--hue-line:var(--${h}-line);--hue-solid:var(--${h}-solid)}`).join("\n")}
@media (max-width:520px){:root{--gap:14px;--pad:16px}}

*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
body{margin:0;background:var(--bg);color:var(--ink);font:400 13.5px/1.5 var(--font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:var(--indigo-fill);color:var(--indigo-ink)}
h1,h2,h3,h4,p,ul,ol,dl,dd,figure,blockquote{margin:0}
h1,h2{font-size:17px;font-weight:600;line-height:1.3;letter-spacing:-0.012em;text-wrap:balance}
h3,h4{font-size:14px;font-weight:600;line-height:1.3}
p{max-width:68ch;text-wrap:pretty}
b,strong{font-weight:600}
small{font-size:12px;color:var(--muted)}
ul,ol{padding-left:1.25em}
li+li{margin-top:2px}
svg{max-width:100%}

/* The card: its parts in a column. */
.wb-card{display:flex;flex-direction:column;gap:var(--gap);padding:var(--pad)}
.wb-card>*{min-width:0}

/* Words: the one-line promise, the line under it, a label, an inline mark, a number. */
.wb-pitch{font-size:clamp(19px,4vw,28px);font-weight:600;line-height:1.16;letter-spacing:-0.024em;max-width:26ch;text-wrap:balance}
.wb-pitch em,.wb-mark{font-style:normal;color:inherit;padding:0 .12em;margin:0 -.04em;background:linear-gradient(100deg,transparent .08em,color-mix(in srgb,var(--hue-solid) 30%,transparent) .22em,color-mix(in srgb,var(--hue-solid) 26%,transparent) calc(100% - .3em),transparent calc(100% - .1em)) 0 80%/100% .62em no-repeat;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.wb-lede{font-size:15px;line-height:1.5;color:var(--muted);max-width:62ch}
.wb-pitch+.wb-lede{margin-top:calc(8px - var(--gap))}
.wb-label{font-size:12px;font-weight:500;color:var(--faint);line-height:1.3}
.wb-num{font-weight:600;font-variant-numeric:tabular-nums;color:var(--hue-ink);letter-spacing:-0.01em}

/* Layout: a row that wraps, and columns that fall to one when the card is narrow. */
.wb-row{display:flex;flex-wrap:wrap;gap:var(--gap);align-items:flex-start}
.wb-row>*{flex:1 1 200px;min-width:0}
.wb-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:var(--gap);align-items:start}
.wb-split>*{min-width:0}
.wb-zone{border-radius:8px;padding:14px 16px;background:var(--hue-fill);color:var(--hue-ink)}
.wb-zone>*+*{margin-top:8px}
.wb-zone :where(p,li,small){color:inherit}

/* A pictogram: data-icon on the same element names it. */
.wb-icon{display:inline-block;width:1.15em;height:1.15em;flex:none;vertical-align:-0.2em;background:currentColor;-webkit-mask:var(--wb-icon) center/contain no-repeat;mask:var(--wb-icon) center/contain no-repeat}

/* Chips: short labels, in a hue, with an optional pictogram. */
.wb-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0;list-style:none}
.wb-chips>li{margin:0}
.wb-chip{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:3px 10px;border-radius:999px;background:var(--hue-fill);color:var(--hue-ink);font-size:12.5px;font-weight:500;line-height:1.3}
.wb-chip[data-icon]::before{content:"";width:13px;height:13px;flex:none;background:currentColor;-webkit-mask:var(--wb-icon) center/contain no-repeat;mask:var(--wb-icon) center/contain no-repeat}

/* People: who the product is for, each a pictogram, a name for them, and what they need. */
.wb-who{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px 18px;padding:0;list-style:none}
.wb-who>li{position:relative;margin:0;min-height:40px;padding-left:50px;font-size:13px;line-height:1.4;color:var(--muted)}
.wb-who>li>b{display:block;font-size:14.5px;color:var(--ink);margin-bottom:1px}
/* Lines in parts break without leaving a word alone on the last. */
.wb-who>li,.wb-flow>li,.wb-timeline>li,.wb-chip{text-wrap:balance}
.wb-before ul>li,.wb-after ul>li,.wb-note{text-wrap:pretty}
.wb-who>li::before{content:"";position:absolute;left:0;top:0;width:40px;height:40px;border-radius:50%;background:var(--hue-fill)}
.wb-who>li::after{content:"";position:absolute;left:11px;top:11px;width:18px;height:18px;background:var(--hue-ink);-webkit-mask:var(--wb-icon,var(--wb-mark-partly)) center/contain no-repeat;mask:var(--wb-icon,var(--wb-mark-partly)) center/contain no-repeat}

/* A flow: steps in order, each a node on a line with an arrow to the next. is-pain marks a step
   that hurts, is-new one the product brings; a flow in a "before" side is drawn in slate. */
.wb-flow{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);padding:0;list-style:none;counter-reset:wb-step}
.wb-flow>li{counter-increment:wb-step;position:relative;margin:0;padding:50px 8px 0;display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;font-size:13px;line-height:1.35;color:var(--muted);
background-image:conic-gradient(from 225deg at 100% 50%,var(--hue-line) 0 90deg,transparent 0),linear-gradient(var(--hue-line),var(--hue-line));
background-repeat:no-repeat;background-size:7px 10px,100% 1.5px;background-position:right 15px,0 19.25px}
.wb-flow>li:first-child{background-size:7px 10px,50% 1.5px;background-position:right 15px,right 19.25px}
.wb-flow>li:last-child{background-image:linear-gradient(var(--hue-line),var(--hue-line));background-size:50% 1.5px;background-position:left 19.25px}
.wb-flow>li:only-child{background:none}
.wb-flow>li>b{font-size:14.5px;color:var(--ink);line-height:1.3}
.wb-flow>li::before{content:"";position:absolute;top:0;left:50%;width:40px;height:40px;margin-left:-20px;border-radius:50%;background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--hue-line),0 0 0 4px var(--bg)}
.wb-flow>li::after{content:counter(wb-step);position:absolute;top:0;left:50%;width:40px;height:40px;margin-left:-20px;display:grid;place-items:center;font-size:13px;font-weight:600;color:var(--hue-ink);font-variant-numeric:tabular-nums}
.wb-flow>li[data-icon]::after{content:"";top:11px;width:18px;height:18px;margin-left:-9px;background:var(--hue-ink);-webkit-mask:var(--wb-icon) center/contain no-repeat;mask:var(--wb-icon) center/contain no-repeat}
.wb-flow>li.is-new::before,.wb-flow>li.is-us::before{background:var(--hue-solid);box-shadow:0 0 0 4px var(--bg)}
.wb-flow>li.is-new::after,.wb-flow>li.is-us::after{color:var(--on-solid)}
.wb-flow>li.is-new[data-icon]::after,.wb-flow>li.is-us[data-icon]::after{background:var(--on-solid)}
.wb-flow>li.is-pain{--hue-line:var(--rose-line);--hue-ink:var(--rose-ink);--hue-fill:var(--rose-fill)}
.wb-flow>li.is-pain>b{color:var(--rose-ink)}
.wb-flow>li.is-pain::before{background:var(--rose-fill);box-shadow:inset 0 0 0 1.5px var(--rose-line),0 0 0 4px var(--bg)}
@media (max-width:400px){
  .wb-flow{grid-auto-flow:row;grid-auto-columns:auto;gap:0}
  .wb-flow>li,.wb-flow>li:first-child,.wb-flow>li:last-child{align-items:flex-start;text-align:left;padding:9px 0 14px 54px;min-height:56px;
    background-image:linear-gradient(var(--hue-line),var(--hue-line));background-size:1.5px 100%;background-position:19.25px 0}
  .wb-flow>li:first-child{background-size:1.5px calc(100% - 20px);background-position:19.25px 20px}
  .wb-flow>li:last-child{background-size:1.5px 20px;background-position:19.25px 0}
  .wb-flow>li:only-child{background:none}
  .wb-flow>li::before,.wb-flow>li::after{left:0;margin-left:0}
  .wb-flow>li[data-icon]::after{left:11px;margin-left:0}
}

/* A shift: how things are today, and how they are with the product. */
.wb-shift{display:grid;grid-template-columns:minmax(0,1fr) 22px minmax(0,1fr);gap:10px;align-items:stretch}
.wb-shift::before{content:"";grid-area:1/2;align-self:center;width:22px;height:22px;background:var(--hue-ink);-webkit-mask:var(--wb-mark-arrow-right) center/contain no-repeat;mask:var(--wb-mark-arrow-right) center/contain no-repeat}
.wb-shift>:first-child{grid-area:1/1}
.wb-shift>:last-child{grid-area:1/3}
.wb-before,.wb-after{border-radius:6px;padding:14px 16px;min-width:0;display:flex;flex-direction:column;gap:10px}
.wb-before{--hue-fill:var(--slate-fill);--hue-ink:var(--slate-ink);--hue-line:var(--slate-line);--hue-solid:var(--slate-solid);color:var(--muted);
  background:repeating-linear-gradient(-45deg,transparent 0 6px,color-mix(in srgb,var(--line) 70%,transparent) 6px 7px),var(--wash)}
.wb-before>:is(h2,h3,h4){color:var(--muted)}
.wb-after{background:var(--hue-fill);color:var(--ink)}
.wb-after>:is(h2,h3,h4){color:var(--hue-ink)}
.wb-before .wb-flow>li{--bg:var(--wash)}
.wb-after .wb-flow>li{--bg:var(--hue-fill)}
.wb-before ul,.wb-after ul{display:grid;gap:7px;padding:0;list-style:none;font-size:13.5px;line-height:1.4}
.wb-before ul>li,.wb-after ul>li{margin:0;display:flex;gap:7px}
.wb-before ul>li::before,.wb-after ul>li::before{content:"";flex:none;width:14px;height:14px;margin-top:1.5px;background:currentColor;opacity:.75;-webkit-mask:var(--wb-icon,var(--wb-mark-partly)) center/contain no-repeat;mask:var(--wb-icon,var(--wb-mark-partly)) center/contain no-repeat}
.wb-after ul>li::before{background:var(--hue-ink);opacity:1;-webkit-mask-image:var(--wb-icon,var(--wb-mark-yes));mask-image:var(--wb-icon,var(--wb-mark-yes))}
@media (max-width:560px){
  .wb-shift{grid-template-columns:minmax(0,1fr);gap:8px}
  .wb-shift::before{grid-area:2/1;justify-self:center;-webkit-mask-image:var(--wb-mark-arrow-down);mask-image:var(--wb-mark-arrow-down)}
  .wb-shift>:last-child{grid-area:3/1}
}

/* A measure: where a number stands today and where success puts it, as two bars on one scale.
   --max on the figure is the scale; --v on each bar its value. */
.wb-measure{display:grid;gap:7px}
.wb-measure>figcaption{font-size:14px;font-weight:600;color:var(--ink);margin-bottom:2px}
.wb-bar{--w:max(4px,calc(var(--v,0) / var(--max,100) * (100% - 120px)));display:grid;grid-template-columns:4.75em minmax(0,1fr);align-items:center;column-gap:10px;min-height:26px}
.wb-bar::before{content:"";grid-area:1/2;justify-self:start;width:var(--w);height:14px;border-radius:4px;background:var(--hue-solid)}
.wb-bar>span{grid-area:1/1;font-size:13px;color:var(--muted);line-height:1.2}
.wb-bar>b{grid-area:1/2;padding-left:calc(var(--w) + 8px);font-size:15px;line-height:1.3;color:var(--hue-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.wb-bar.is-from::before,.wb-bar.is-today::before{background:repeating-linear-gradient(-45deg,var(--slate-line) 0 1.5px,transparent 1.5px 5px),var(--wash);box-shadow:inset 0 0 0 1px var(--slate-line)}
.wb-bar.is-from>b,.wb-bar.is-today>b{color:var(--muted);font-weight:500}

/* A spectrum: two ends of a choice, the alternatives placed on it, and the product marked.
   --at on each is its place, 0 to 100. */
.wb-spectrum{position:relative;padding:30px 0 0;min-height:76px;background:linear-gradient(var(--line-2),var(--line-2)) 0 38px/100% 2px no-repeat}
.wb-spectrum>span{position:absolute;top:50px;font-size:13px;color:var(--muted);max-width:45%}
.wb-spectrum>span:first-of-type{left:0}
.wb-spectrum>span:last-of-type{right:0;text-align:right}
.wb-spectrum>:is(i,mark){position:absolute;top:8px;left:calc(var(--at,50) * 1%);translate:calc(var(--at,50) * -1%) 0;white-space:nowrap;font-style:normal;font-size:13px;color:var(--muted);background:none}
.wb-spectrum>:is(i,mark)::after{content:"";position:absolute;top:24px;left:calc(var(--at,50) * 1%);width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--bg);box-shadow:inset 0 0 0 2px var(--line-2)}
.wb-spectrum>mark{font-weight:600;color:var(--hue-ink)}
.wb-spectrum>mark::after{top:22px;width:14px;height:14px;margin-left:-7px;background:var(--hue-solid);box-shadow:0 0 0 3px var(--bg)}

/* A loop: stages that repeat, on a ring, clockwise from the top; data-core names what turns. */
.wb-loop{position:relative;width:min(100%,300px);aspect-ratio:1;margin:0 auto;padding:0;list-style:none}
.wb-loop::before{content:"";position:absolute;inset:10%;background:var(--hue-line);-webkit-mask:var(--wb-ring) center/contain no-repeat;mask:var(--wb-ring) center/contain no-repeat}
.wb-loop[data-core]::after{content:attr(data-core);position:absolute;left:50%;top:50%;translate:-50% -50%;max-width:38%;text-align:center;font-size:13px;font-weight:600;line-height:1.25;color:var(--hue-ink)}
.wb-loop>li{--a:-90deg;position:absolute;margin:0;left:calc(50% + cos(var(--a)) * 40%);top:calc(50% + sin(var(--a)) * 40%);translate:-50% -50%;max-width:44%;padding:5px 11px;border-radius:999px;background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--hue-line);font-size:13px;font-weight:600;line-height:1.25;text-align:center;color:var(--ink)}
.wb-loop>li.is-us,.wb-loop>li.is-new{background:var(--hue-solid);box-shadow:none;color:var(--on-solid)}
.wb-loop:has(>li:nth-child(3):last-child)>li:nth-child(2){--a:30deg}
.wb-loop:has(>li:nth-child(3):last-child)>li:nth-child(3){--a:150deg}
.wb-loop:has(>li:nth-child(4):last-child)>li:nth-child(2){--a:0deg}
.wb-loop:has(>li:nth-child(4):last-child)>li:nth-child(3){--a:90deg}
.wb-loop:has(>li:nth-child(4):last-child)>li:nth-child(4){--a:180deg}
.wb-loop:has(>li:nth-child(5):last-child)>li:nth-child(2){--a:-18deg}
.wb-loop:has(>li:nth-child(5):last-child)>li:nth-child(3){--a:54deg}
.wb-loop:has(>li:nth-child(5):last-child)>li:nth-child(4){--a:126deg}
.wb-loop:has(>li:nth-child(5):last-child)>li:nth-child(5){--a:198deg}
.wb-loop:has(>li:nth-child(6):last-child)>li:nth-child(2){--a:-30deg}
.wb-loop:has(>li:nth-child(6):last-child)>li:nth-child(3){--a:30deg}
.wb-loop:has(>li:nth-child(6):last-child)>li:nth-child(4){--a:90deg}
.wb-loop:has(>li:nth-child(6):last-child)>li:nth-child(5){--a:150deg}
.wb-loop:has(>li:nth-child(6):last-child)>li:nth-child(6){--a:210deg}

/* A timeline: moments in order, a time over what happens; is-pain and is-new as in a flow. */
.wb-timeline{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);padding:0;list-style:none;background:linear-gradient(var(--line-2),var(--line-2)) 0 27px/100% 1.5px no-repeat}
.wb-timeline>li{position:relative;margin:0;padding:40px 10px 0 0;font-size:13.5px;line-height:1.4;color:var(--muted)}
.wb-timeline>li>time{position:absolute;top:0;left:0;font-size:14px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.wb-timeline>li::before{content:"";position:absolute;top:23px;left:0;width:10px;height:10px;border-radius:50%;background:var(--bg);box-shadow:inset 0 0 0 2px var(--hue-line),0 0 0 3px var(--bg)}
.wb-timeline>li.is-pain>time{color:var(--rose-ink)}
.wb-timeline>li.is-pain::before{box-shadow:inset 0 0 0 2px var(--rose-solid),0 0 0 3px var(--bg)}
.wb-timeline>li.is-new>time,.wb-timeline>li.is-us>time{color:var(--hue-ink)}
.wb-timeline>li.is-new::before,.wb-timeline>li.is-us::before{background:var(--hue-solid);box-shadow:0 0 0 3px var(--bg)}
/* A timeline runs down instead of across on a narrow card, and wherever a time is wider than its
   column (the card's script marks it is-stacked), so times never run into each other. */
.wb-timeline.is-stacked{grid-auto-flow:row;background:linear-gradient(var(--line-2),var(--line-2)) 4.25px 6px/1.5px calc(100% - 12px) no-repeat;gap:12px}
.wb-timeline.is-stacked>li{padding:0 0 0 22px}
.wb-timeline.is-stacked>li>time{position:static;display:block}
.wb-timeline.is-stacked>li::before{top:4px}
@media (max-width:400px){
  .wb-timeline{grid-auto-flow:row;background:linear-gradient(var(--line-2),var(--line-2)) 4.25px 6px/1.5px calc(100% - 12px) no-repeat;gap:12px}
  .wb-timeline>li{padding:0 0 0 22px}
  .wb-timeline>li>time{position:static;display:block}
  .wb-timeline>li::before{top:4px}
}

/* A comparison: the alternatives against what matters. A cell's text is yes, no or partly, which
   the kit draws as a mark (and still reads aloud); col.is-us or a cell's is-us marks the product. */
.wb-compare{width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.35}
.wb-compare :is(th,td){padding:7px 10px;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle}
.wb-compare thead th{font-size:13px;font-weight:600;color:var(--muted);border-bottom-color:var(--line-2)}
.wb-compare tbody th{text-align:left;font-weight:500;color:var(--ink)}
.wb-compare tbody tr:last-child>*{border-bottom:0}
.wb-compare col.is-us,.wb-compare .is-us{background:var(--hue-fill)}
.wb-compare thead .is-us{color:var(--hue-ink)}
.wb-compare td:is([data-mark],.is-yes,.is-no,.is-partly){font-size:0}
.wb-compare td:is([data-mark],.is-yes,.is-no,.is-partly)::before{content:"";display:inline-block;width:16px;height:16px;vertical-align:middle;background:var(--faint);-webkit-mask:var(--wb-mark-partly) center/contain no-repeat;mask:var(--wb-mark-partly) center/contain no-repeat}
.wb-compare td:is([data-mark="yes"],.is-yes)::before{background:var(--green-ink);-webkit-mask-image:var(--wb-mark-yes);mask-image:var(--wb-mark-yes)}
.wb-compare td:is([data-mark="no"],.is-no)::before{background:var(--rose-ink);-webkit-mask-image:var(--wb-mark-no);mask-image:var(--wb-mark-no)}
.wb-compare td:is([data-mark="partly"],.is-partly)::before{background:var(--amber-ink)}

/* A voice: what the people it is for would say, in their words, with who says it. */
.wb-quote{position:relative;padding-left:30px;font-size:16px;font-weight:500;line-height:1.45;letter-spacing:-0.005em;color:var(--ink);max-width:58ch}
.wb-quote::before{content:"";position:absolute;left:0;top:2px;width:20px;height:20px;background:var(--hue-solid);-webkit-mask:var(--wb-mark-quote) center/contain no-repeat;mask:var(--wb-mark-quote) center/contain no-repeat}
.wb-quote :is(cite,footer){display:block;margin-top:6px;font-size:13px;font-style:normal;font-weight:400;color:var(--muted)}

/* A note: a small aside on the part above it. */
.wb-note{position:relative;padding-left:20px;font-size:13px;line-height:1.4;color:var(--muted);max-width:60ch}
.wb-note::before{content:"";position:absolute;left:0;top:1px;width:14px;height:14px;background:var(--faint);-webkit-mask:var(--wb-mark-note) center/contain no-repeat;mask:var(--wb-mark-note) center/contain no-repeat}
`;

/* ---- The document a front is shown in ---------------------------------------------------------- */

let inter: string | undefined;
/** The app's typeface, carried in every card: a card makes no network request. */
function interFace(): string {
  inter ??= `@font-face{font-family:"Inter";src:url(data:font/woff2;base64,${readFileSync(new URL("./story-fonts/inter.woff2", import.meta.url)).toString("base64")}) format("woff2");font-weight:100 900;font-style:normal;font-display:block}`;
  return inter;
}

/**
 * WhatBuild's one script in a card: it tells the app how tall the card's content is, whenever that
 * changes, so the app can size the card to it. It sends only a number; the app checks the message
 * came from the card's own frame.
 */
/**
 * WhatBuild's one script in a card: it stacks a timeline whose times would run into each other,
 * tells the app how tall the card is, and, in a preview opened on its own, says on the height line
 * whether the card fits.
 */
const MEASURE_SCRIPT =
  "(function(){var c=document.querySelector('.wb-card'),lim=document.querySelector('.wb-limit'),last=-1;" +
  "function stack(){document.querySelectorAll('.wb-timeline').forEach(function(t){t.classList.remove('is-stacked');" +
  "if([].some.call(t.querySelectorAll(':scope>li>time'),function(x){return x.scrollWidth>x.parentElement.clientWidth-8;}))t.classList.add('is-stacked');});}" +
  "function send(){stack();var h=Math.ceil(c.getBoundingClientRect().height);if(h===last)return;last=h;" +
  "if(parent!==window)parent.postMessage({whatbuild:'card-height',height:h},'*');" +
  "if(lim){var m=+lim.getAttribute('data-limit'),o=h-m,phone=innerWidth<=520;lim.toggleAttribute('data-over',o>0&&!phone);" +
  "lim.firstChild.textContent=phone?h+'px tall: a phone shows the whole front.':o>0?h+'px tall: '+o+'px over the '+m+'px a desktop shows. It would scroll inside its card.':h+'px tall: fits the '+m+'px a desktop shows, with '+(-o)+'px to spare.';}}" +
  "new ResizeObserver(function(){requestAnimationFrame(send);}).observe(c);if(document.fonts)document.fonts.ready.then(send);send();})();";

/**
 * The line a preview draws where a desktop stops showing the card, and the words on it. A phone has
 * no line, so there the words follow the card, below its last part rather than over it.
 */
const LIMIT_CSS =
  "body{position:relative}" +
  ".wb-limit{position:absolute;left:0;right:0;border-top:1.5px dashed var(--muted);pointer-events:none}" +
  ".wb-limit[data-over]{border-top-color:var(--rose-solid)}" +
  ".wb-limit>span{position:absolute;right:8px;top:4px;padding:2px 6px;border-radius:4px;background:var(--bg);color:var(--muted);font:500 11px/1.4 var(--font);box-shadow:0 0 0 1px var(--line-2)}" +
  ".wb-limit[data-over]>span{color:var(--rose-ink)}" +
  "@media (max-width:520px){.wb-limit{position:static;border-top:0;padding:0 var(--pad) var(--pad)}.wb-limit>span{position:static;display:inline-block}}";

/**
 * A front as the app's frame shows it: a whole document around the stored markup, with the kit, the
 * pictograms it names, the theme when the app gives one, and the measuring script under its nonce.
 * The stored front is never changed.
 */
export function ideaCardDocument(
  front: string,
  opts: { title: string; theme?: "light" | "dark"; nonce: string; /** A preview's height line: the most a desktop shows. */ limit?: number },
): string {
  const theme = opts.theme ? ` ${THEME_ATTRIBUTE}="${opts.theme}"` : "";
  const limit = opts.limit ? `<div class="wb-limit" aria-hidden="true" data-limit="${opts.limit}" style="top:${opts.limit}px"><span></span></div>` : "";
  return (
    `<!doctype html><html lang="en"${theme}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(opts.title)}</title><style>${interFace()}\n${CARD_KIT_CSS}\n${iconRules(cardIconsNamed(front))}${opts.limit ? `\n${LIMIT_CSS}` : ""}</style></head>` +
    `<body><main class="wb-card">\n${front}\n</main>${limit}<script nonce="${opts.nonce}">${MEASURE_SCRIPT}</script></body></html>`
  );
}

/**
 * The headers on every response that serves a card: its sandbox (scripts only, in an opaque origin),
 * no network, and no script but WhatBuild's own, by its nonce. `ancestor` is who may frame it: the
 * app's own origin, or, for a card served from the content site, the app's origin by name.
 */
export function ideaCardResponseHeaders(nonce: string, ancestor = "'self'"): Record<string, string> {
  return {
    "Content-Security-Policy":
      `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; ` +
      `media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestor}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Content-Type": "text/html; charset=utf-8",
  };
}

/* ---- What agents are told ---------------------------------------------------------------------- */

/** The card kit's reference, as outcomes_read(action="card_guidance") gives it. */
export const CARD_GUIDANCE = `# Drawing an Idea card

The product concept and each outcome is a card. On the Idea screen people see its **front** first: a picture of the idea, under the card's title. Its **back**, the text, opens with More info between the title and the picture, so the two are read together. You write both sides, in the same call.

- **The front** (\`card_html\`) is what someone new to the team takes in within five seconds: for the concept, what the product promises, to whom, and what changes for them; for an outcome, what the users can do afterwards and the sign that they can. People do not read paragraphs here. Show it.
- **The back** (the concept's \`concept\`, an outcome's \`description\`; Markdown) is the same idea in depth: what every agent working in the product reads first, and what a person opens More info to understand. It may say more than the front; it never says something different.

The two sides change together. A call that changes one sends the other too, unchanged if it still agrees, and is refused otherwise (\`card_sides_together\`). Read both before you change either: \`products_read(action="get", include_card=true)\`, \`outcomes_read(action="get")\`. The concept's card changes with \`products_write(action="update_concept")\`, an outcome's with \`outcomes_write(action="create")\` or \`(action="update")\`; an editor may make either.

## How to draw a card

1. **Read the back first,** and for an outcome the product concept's too. The front draws what the back says, and nothing else.
2. **Say in one sentence the one thing the card must make obvious.** The concept: the promise, and to whom. An outcome: what the users can do afterwards that they cannot today, and how anyone would know.
3. **Pick one main part that shows that sentence** (the table below), and at most one or two that support it: a lede, a note, chips, a zone stating the success.
4. **Pick one hue** for the card with \`data-hue\`; slate is for how things are today.
5. **Write the words last, and few:** labels of two to five words, and no sentence that says what the picture already shows.
6. **Look at it before you write it.** \`outcomes_read(action="card_preview")\` (with \`kind="concept"\` for the concept) makes every check the write makes and gives you a short-lived link to the front exactly as the Idea screen shows it, with a dashed line where a desktop stops showing it and a note saying how tall it is. Open it at ${CARD_FRAMES.outcome.width} and 390 wide, light and dark: nothing below the line at ${CARD_FRAMES.outcome.width}, nothing running into anything else at either width. Fix and preview again until it fits.
7. **Check it against the list at the end,** and send both sides. If the response carries \`card_advice\`, fix what it names with an update.

## Choose the main part from what the card says

| When the card says… | Draw it with |
|---|---|
| a promise to someone (the concept) | \`wb-pitch\` and a \`wb-lede\`, then \`wb-shift\` (today, and with the product) and \`wb-who\` |
| who it is for, and what each needs | \`wb-who\` |
| steps are removed, merged or done for them | \`wb-flow\`, with \`is-pain\` on what hurts and \`is-new\` on what the product brings; or two flows in a \`wb-shift\` |
| something gets faster, cheaper or rarer | \`wb-measure\`: today's bar (\`is-from\`) and success's, on one scale |
| a moment in the day or week changes | \`wb-timeline\` |
| a rhythm that repeats | \`wb-loop\` |
| it is chosen over the alternatives | \`wb-compare\` (a few rows), or \`wb-spectrum\` (one axis) |
| the problem, in the users' words | \`wb-quote\`, unattributed |
| a few qualities or kinds | \`wb-chips\` |

## The room a front has

- The cards stand one under another, each as wide as the page's content: ${CARD_FRAMES.concept.width}px on a desktop. Every front, the concept's and each outcome's, shows up to ${CARD_FRAMES.outcome.max_height}px tall. Take only the room the idea needs: a picture reads faster short, and a card that is mostly empty space reads as unfinished. A taller front scrolls inside its card on a desktop, which a picture should never need: fit it at ${CARD_FRAMES.outcome.width}px, and check with a preview.
- On a phone a card is about ${CARD_FRAMES.outcome.min_width}px wide and shows its whole front, with no height limit: the parts restack (a flow, a shift and a timeline turn vertical), and the front only has to read well. Widths answer to the card, not the window, so a media query in a \`<style>\` block sees the card's width. A timeline whose times would run into each other at some width runs down instead, by itself.
- As a rule of thumb, an outcome's front holds one main part and one supporting part; the concept's a pitch, a lede, one main part and \`wb-who\`.

## What a front is

Only the markup inside the card. WhatBuild wraps it in a document with this kit (the app's type, greys and a diagram palette), in the reader's light or dark theme, inside a sandbox. Up to ${CARD_HTML_MAX.toLocaleString("en-US")} characters; aim for under 6,000.

- The card's head already shows the outcome's title, or "Product concept": never repeat it on the front, and put no heading over the first part.
- Draw with the kit's parts below. A diagram the kit lacks may be inline SVG, coloured with the kit's variables (\`currentColor\`, \`var(--hue-ink)\`, \`var(--hue-line)\`, \`var(--muted)\`), never fixed colours, so it reads in both themes.
- A \`<style>\` block may adjust spacing or a part's size, with the kit's variables. Keep it small.
- No scripts, event handlers, links, forms, or anything loaded from elsewhere (images and fonts only as data: URIs). Each refusal (\`invalid_card\`) names what to change, and lists every problem at once.

## Taste

- **One idea per card, said with a picture.** A front that needs its back to make sense is not done.
- **Few words.** About ${FRONT_WORDS.concept} words of text on the concept's front, ${FRONT_WORDS.outcome} on an outcome's; labels of two to five words.
- **One hue for the product's way, slate for today.** Pick the card's hue with \`data-hue\` and keep to it; rose only for what hurts, sparingly. Never a rainbow. Different outcomes may take different hues.
- **No invented numbers.** A measure shows the success the back states, and where things stand as the back states it; never a figure nobody gave. Without a figure, draw the change (a flow, a timeline) rather than a scale.
- **No cited evidence on an outcome.** As on its back: no sources, quotes from named people, calls or dates. The concept's front may give the users' problem in their own words, unattributed (\`wb-quote\` with a role, not a name).
- **No decoration.** No pictogram without meaning, no section numbers, no labels above titles, no rows of identical tiles.

## The parts

Every part is a class on ordinary elements. \`data-hue\` on any element (indigo, teal, amber, rose, green, sky, slate; indigo by default) sets the hue it and what it holds are drawn in. \`data-icon\` names a pictogram (the names are listed after the parts), which \`wb-icon\` draws and the parts with a node draw on their own.

**Words**
- \`<p class="wb-pitch">Crewboard gives crew leads their <em>Friday afternoon</em> back.</p>\` — the promise, large; \`em\` marks the words that matter, in the hue.
- \`<p class="wb-lede">…</p>\` — one line under the pitch.
- \`<span class="wb-label">…</span>\` — a small caption. \`<span class="wb-mark">…</span>\` — marks words like \`em\` in a pitch. \`<b class="wb-num">30 min</b>\` — a number in the hue.
- \`h2\`, \`h3\`, \`p\`, \`ul\`, \`small\` are styled too.

**People** — who it is for, and what each needs:
\`\`\`html
<ul class="wb-who">
  <li data-icon="user" data-hue="teal"><b>Crew lead</b>Plans the week for three crews</li>
  <li data-icon="users"><b>Crews</b>Need their jobs before Monday</li>
</ul>
\`\`\`

**Flow** — steps in order, a node each, with an arrow to the next. \`data-icon\` on a step draws its pictogram (a number otherwise); \`is-pain\` marks a step that hurts, \`is-new\` one the product brings. Three to five steps. Restacks vertically on a phone.
\`\`\`html
<ol class="wb-flow">
  <li data-icon="clipboard-list"><b>Jobs</b>what must happen</li>
  <li data-icon="users"><b>Crews</b>who can run each</li>
  <li data-icon="send" class="is-new"><b>Texts</b>sent from the plan</li>
</ol>
\`\`\`

**Shift** — today, and with the product: two sides with an arrow between. Today is drawn in slate, hatched; the other side in the hue. Each side holds an \`h3\` and a list (a check marks each item on the product's side; \`data-icon\` on an item gives it a pictogram), a flow, or a sentence.
\`\`\`html
<div class="wb-shift">
  <div class="wb-before"><h3>Today</h3><ul><li data-icon="sheet">Rebuilt by hand every Friday</li></ul></div>
  <div class="wb-after"><h3>With Crewboard</h3><ul><li>Repeat clients carried forward</li></ul></div>
</div>
\`\`\`

**Measure** — where a number stands and where success puts it, as bars on one scale. \`--max\` on the figure is the scale, \`--v\` on each bar its value; \`is-from\` draws today's bar hatched.
\`\`\`html
<figure class="wb-measure" style="--max:240">
  <figcaption>Friday planning</figcaption>
  <div class="wb-bar is-from" style="--v:240"><span>Today</span><b>an afternoon</b></div>
  <div class="wb-bar" style="--v:30"><span>Success</span><b>under 30 min</b></div>
</figure>
\`\`\`

**Spectrum** — two ends of a choice, the alternatives on it, the product marked. \`--at\` is a place from 0 to 100.
\`\`\`html
<div class="wb-spectrum">
  <span>Starts from the calendar</span><span>Starts from the jobs</span>
  <i style="--at:15">Calendar apps</i><i style="--at:45">Spreadsheets</i><mark style="--at:90">Crewboard</mark>
</div>
\`\`\`

**Loop** — three to six stages that repeat, on a ring, clockwise from the top; \`data-core\` names what turns. \`is-us\` fills the stage the product owns.
\`\`\`html
<ol class="wb-loop" data-core="Every week"><li>Plan</li><li class="is-us">Send</li><li>Work</li><li>Adjust</li></ol>
\`\`\`

**Timeline** — moments in order, a time over each; \`is-pain\` and \`is-new\` as in a flow, and \`is-us\` fills the moment the product makes. Restacks on a phone.
\`\`\`html
<ol class="wb-timeline"><li><time>Tue 4:10 pm</time>A client books for Thursday</li><li class="is-new"><time>4:14 pm</time>Placed, crews told</li></ol>
\`\`\`

**Comparison** — alternatives against what matters. A cell's text is yes, no or partly, drawn as a mark and still read aloud; \`<col class="is-us">\` shades the product's column.
\`\`\`html
<table class="wb-compare">
  <colgroup><col><col><col class="is-us"></colgroup>
  <thead><tr><th></th><th>Spreadsheet</th><th class="is-us">Crewboard</th></tr></thead>
  <tbody><tr><th>Starts from the jobs</th><td data-mark="partly">partly</td><td data-mark="yes">yes</td></tr></tbody>
</table>
\`\`\`

**Voice** — the users' problem in their words, unattributed: \`<blockquote class="wb-quote"><p>…</p><cite>Crew lead, landscaping</cite></blockquote>\`.

**Chips** — short labels in a hue: \`<ul class="wb-chips"><li class="wb-chip" data-icon="leaf">Landscaping</li></ul>\`.

**Note** — a small aside under a part: \`<p class="wb-note">…</p>\`.

**Layout** — \`wb-split\` sets parts side by side and stacks them when the card is narrow; \`wb-row\` lets them wrap; \`wb-zone\` is a quiet tinted area in the hue. The card stacks its top-level parts with even space between them.

**Pictogram** — \`<i class="wb-icon" data-icon="truck"></i>\`, sized with the text around it.

## Pictograms

${[...CARD_ICON_NAMES].join(", ")}.

## Examples

**A concept's front:** the promise, one line under it, today and with the product, and who it is for.
\`\`\`html
<p class="wb-pitch">Crewboard gives crew leads their <em>Friday afternoon</em> back.</p>
<p class="wb-lede">A week planner for small field-service crews that starts from the jobs, not the calendar.</p>
<div class="wb-shift">
  <div class="wb-before"><h3>Today</h3><ul><li data-icon="sheet">Next week rebuilt by hand in a spreadsheet</li><li data-icon="message-square">Every crew's texts typed one by one</li></ul></div>
  <div class="wb-after"><h3>With Crewboard</h3><ul><li>Jobs carried forward, matched to crews</li><li>Each crew's week sent from the plan</li></ul></div>
</div>
<ul class="wb-who"><li data-icon="user"><b>Crew leads</b>who plan the week</li><li data-icon="users"><b>Crews</b>who need it by Monday</li></ul>
\`\`\`

**An outcome that makes something faster** ("Plan next week in minutes, not an afternoon"; its back states the success, under half an hour): the measure, then the steps that make it so.
\`\`\`html
<figure class="wb-measure" style="--max:240">
  <figcaption>Time to plan next week</figcaption>
  <div class="wb-bar is-from" style="--v:240"><span>Today</span><b>an afternoon</b></div>
  <div class="wb-bar" style="--v:30"><span>Success</span><b>under 30 min</b></div>
</figure>
<ol class="wb-flow">
  <li data-icon="repeat"><b>Repeat jobs</b>already in place</li>
  <li data-icon="users"><b>Crews</b>matched per job</li>
  <li data-icon="calendar-check" class="is-new"><b>The week</b>ready to send</li>
</ol>
\`\`\`

**An outcome that changes a moment** ("Send every crew the right week, with no mix-ups"): when things happen, and the sign of success in a zone.
\`\`\`html
<ol class="wb-timeline" data-hue="teal">
  <li><time>Friday</time>The week is planned</li>
  <li class="is-new"><time>Before Monday</time>Clashes and gaps flagged, then fixed</li>
  <li class="is-us"><time>Monday, 7 am</time>Each crew has its jobs, times and addresses</li>
</ol>
<div class="wb-zone" data-hue="teal"><p>Success: a week with <b>no job missed or double-booked</b>.</p></div>
\`\`\`

## Writing the back

Markdown, read by every agent that works in the product and by anyone who opens More info. Open with the whole idea in one or two sentences, then short paragraphs led by a bold phrase, or \`##\` sections when it runs long.

- **The concept's back:** who it is for; the problem they have; how the product solves it; what it is not; what is not known yet. Up to 8,000 characters.
- **An outcome's back:** what the users can do, in a sentence; what success looks like for them (the sign, and the figure if the person gave one); what it means for them; what it leaves out. Up to 6,000 characters; most need far fewer.
- **No evidence on an outcome's back,** as on its front: no sources, quotes, names, dates, ids or links to records. What the evidence says belongs in sources, and what it suggests in assumptions.

## Keep the two sides in step

- When the back changes something the front shows (who, the promise, the success, the steps), redraw the front in the same call. When it does not, send the front unchanged.
- A rename alone needs no new front, since the front never repeats the title; check that the front still agrees with it.
- A card with no front yet (\`card_chars: 0\`) shows people its text and a request for a picture. Offer to draw it when you next work on it, and draw it once the person agrees.

## Before you send

- Someone new takes in the front in five seconds, without opening More info.
- It does not repeat the title, and has no heading over its first part.
- About ${FRONT_WORDS.outcome} words of text on an outcome's front, ${FRONT_WORDS.concept} on the concept's; labels of two to five words.
- One hue, with slate for today; rose only for what hurts.
- Every number on the front is one the back states.
- Its preview at ${CARD_FRAMES.outcome.width}px ends above the dashed line, and at 390px nothing runs into anything else.
- The back says everything the front shows, and more.

A write that succeeds carries \`card_advice\` when one of these that WhatBuild can check fails: too many words, the title repeated, no kit parts, more than one hue, fixed colours, no pitch on the concept, an empty back. It is advice, not a refusal: fix what it names with an update.
`;
