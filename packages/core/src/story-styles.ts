/**
 * House styles for Story pages: complete, named design systems an agent can adopt for a product
 * when the team has no design system of its own. None of them is WhatBuild's app look. A Story is
 * the team's document, often read outside the team, so it should look like theirs.
 *
 * Every house style styles the same small semantic vocabulary (VOCABULARY), so content moves
 * between styles unchanged, and each adds signature moves of its own. The vocabulary is a floor,
 * not a ceiling: agents are expected to compose beyond it within a style's character.
 *
 * All type is system font stacks, because a page can make no network request. Each style carries a
 * light and a dark scheme and follows the app's theme through THEME_ATTRIBUTE on <html>.
 */

import { THEME_ATTRIBUTE } from "./story-theme.ts";

export interface HouseStyle {
  id: "broadsheet" | "tufte" | "swiss" | "briefing";
  name: string;
  summary: string;
  best_for: string;
  character: string;
  /** Moves this style owns; the page should use at least one. */
  signature: string[];
  /** What would break the style. */
  avoid: string[];
  /** Markdown rules a product's Story style starts from when it adopts this house style. */
  rules: string;
  stylesheet: string;
}

type Scheme = Record<string, string>;

const decl = (tokens: Scheme, indent: string) =>
  Object.entries(tokens)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join("\n");

/** Light by default; dark by system preference unless the app forces light; forced either way by the app. */
function schemes(light: Scheme, dark: Scheme): string {
  return `:root {
  color-scheme: light dark;
${decl(light, "  ")}
}
@media (prefers-color-scheme: dark) {
  :root:not([${THEME_ATTRIBUTE}="light"]) {
${decl(dark, "    ")}
  }
}
:root[${THEME_ATTRIBUTE}="light"] { color-scheme: light; }
:root[${THEME_ATTRIBUTE}="dark"] {
  color-scheme: dark;
${decl(dark, "  ")}
}
`;
}

/** What every house style needs regardless of character: box model, reflow, focus, table scrolling. */
const BASE = `*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; scrollbar-color: var(--muted) transparent; }
img, svg, video { max-width: 100%; height: auto; }
:root { --arrow: url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%23000%27%20stroke-width=%272.5%27%3E%3Cpath%20d=%27M3%2012h17M13%205l7%207-7%207%27/%3E%3C/svg%3E); }
::selection { background: var(--select); color: var(--on-select); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
[id] { scroll-margin-top: 1.5rem; }
h1, h2, h3 { text-wrap: balance; }
p, li, dd, figcaption { text-wrap: pretty; }
.table-wrap { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; margin: 1.5rem 0; scrollbar-width: thin; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums lining-nums; }
caption { text-align: left; }
th, td { text-align: left; vertical-align: top; min-width: 6.5rem; padding: 0.55rem 0.75rem 0.55rem 0; }
.status, .tag { white-space: nowrap; }
.timeline, .lines, .pages ul { list-style: none; max-width: none; margin: 0; padding: 0; }
.timeline { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); counter-reset: milestone; }
.timeline > li { counter-increment: milestone; }
.timeline time, .timeline strong { display: block; }
.timeline p { max-width: none; margin: 0; }
.lines { display: grid; grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr) auto; column-gap: 1.5rem; }
.lines > li { display: grid; grid-column: 1 / -1; grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr) auto; grid-template-columns: subgrid; column-gap: 1.5rem; align-items: baseline; }
.lines > li > :last-child:not(strong):not(:nth-child(2)) { justify-self: end; }
.facts { display: grid; grid-template-columns: minmax(7rem, 11rem) minmax(0, 1fr); max-width: none; margin: 0; }
.facts dt { padding-right: 1.5rem; }
.facts dd { margin: 0; }
.facts dd > :last-child { margin-bottom: 0; }
.pages ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); column-gap: 1.5rem; }
.pages a { display: block; height: 100%; color: inherit; text-decoration: none; }
.pages a strong, .pages a span { display: block; }
@media (max-width: 48rem) {
  .lines { grid-template-columns: minmax(0, 1fr) auto; }
  .lines > li { grid-template-columns: minmax(0, 1fr) auto; grid-template-columns: subgrid; }
  .lines > li > :nth-child(2):not(:last-child) { grid-column: 1 / -1; grid-row: 2; }
  .lines > li > :nth-child(2):last-child { grid-column: 1 / -1; }
  .facts { grid-template-columns: minmax(0, 1fr); }
  .facts dt { padding-right: 0; }
}
@media print {
  .timeline > li, .lines > li, .pages li, .figure, .quote, .callout, tr { break-inside: avoid; }
  h2, h3 { break-after: avoid; }
}
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;

/**
 * Each style names its faces once, as custom properties, and every rule refers to them. A team
 * adapting a style changes a face in one place, and the stylesheet pasted into every page stays small.
 */
const SERIF_TEXT = "var(--text)";
const SERIF_DISPLAY = "var(--display)";
const GROTESK = "var(--sans)";
const SYSTEM_SANS = "var(--sans)";
const FACES = {
  serifText: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, serif',
  serifDisplay: 'Charter, "Bitstream Charter", "Iowan Old Style", Georgia, "Times New Roman", serif',
  grotesk: '"Helvetica Neue", Helvetica, Arial, "Nimbus Sans", "Liberation Sans", sans-serif',
  systemSans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};
const faces = (f: { text?: string; display?: string; sans?: string }) =>
  `:root { ${Object.entries(f).map(([k, v]) => `--${k}: ${v};`).join(" ")} }\n`;

// ---- Broadsheet -------------------------------------------------------------------------------

const BROADSHEET = `${schemes(
  {
    "--paper": "#f7f4ee", "--ink": "#171513", "--ink-soft": "#3d3934", "--muted": "#5f5a53", "--rule": "#d9d2c5",
    "--tint": "#efe9de", "--accent": "#a3161a", "--focus": "#a3161a", "--select": "#a3161a", "--on-select": "#f7f4ee",
    "--ok": "#1d6b3a", "--caution": "#8a5200", "--open": "#5f5a53",
  },
  {
    "--paper": "#141311", "--ink": "#ece7de", "--ink-soft": "#cfc8bc", "--muted": "#a59e92", "--rule": "#38342e",
    "--tint": "#1f1d1a", "--accent": "#f07a6f", "--focus": "#f07a6f", "--select": "#f07a6f", "--on-select": "#141311",
    "--ok": "#6fcf92", "--caution": "#f0b35e", "--open": "#a59e92",
  },
)}${faces({ text: FACES.serifText, display: FACES.serifDisplay, sans: FACES.systemSans })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 1.125rem/1.62 ${SERIF_TEXT}; font-variant-numeric: oldstyle-nums; -webkit-font-smoothing: antialiased; }
.page { max-width: 70rem; margin: 0 auto; padding: clamp(1.5rem, 4vw, 3.5rem) clamp(1rem, 4vw, 3rem) 4rem; }
.opening { display: grid; gap: 0.9rem; padding-top: 1.1rem; border-top: 6px double var(--ink); margin-bottom: 2.75rem; }
.opening h1 { max-width: 54rem; }
.kicker { margin: 0; font: 700 0.8125rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
h1 { margin: 0; font: 700 clamp(2.25rem, 5.6vw, 4.1rem)/1.03 ${SERIF_DISPLAY}; letter-spacing: -0.018em; text-wrap: balance; }
.lead { margin: 0; max-width: 40em; font: italic 400 clamp(1.2rem, 2.2vw, 1.45rem)/1.45 ${SERIF_TEXT}; color: var(--ink-soft); }
.opening .meta { max-width: none; margin: 0; padding-top: 0.6rem; border-top: 1px solid var(--rule); font: 500 0.8125rem/1.4 ${SYSTEM_SANS}; color: var(--muted); }
section { margin-top: 3rem; padding-top: 0.85rem; border-top: 1px solid var(--ink); }
section::after { content: ""; display: table; clear: both; }
h2 { margin: 0 0 1.25rem; font: 700 0.875rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.12em; text-transform: uppercase; }
h2[data-label]::before { content: attr(data-label) "\\2002\\00B7\\2002"; color: var(--accent); }
h3 { margin: 1.75rem 0 0.5rem; font: 700 1.3rem/1.2 ${SERIF_DISPLAY}; }
p, ul, ol { max-width: 38em; margin: 0 0 1em; }
.opening + section > p:first-of-type::first-letter { float: left; margin: 0.07em 0.09em 0 0; font: 700 4.1em/0.8 ${SERIF_DISPLAY}; color: var(--accent); }
.text-columns { max-width: none; columns: 2 19rem; column-gap: 2.5rem; column-rule: 1px solid var(--rule); }
.text-columns > * { max-width: none; }
a { color: inherit; text-decoration-color: var(--accent); text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
a:hover { color: var(--accent); }
.quote { margin: 2.25rem 0; max-width: 34em; }
.quote blockquote { margin: 0; font: 400 clamp(1.45rem, 3vw, 2.05rem)/1.24 ${SERIF_DISPLAY}; letter-spacing: -0.01em; }
.quote blockquote::before { content: "\\201C"; display: block; height: 0.55em; font: 700 3.6em/1 ${SERIF_DISPLAY}; color: var(--accent); }
.quote blockquote p { margin: 0; max-width: none; }
.quote figcaption { max-width: 26rem; margin-top: 0.8rem; padding-top: 0.5rem; border-top: 1px solid var(--rule); font: 500 0.8125rem/1.4 ${SYSTEM_SANS}; color: var(--muted); }
.note { float: right; width: min(18rem, 40%); margin: 0.3rem 0 1.25rem 2rem; padding-top: 0.75rem; border-top: 3px solid var(--ink); font: 0.9375rem/1.5 ${SYSTEM_SANS}; color: var(--ink-soft); }
.callout { clear: both; max-width: 40em; margin: 2rem 0; padding: 1rem 1.25rem; border: 1px solid var(--ink); font: 1rem/1.55 ${SYSTEM_SANS}; }
.callout[data-tone="caution"] { border-color: var(--caution); background: var(--tint); }
.callout > :last-child { margin-bottom: 0; }
.status { display: inline-block; padding: 0.28em 0.5em; border: 1px solid currentColor; font: 700 0.6875rem/1 ${SYSTEM_SANS}; letter-spacing: 0.08em; text-transform: uppercase; vertical-align: 0.18em; }
.status[data-state="evidence"] { color: var(--ok); }
.status[data-state="caution"] { color: var(--caution); }
.status[data-state="open"] { color: var(--open); }
.tag { font: 700 0.6875rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.timeline { clear: both; margin: 2.25rem 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.timeline > li { padding: 1rem 1.25rem 1.1rem 0; }
.timeline > li + li { padding-left: 1.25rem; border-left: 1px solid var(--rule); }
.timeline time { margin-bottom: 0.4rem; font: 700 0.75rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
.timeline strong { margin-bottom: 0.4rem; font: 700 1.3rem/1.15 ${SERIF_DISPLAY}; }
.timeline p { font: 0.9375rem/1.45 ${SYSTEM_SANS}; color: var(--ink-soft); }
.lines { clear: both; margin: 1.5rem 0 2rem; border-top: 1px solid var(--ink); font: 0.9375rem/1.45 ${SYSTEM_SANS}; }
.lines > li { padding: 0.65rem 0 0.7rem; border-bottom: 1px solid var(--rule); }
.lines strong { font: 700 1.0625rem/1.3 ${SERIF_DISPLAY}; }
.facts { clear: both; margin: 1.5rem 0 2rem; border-top: 1px solid var(--ink); }
.facts dt, .facts dd { padding: 0.65rem 0 0.7rem; border-bottom: 1px solid var(--rule); }
.facts dt { font: 700 0.75rem/1.9 ${SYSTEM_SANS}; letter-spacing: 0.08em; text-transform: uppercase; }
.pages { clear: both; margin: 2rem 0; }
.pages ul { row-gap: 1.5rem; column-gap: 2rem; }
.pages a { padding-top: 0.75rem; border-top: 3px solid var(--ink); }
.pages a strong { margin-bottom: 0.35rem; font: 700 1.3rem/1.15 ${SERIF_DISPLAY}; text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
.pages a span { font: 0.9375rem/1.45 ${SYSTEM_SANS}; color: var(--ink-soft); }
.pages a:hover strong { color: var(--accent); }
.figures { clear: both; display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); margin: 2.25rem 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.figure { margin: 0; padding: 1rem 1.25rem 1.1rem 0; font: 0.9375rem/1.4 ${SYSTEM_SANS}; color: var(--ink-soft); }
.figure + .figure { padding-left: 1.25rem; border-left: 1px solid var(--rule); }
.figure strong { display: block; margin-bottom: 0.35rem; font: 700 clamp(2.3rem, 5vw, 3.3rem)/1 ${SERIF_DISPLAY}; font-variant-numeric: lining-nums; color: var(--ink); }
.columns { clear: both; display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 2rem; margin: 1.5rem 0; }
.columns > * { padding-top: 0.75rem; border-top: 3px solid var(--ink); }
.columns h3 { margin-top: 0; }
table { font: 0.9375rem/1.45 ${SYSTEM_SANS}; border-bottom: 2px solid var(--ink); }
caption { padding-bottom: 0.6rem; font: 700 1.15rem/1.3 ${SERIF_DISPLAY}; }
thead th { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 2px solid var(--ink); }
tbody th, tbody td { border-bottom: 1px solid var(--rule); }
.steps { counter-reset: step; list-style: none; padding: 0; }
.steps li { counter-increment: step; position: relative; padding: 0.8rem 0 0.8rem 3rem; border-top: 1px solid var(--rule); }
.steps li::before { content: counter(step); position: absolute; top: 0.85rem; left: 0; font: 700 1.6rem/1 ${SERIF_DISPLAY}; font-variant-numeric: lining-nums; color: var(--accent); }
details { max-width: 40em; margin-top: 1.5rem; padding: 0.75rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
summary { cursor: pointer; font: 700 0.875rem/1.3 ${SYSTEM_SANS}; letter-spacing: 0.04em; }
details > :last-child { margin-bottom: 0; }
@media (max-width: 48rem) {
  .note { float: none; width: auto; margin: 1.5rem 0; }
  .figure + .figure, .timeline > li + li { padding-left: 0; border-left: 0; border-top: 1px solid var(--rule); }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.15rem; }
}
@media print { .opening + section > p:first-of-type::first-letter { color: inherit; } }
`;

// ---- Tufte ------------------------------------------------------------------------------------

const TUFTE = `${schemes(
  {
    "--paper": "#fffff8", "--ink": "#111111", "--muted": "#5a5a55", "--rule": "#cfcfc6", "--tint": "#f4f4ea",
    "--focus": "#111111", "--ok": "#1f6a3a", "--caution": "#8d4f00", "--open": "#5a5a55", "--select": "#111111", "--on-select": "#fffff8",
  },
  {
    "--paper": "#151513", "--ink": "#e8e6df", "--muted": "#a9a79e", "--rule": "#3b3a35", "--tint": "#1f1f1c",
    "--focus": "#e8e6df", "--ok": "#79cf98", "--caution": "#f0b060", "--open": "#a9a79e", "--select": "#e8e6df", "--on-select": "#151513",
  },
)}${faces({ text: FACES.serifText })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 1.2rem/1.6 ${SERIF_TEXT}; font-variant-numeric: oldstyle-nums; counter-reset: sidenote; }
.page { width: 87.5%; max-width: 1400px; margin: 0 auto; padding: 3rem 0 5rem 12.5%; }
.opening > *, section > p, section > ul, section > ol, section > h3, section > .quote, section > .callout, section > details, section > .figures { width: 55%; }
section > .timeline, section > .lines, section > .facts, section > .pages { width: 80%; }
.kicker { margin: 0 0 0.5rem; font-size: 1.1rem; font-variant: small-caps; letter-spacing: 0.06em; color: var(--muted); }
h1 { margin: 0 0 1.25rem; font-size: clamp(2.3rem, 4.8vw, 3.3rem); font-weight: 400; line-height: 1.06; }
.lead { margin: 0 0 1rem; font-size: 1.5rem; font-style: italic; line-height: 1.35; }
.meta { margin: 0; font-size: 1rem; font-variant: small-caps; letter-spacing: 0.05em; color: var(--muted); }
section { margin-top: 3.25rem; }
section::after { content: ""; display: table; clear: both; }
h2 { margin: 0 0 1.25rem; font-size: 2rem; font-style: italic; font-weight: 400; line-height: 1.12; }
h2[data-label]::before { content: attr(data-label); display: block; margin-bottom: 0.2rem; font-size: 1rem; font-style: normal; font-variant: small-caps; letter-spacing: 0.05em; color: var(--muted); }
h3 { margin: 1.75rem 0 0.5rem; font-size: 1.45rem; font-style: italic; font-weight: 400; line-height: 1.2; }
p, ul, ol { margin: 0 0 1.25rem; }
section > p:first-of-type::first-line { font-variant: small-caps; letter-spacing: 0.03em; }
a { color: inherit; text-decoration-thickness: 0.05em; text-underline-offset: 0.16em; }
.note { float: right; clear: right; width: 30%; margin: 0.35rem 0 1.25rem; font-size: 0.95rem; line-height: 1.4; color: var(--ink); }
p > .note, li > .note { width: 50%; margin-right: -60%; }
.quote { margin: 1.5rem 0 2rem; }
.quote blockquote { margin: 0; padding-right: 2.5rem; font-size: 1.3rem; }
.quote blockquote p { width: auto; margin: 0; }
.quote figcaption { margin-top: 0.5rem; padding-right: 2.5rem; text-align: right; font-size: 1rem; }
.quote figcaption::before { content: "\\2014\\2009"; }
.callout { margin: 1.5rem 0; padding: 0.9rem 1.2rem; background: var(--tint); }
.callout[data-tone="caution"] { outline: 1px solid var(--caution); outline-offset: -1px; }
.callout > :last-child { margin-bottom: 0; }
.status { font-size: 1rem; font-variant: small-caps; letter-spacing: 0.05em; }
.status::before { content: "["; } .status::after { content: "]"; }
.status[data-state="evidence"] { color: var(--ok); }
.status[data-state="caution"] { color: var(--caution); }
.status[data-state="open"] { color: var(--open); }
.tag { font-size: 1rem; font-variant: small-caps; letter-spacing: 0.04em; color: var(--muted); }
.timeline { gap: 1.25rem 2.5rem; margin: 1.5rem 0 2rem; padding-top: 0.6rem; border-top: 2px solid var(--ink); }
.timeline time { font-size: 1rem; font-variant: small-caps; letter-spacing: 0.05em; color: var(--muted); }
.timeline strong { margin-bottom: 0.3rem; font-size: 1.35rem; font-style: italic; font-weight: 400; line-height: 1.2; }
.timeline p { font-size: 1rem; line-height: 1.4; }
.lines { margin: 1.5rem 0 2rem; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); font-size: 1.05rem; line-height: 1.4; }
.lines > li { padding: 0.45rem 0; }
.lines strong { font-style: italic; font-weight: 400; }
.facts { margin: 1.5rem 0 2rem; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); font-size: 1.05rem; line-height: 1.4; }
.facts dt, .facts dd { padding: 0.45rem 0; }
.facts dt { font-style: italic; }
.pages { margin: 1.5rem 0 2rem; }
.pages ul { row-gap: 1.25rem; column-gap: 2.5rem; }
.pages a strong { font-size: 1.35rem; font-style: italic; font-weight: 400; line-height: 1.2; text-decoration: underline; text-decoration-thickness: 0.05em; text-underline-offset: 0.16em; }
.pages a span { font-size: 1rem; line-height: 1.4; }
.figures { display: flex; flex-wrap: wrap; gap: 1rem 2.75rem; margin: 1.5rem 0 2rem; }
.figure { flex: 1 1 9rem; margin: 0; font-size: 1rem; line-height: 1.35; }
.figure strong { display: block; font-size: 2.4rem; font-weight: 400; line-height: 1.05; font-variant-numeric: lining-nums; }
.spark { height: 0.95em; width: auto; vertical-align: -0.1em; fill: none; stroke: currentColor; stroke-width: 1.2; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem 2.5rem; width: 80%; margin: 1.5rem 0; }
.columns h3 { width: auto; margin-top: 0.25rem; }
.table-wrap { width: 80%; }
table { font-size: 1.05rem; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); }
caption { padding-bottom: 0.5rem; font-style: italic; font-size: 1.15rem; }
thead th { font-weight: 400; font-variant: small-caps; letter-spacing: 0.04em; border-bottom: 1px solid var(--ink); }
.steps { padding-left: 1.4rem; }
.steps li { margin-bottom: 0.5rem; padding-left: 0.3rem; }
details { margin: 1.25rem 0; }
summary { cursor: pointer; font-style: italic; }
@media (max-width: 48rem) {
  .page { width: auto; padding: 2rem 1.1rem 4rem; }
  .opening > *, section > *, .columns, .table-wrap { width: auto !important; }
  .facts dt { padding-bottom: 0; }
  .facts dd { padding-top: 0; }
  .note, p > .note, li > .note { float: none; display: block; width: auto; margin: 1rem 0; padding: 0.6rem 0.85rem; background: var(--tint); }
}
`;

// ---- Swiss grid -------------------------------------------------------------------------------

const SWISS = `${schemes(
  {
    "--paper": "#ffffff", "--ink": "#0a0a0a", "--muted": "#595959", "--rule": "#d6d6d6", "--accent": "#d0140b", "--on-accent": "#ffffff",
    "--focus": "#d0140b", "--ok": "#0b6b3a", "--caution": "#8a5300", "--open": "#595959", "--on-status": "#ffffff",
    "--select": "#d0140b", "--on-select": "#ffffff",
  },
  {
    "--paper": "#0d0d0d", "--ink": "#f2f2f2", "--muted": "#a8a8a8", "--rule": "#333333", "--accent": "#ff5446", "--on-accent": "#1a0200",
    "--focus": "#ff5446", "--ok": "#5fd08f", "--caution": "#f2b25c", "--open": "#a8a8a8", "--on-status": "#0d0d0d",
    "--select": "#ff5446", "--on-select": "#1a0200",
  },
)}${faces({ sans: FACES.grotesk })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.55 ${GROTESK}; counter-reset: section; -webkit-font-smoothing: antialiased; }
.page { max-width: 82rem; margin: 0 auto; padding: clamp(1.25rem, 4vw, 4rem); }
.opening { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 1.5rem; row-gap: 1.25rem; padding-bottom: 3rem; border-bottom: 5px solid var(--ink); }
.opening > * { grid-column: 1 / -1; margin: 0; }
.kicker { font: 700 0.8125rem/1 ${GROTESK}; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
h1 { grid-column: 1 / span 11; font: 700 clamp(2.5rem, 7.2vw, 5.75rem)/0.94 ${GROTESK}; letter-spacing: -0.04em; text-wrap: balance; }
.opening .lead { grid-column: 5 / -1; grid-row: 3; margin-top: 1rem; font: 400 clamp(1.15rem, 1.9vw, 1.45rem)/1.38 ${GROTESK}; letter-spacing: -0.01em; }
.opening .meta { grid-column: 1 / span 3; grid-row: 3; align-self: end; font: 500 0.8125rem/1.45 ${GROTESK}; color: var(--muted); }
section { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 1.5rem; padding: 2.75rem 0; border-bottom: 1px solid var(--ink); counter-increment: section; }
section > * { grid-column: 5 / -1; }
section > h2 { grid-column: 1 / span 4; grid-row: 1 / span 30; align-self: start; position: sticky; top: 1.5rem; margin: 0; padding-right: 1rem; font: 700 1.4rem/1.12 ${GROTESK}; letter-spacing: -0.02em; }
section > h2::before { content: counter(section, decimal-leading-zero); display: block; margin-bottom: 0.6rem; font: 700 0.8125rem/1 ${GROTESK}; letter-spacing: 0.04em; color: var(--accent); }
section > h2[data-label]::before { content: attr(data-label); letter-spacing: 0.08em; text-transform: uppercase; }
section.wide > h2 { grid-row: 1; position: static; margin-bottom: 2rem; }
section.wide > :is(.timeline, .lines, .facts, .pages, .figures, .columns, .table-wrap) { grid-column: 1 / -1; }
section.wide > h2 + p { margin-bottom: 2rem; }
h3 { margin: 1.75rem 0 0.4rem; font: 700 1.0625rem/1.3 ${GROTESK}; }
p, ul, ol { max-width: 36em; margin: 0 0 1em; }
a { color: inherit; text-decoration-thickness: 2px; text-decoration-color: var(--accent); text-underline-offset: 0.2em; }
a:hover { color: var(--accent); }
.quote { margin: 0.5rem 0 2rem; }
.quote blockquote { margin: 0; font: 500 clamp(1.4rem, 2.7vw, 2.1rem)/1.16 ${GROTESK}; letter-spacing: -0.025em; }
.quote blockquote p { max-width: 22em; margin: 0; }
.quote figcaption { margin-top: 0.8rem; font-size: 0.8125rem; color: var(--muted); }
.note { max-width: 26rem; margin: 0 0 1.5rem; padding-top: 0.5rem; border-top: 1px solid var(--ink); font-size: 0.9375rem; color: var(--muted); }
.callout { margin: 1.5rem 0; padding: 1.25rem 1.4rem; background: var(--ink); color: var(--paper); }
.callout[data-tone="caution"] { background: var(--accent); color: var(--on-accent); }
.callout a { color: inherit; text-decoration-color: currentColor; }
.callout > :last-child { margin-bottom: 0; }
.status { display: inline-block; padding: 0.35em 0.5em; font: 700 0.6875rem/1 ${GROTESK}; letter-spacing: 0.07em; text-transform: uppercase; vertical-align: 0.15em; color: var(--on-status); }
.status[data-state="evidence"] { background: var(--ok); }
.status[data-state="caution"] { background: var(--caution); }
.status[data-state="open"] { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--ink); }
.tag { font: 700 0.6875rem/1.2 ${GROTESK}; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); }
.timeline { gap: 2rem 1.5rem; margin: 0 0 2rem; }
.timeline > li { padding-top: 0.75rem; border-top: 5px solid var(--ink); }
.timeline > li::before { content: counter(milestone); display: block; margin-bottom: 1.1rem; font: 700 clamp(3.5rem, 8vw, 5.5rem)/0.82 ${GROTESK}; letter-spacing: -0.05em; font-variant-numeric: lining-nums; }
.timeline time { margin-bottom: 0.45rem; font: 700 0.8125rem/1.2 ${GROTESK}; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.timeline strong { margin-bottom: 0.45rem; font: 700 1.3rem/1.12 ${GROTESK}; letter-spacing: -0.02em; text-wrap: balance; }
.timeline p { font-size: 0.9375rem; line-height: 1.4; color: var(--muted); }
.lines { margin: 0 0 1.75rem; border-top: 2px solid var(--ink); }
.lines > li { padding: 0.7rem 0 0.75rem; border-bottom: 1px solid var(--rule); font-size: 0.9375rem; line-height: 1.4; }
.lines strong { font-weight: 700; }
.facts { margin: 0 0 1.75rem; border-top: 2px solid var(--ink); font-size: 0.9375rem; line-height: 1.45; }
.facts dt, .facts dd { padding: 0.7rem 0 0.75rem; border-bottom: 1px solid var(--rule); }
.facts dt { font-weight: 700; }
.pages { margin: 0 0 1.5rem; }
.pages ul { row-gap: 1.75rem; }
.pages a { position: relative; padding: 0.8rem 2.25rem 0 0; border-top: 5px solid var(--ink); }
.pages a::after { content: ""; position: absolute; top: 0.95rem; right: 0; width: 1.35rem; height: 1.35rem; background: currentColor; -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
.pages a strong { margin-bottom: 0.4rem; font: 700 1.3rem/1.12 ${GROTESK}; letter-spacing: -0.02em; text-wrap: balance; }
.pages a span { font-size: 0.9375rem; line-height: 1.4; color: var(--muted); }
.pages a:hover { color: var(--accent); border-top-color: var(--accent); }
.pages a:hover::after { transform: translateX(0.2rem); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.25rem, 1fr)); gap: 1.5rem; margin: 1rem 0 2rem; }
.figure { margin: 0; padding-top: 0.75rem; border-top: 5px solid var(--ink); font-size: 0.9375rem; line-height: 1.35; }
.figure strong { display: block; margin-bottom: 0.5rem; font: 700 clamp(3rem, 6.5vw, 5rem)/0.9 ${GROTESK}; letter-spacing: -0.045em; font-variant-numeric: lining-nums; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1.5rem; margin: 0 0 1.5rem; }
.columns > * { padding-top: 0.75rem; border-top: 5px solid var(--ink); }
.columns h3 { margin-top: 0; }
table { font-size: 0.9375rem; line-height: 1.4; }
caption { padding-bottom: 0.6rem; font-weight: 700; }
thead th { font-weight: 700; border-bottom: 2px solid var(--ink); }
tbody th, tbody td { border-bottom: 1px solid var(--rule); }
.steps { counter-reset: step; list-style: none; padding: 0; }
.steps li { counter-increment: step; position: relative; padding: 0.8rem 0 0.8rem 3rem; border-top: 1px solid var(--rule); }
.steps li::before { content: counter(step, decimal-leading-zero); position: absolute; top: 0.8rem; left: 0; font-weight: 700; font-variant-numeric: tabular-nums lining-nums; color: var(--accent); }
details { margin-top: 1rem; padding: 0.8rem 0; border-top: 1px solid var(--ink); }
summary { cursor: pointer; font-weight: 700; }
details > :last-child { margin-bottom: 0; }
@media (max-width: 48rem) {
  section > *, section > h2, section.wide > h2, .opening .lead, .opening .meta { grid-column: 1 / -1; grid-row: auto; }
  section > h2, section.wide > h2 { position: static; margin-bottom: 1.25rem; }
  section.wide > h2 + p { margin-bottom: 1em; }
  .opening .meta { order: 9; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.2rem; }
}
@media (prefers-reduced-motion: reduce) { .pages a::after { transition: none; } }
@media print { section > h2 { position: static; } }
`;

// ---- Briefing deck ----------------------------------------------------------------------------

const BRIEFING = `${schemes(
  {
    "--paper": "#f5f2ec", "--ink": "#12151b", "--muted": "#51555e", "--rule": "#d6d0c4", "--card": "#ebe6dc",
    "--field": "#12151b", "--on-field": "#f5f2ec", "--on-field-soft": "#c9ccd3", "--signal": "#f2b705", "--on-signal": "#12151b",
    "--accent": "#8f4600", "--focus": "#8f4600", "--ok": "#1b6b3d", "--caution": "#8a4f00", "--open": "#51555e",
    "--select": "#f2b705", "--on-select": "#12151b",
  },
  {
    "--paper": "#0f1115", "--ink": "#eef0f3", "--muted": "#a4a9b3", "--rule": "#2a2e36", "--card": "#181b21",
    "--field": "#1a1f29", "--on-field": "#f3f1ec", "--on-field-soft": "#b9bdc6", "--signal": "#f5c542", "--on-signal": "#12151b",
    "--accent": "#f5c542", "--focus": "#f5c542", "--ok": "#6fd19a", "--caution": "#f2b35e", "--open": "#a4a9b3",
    "--select": "#f5c542", "--on-select": "#12151b",
  },
)}${faces({ sans: FACES.systemSans })}${BASE}
html { scroll-snap-type: y proximity; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.125rem/1.55 ${SYSTEM_SANS}; counter-reset: slide; -webkit-font-smoothing: antialiased; }
.page { margin: 0; padding: 0; }
.opening, section { position: relative; display: flex; flex-direction: column; justify-content: center; min-height: 100vh; min-height: 100svh; padding: clamp(2.5rem, 6vw, 6rem) clamp(1.25rem, 7vw, 8rem); scroll-snap-align: start; counter-increment: slide; }
.opening { background: var(--field); color: var(--on-field); }
.opening a { color: inherit; }
.kicker { margin: 0; font: 700 0.8125rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
.opening .kicker { color: var(--signal); }
h1 { max-width: 15ch; margin: 0.75rem 0 1.5rem; font: 800 clamp(2.5rem, 7.4vw, 6rem)/0.97 ${SYSTEM_SANS}; letter-spacing: -0.035em; text-wrap: balance; }
.lead { max-width: 34ch; margin: 0 0 2.25rem; font: 400 clamp(1.2rem, 2.3vw, 1.65rem)/1.4 ${SYSTEM_SANS}; color: var(--on-field-soft); }
.meta { margin: 0; font: 600 0.8125rem/1.4 ${SYSTEM_SANS}; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.opening .meta { color: var(--on-field-soft); }
section + section { border-top: 1px solid var(--rule); }
section::after { content: counter(slide, decimal-leading-zero); position: absolute; right: clamp(1.25rem, 4vw, 3rem); bottom: clamp(1rem, 3vw, 2rem); font: 700 0.8125rem/1 ${SYSTEM_SANS}; letter-spacing: 0.08em; color: var(--muted); }
section > h2 { max-width: 19ch; margin: 0 0 1.5rem; font: 800 clamp(1.9rem, 4.8vw, 3.7rem)/1.03 ${SYSTEM_SANS}; letter-spacing: -0.028em; text-wrap: balance; }
section > h2[data-label]::before { content: attr(data-label); display: block; margin-bottom: 0.9rem; font: 700 0.8125rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
h3 { margin: 0 0 0.5rem; font: 700 1.25rem/1.25 ${SYSTEM_SANS}; letter-spacing: -0.01em; }
p, ul, ol { max-width: 40rem; margin: 0 0 1em; }
a { color: var(--accent); text-decoration-thickness: 2px; text-underline-offset: 0.18em; }
.quote { max-width: 52rem; margin: 0 0 2rem; }
.quote blockquote { margin: 0; font: 700 clamp(1.6rem, 3.7vw, 2.9rem)/1.13 ${SYSTEM_SANS}; letter-spacing: -0.022em; }
.quote blockquote::before { content: "\\201C"; display: block; height: 0.5em; font: 800 2.4em/1 ${SYSTEM_SANS}; color: var(--accent); }
.quote blockquote p { max-width: 24ch; margin: 0; }
.quote figcaption { margin-top: 1rem; font-size: 0.9375rem; color: var(--muted); }
.note { max-width: 32rem; margin: 0 0 1.5rem; padding-top: 0.6rem; border-top: 2px solid var(--ink); font-size: 1rem; color: var(--muted); }
.callout { max-width: 44rem; margin: 1.5rem 0; padding: 1.4rem 1.6rem; border-radius: 0.9rem; background: var(--field); color: var(--on-field); }
.callout[data-tone="caution"] { background: var(--signal); color: var(--on-signal); }
.callout a { color: inherit; }
.callout > :last-child { margin-bottom: 0; }
.status { display: inline-block; padding: 0.3em 0.7em; border-radius: 999px; font: 700 0.75rem/1 ${SYSTEM_SANS}; letter-spacing: 0.02em; vertical-align: 0.15em; box-shadow: inset 0 0 0 1.5px currentColor; }
.status[data-state="evidence"] { color: var(--ok); }
.status[data-state="caution"] { color: var(--caution); }
.status[data-state="open"] { color: var(--open); }
.tag { font: 700 0.75rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.04em; color: var(--muted); }
.timeline { gap: 1.25rem; max-width: 72rem; margin: 0 0 1.5rem; }
.timeline > li { padding: 1.5rem; border-radius: 0.9rem; background: var(--card); }
.timeline time { margin-bottom: 0.6rem; font: 700 0.8125rem/1.2 ${SYSTEM_SANS}; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.timeline strong { margin-bottom: 0.5rem; font: 800 1.5rem/1.1 ${SYSTEM_SANS}; letter-spacing: -0.02em; }
.timeline p { font-size: 1rem; line-height: 1.4; color: var(--muted); }
.lines { max-width: 60rem; margin: 0 0 1.5rem; border-bottom: 1px solid var(--rule); font-size: 1.0625rem; line-height: 1.4; }
.lines > li { padding: 0.85rem 0; border-top: 1px solid var(--rule); }
.lines strong { font-weight: 700; }
.facts { max-width: 52rem; margin: 0 0 1.5rem; border-bottom: 1px solid var(--rule); }
.facts dt, .facts dd { padding: 0.85rem 0; border-top: 1px solid var(--rule); }
.facts dt { font: 700 0.8125rem/1.9 ${SYSTEM_SANS}; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.pages { max-width: 72rem; margin: 0 0 1.5rem; }
.pages ul { gap: 1.25rem; }
.pages a { padding: 1.5rem; border-radius: 0.9rem; background: var(--field); color: var(--on-field); }
.pages a strong { margin-bottom: 0.4rem; font: 800 1.4rem/1.1 ${SYSTEM_SANS}; letter-spacing: -0.02em; }
.pages a span { font-size: 1rem; line-height: 1.4; color: var(--on-field-soft); }
.pages a:hover strong { color: var(--signal); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 2rem; max-width: 72rem; margin: 1rem 0 2rem; }
.figure { margin: 0; font-size: 1rem; line-height: 1.35; color: var(--muted); }
.figure strong { display: block; margin-bottom: 0.4rem; font: 800 clamp(3.4rem, 8.5vw, 6.5rem)/0.88 ${SYSTEM_SANS}; letter-spacing: -0.05em; color: var(--accent); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.25rem; max-width: 72rem; margin: 0 0 1.5rem; }
.columns > * { padding: 1.5rem; border-radius: 0.9rem; background: var(--card); }
.columns > * > :last-child { margin-bottom: 0; }
.table-wrap { max-width: 72rem; }
table { font-size: 1rem; line-height: 1.4; }
caption { padding-bottom: 0.75rem; font-weight: 700; font-size: 1.1rem; }
thead th { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); border-bottom: 2px solid var(--ink); }
tbody th, tbody td { border-bottom: 1px solid var(--rule); }
.steps { counter-reset: step; list-style: none; padding: 0; max-width: 44rem; }
.steps li { counter-increment: step; position: relative; padding: 0.9rem 0 0.9rem 3.25rem; border-top: 1px solid var(--rule); font-size: 1.2rem; }
.steps li::before { content: counter(step); position: absolute; top: 0.75rem; left: 0; font: 800 2rem/1 ${SYSTEM_SANS}; font-variant-numeric: lining-nums; color: var(--accent); }
details { max-width: 44rem; margin-top: 1rem; }
summary { cursor: pointer; font-weight: 700; }
@media (max-width: 48rem) {
  .facts dt { padding-bottom: 0; }
  .facts dd { padding-top: 0; border-top: 0; }
}
@media print {
  html { scroll-snap-type: none; }
  .opening, section { min-height: 0; padding: 1.5rem 0; break-inside: avoid-page; }
  .opening { background: none; color: var(--ink); }
  .opening .lead, .opening .meta { color: var(--muted); }
  section::after { display: none; }
}
`;

/** The stylesheet of a generated title page in a product with no Story style: plain and readable, in no one's look. */
export const PLAIN_STYLESHEET = `${schemes(
  { "--paper": "#ffffff", "--ink": "#1a1a1a", "--muted": "#555555", "--focus": "#1a1a1a" },
  { "--paper": "#161616", "--ink": "#e9e9e9", "--muted": "#b0b0b0", "--focus": "#e9e9e9" },
)}${faces({ text: FACES.serifText })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 1.125rem/1.6 ${SERIF_TEXT}; }
.page { max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem; }
h1 { margin: 0 0 1rem; font-size: clamp(2rem, 5vw, 2.75rem); line-height: 1.1; text-wrap: balance; }
.lead { margin: 0; font-size: 1.25rem; color: var(--muted); }
`;

const rule = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

export const HOUSE_STYLES: HouseStyle[] = [
  {
    id: "broadsheet",
    name: "Broadsheet",
    summary: "A newspaper long read: a double rule, a kicker, a big serif headline, a drop cap, pull quotes and ruled figure bands.",
    best_for: "Narrative pages for leadership and mixed readers: where the discovery stands, what we heard, what we propose.",
    character: "Serious, confident, editorial. Warm newsprint paper, near-black ink, one deep red for the kicker, drop cap and links.",
    signature: ["Kicker above the headline", "Drop cap on the first section", "Pull quote with a large red opening mark", "Floated sidebar note with a heavy top rule", "Figure band between two rules", "text-columns for a long passage of running prose"],
    avoid: ["Rounded corners and shadows", "Coloured boxes behind headings", "More than one accent colour", "Centred body text"],
    rules: `# Broadsheet\n\nAn editorial long read.\n\n${rule([
      "Open with a headline that states the conclusion, an italic standfirst (.lead) and a meta line. A kicker above the headline is optional: use it for a theme the headline lacks.",
      "Section labels (h2) are small uppercase sans; subheads (h3) are serif. Body is serif with old-style figures.",
      "Use one pull quote per page at most, from the strongest passage. Quote exactly.",
      "Put sources and limits in a floated .note beside the prose, not in a box under it.",
      "Figures sit in a ruled band (.figures); numbers are lining and large.",
      "Red is for the kicker, section labels, the dates of a timeline, the drop cap, links and step numbers only.",
      "A timeline sits in a ruled band like the figures; a line per item (ul.lines) and labelled facts (dl.facts) are ruled lists, never boxes.",
    ])}\n`,
    stylesheet: BROADSHEET,
  },
  {
    id: "tufte",
    name: "Tufte",
    summary: "A quiet book page after Edward Tufte's handouts: a wide margin for notes, italic headings, small caps, booktabs tables and sparklines.",
    best_for: "Evidence-dense pages for the product trio: detailed findings, comparisons and numbers that need their context beside them.",
    character: "Calm, scholarly, data-first. Cream paper, black ink, no accent colour; meaning comes from type and position.",
    signature: ["Margin notes (.note) beside the text they explain", "Small-caps first line of each section", "Booktabs tables: heavy top and bottom rules, no verticals", "Inline sparklines (svg.spark) next to a number", "Quotes attributed with a right-aligned em dash"],
    avoid: ["Bold headings", "Coloured panels", "Cards and grids of boxes", "Charts with gridlines, legends or 3D"],
    rules: `# Tufte\n\nA book page with a wide margin.\n\n${rule([
      "Text runs at 55% of the page; the right margin carries notes, sources and small figures.",
      "Put a .note before the paragraph it annotates, or a span.note inside the paragraph.",
      "Headings are italic and regular weight. Emphasis is italic, never bold colour.",
      "Show numbers in the sentence that uses them; add an inline sparkline (svg.spark) when a trend matters.",
      "Tables use rules only above, below and under the header.",
      "No colour except the status words, which also say their state.",
      "A timeline, a line per item (ul.lines) and labelled facts (dl.facts) run at the width of a table, between the same two heavy rules.",
    ])}\n`,
    stylesheet: TUFTE,
  },
  {
    id: "swiss",
    name: "Swiss grid",
    summary: "The International Typographic Style: a twelve-column grid, a huge grotesk headline, numbered sections in a left column, big numerals and one red.",
    best_for: "Decision pages and briefs for delivery partners: options, criteria, what is decided and what is not.",
    character: "Rational, direct, high contrast. White paper, black type, heavy rules and a single signal red.",
    signature: ["Section labels in a sticky left column, numbered unless the section names its own", "Headline across eleven columns, standfirst offset to column five", "Oversized numerals over heavy rules, for figures and for the milestones of a timeline", "One line per item in aligned columns under a heavy rule", "Solid black or red callouts", "Solid status blocks"],
    avoid: ["Centred layouts", "Serif type", "Rounded corners", "Decorative imagery", "A second accent colour"],
    rules: `# Swiss grid\n\nA twelve-column grid with flush-left grotesk type.\n\n${rule([
      "Each section's h2 sits in columns 1 to 4 with its number, or with its own label (data-label); content runs in columns 5 to 12.",
      "A wide section (section.wide) runs its timeline, lines, facts, figures, columns, tables and page links across all twelve columns; its prose stays in columns 5 to 12.",
      "Headlines are tight and heavy; everything is flush left.",
      "Use .figures for the two or three numbers that matter, at full size.",
      "Callouts are solid: black for context, red for caution.",
      "Red appears only for section numbers and labels, the dates of a timeline, caution, links and step numbers.",
      "On a phone the grid collapses to one column in reading order.",
    ])}\n`,
    stylesheet: SWISS,
  },
  {
    id: "briefing",
    name: "Briefing deck",
    summary: "A deck you scroll: every section is a full-screen slide with one statement, an ink title slide, huge numbers and a slide counter.",
    best_for: "Short stakeholder briefings and readouts: one idea per screen, read in a few minutes or presented in a meeting.",
    character: "Bold, spacious, presentational. Warm paper slides, an ink title slide with a marigold signal, heavy sans headlines.",
    signature: ["Full-screen sections that snap as you scroll", "Ink title slide with a marigold kicker", "A statement headline per slide, not a topic label", "Numbers at display size", "Slide counter in the corner"],
    avoid: ["More than one idea per slide", "Long paragraphs", "Topic-label headings such as 'Background'", "Nested cards"],
    rules: `# Briefing deck\n\nOne idea per screen.\n\n${rule([
      "Each section is a slide; its h2 is the statement the slide proves, in a full sentence.",
      "Keep a slide to its statement, one piece of evidence (a quote, figures or a short table) and at most two short paragraphs.",
      "The opening is the title slide: the conclusion as h1, a standfirst and the meta line, with a kicker above when it adds a theme.",
      "Milestones (ol.timeline) and links to pages (nav.pages) are the only cards; a line per item (ul.lines) is a ruled list.",
      "Put caveats that change the conclusion on their own slide, in a caution callout.",
      "The slides stack into an ordinary document in print.",
    ])}\n`,
    stylesheet: BRIEFING,
  },
];

export const HOUSE_STYLE_IDS = HOUSE_STYLES.map((s) => s.id) as [HouseStyle["id"], ...HouseStyle["id"][]];

export function houseStyle(id: string): HouseStyle | undefined {
  return HOUSE_STYLES.find((s) => s.id === id);
}

/** The shared vocabulary every house style styles. */
export const VOCABULARY = [
  { element: `<main class="page">`, role: "The page container." },
  { element: `<header class="opening">`, role: "Opening: .kicker, h1 (the conclusion), .lead (why it matters), .meta (date, status)." },
  { element: "<section> with an h2", role: "One job per section. h3 for subheads." },
  { element: `<figure class="quote"><blockquote>…</blockquote><figcaption>…</figcaption></figure>`, role: "An exact quotation with who, when and a link to the passage." },
  { element: `<aside class="note">`, role: "A side note: sources, limits, a definition. A margin note in Tufte, a sidebar in Broadsheet." },
  { element: `<aside class="callout" data-tone="caution">`, role: "Something that changes how the page should be read. Say its status in words." },
  { element: `<span class="status" data-state="evidence|caution|open">`, role: "A state label; the text always names the state." },
  { element: `<div class="figures"><p class="figure"><strong>23</strong> what was counted</p></div>`, role: "Real numbers with what they count." },
  { element: `<div class="columns"><article>…</article></div>`, role: "Comparable alternatives side by side." },
  { element: `<div class="table-wrap" role="region" aria-label="…" tabindex="0"><table>…</table></div>`, role: "Every table, so it scrolls inside itself on a phone." },
  { element: `<ol class="steps">`, role: "Ordered next steps with a real order." },
  { element: `<section class="wide">`, role: "A section whose content needs the page's full width: a timeline, a matrix, a line per item. In a style with a label column, prose stays in the text column and the blocks run full width." },
  { element: `<h2 data-label="…">`, role: "A short label set above or beside a section's heading, when it carries something the heading does not: a date, a release, a stage." },
  { element: `<ol class="timeline"><li><time datetime="2026-11">November 2026</time><strong>What is delivered</strong><p>…</p></li></ol>`, role: "Dated milestones in order: a release plan, a roadmap, the stages of a study. Two to four." },
  { element: `<ul class="lines"><li><strong>Name</strong><span>What it means for the reader.</span><span class="tag">Group</span></li></ul>`, role: "One line per item, in aligned columns: features, risks, requirements. The last element (a .tag or a .status) is optional." },
  { element: `<dl class="facts"><dt>In scope</dt><dd>…</dd></dl>`, role: "Labelled facts about one thing: scope, what it serves, how it is measured." },
  { element: `<nav class="pages" aria-label="…"><ul><li><a href="…"><strong>Page title</strong><span>What the page holds.</span></a></li></ul></nav>`, role: "Links to other Story pages, each with a line on what it holds: the pages beneath a landing page, or where to read next." },
  { element: "<details><summary>", role: "Optional method detail; never hide a consequential caveat." },
];

/** A synthetic specimen page (the sample product's story) in the shared vocabulary, for previews. */
export function specimenBody(): string {
  return `<main class="page">
<header class="opening">
<p class="kicker">Crewboard · Where discovery stands</p>
<h1>The costly part of planning is sending the plan, not making it</h1>
<p class="lead">Crew leads spend a Friday afternoon building next week. The mistakes that reach customers happen afterwards, when the plan is typed out to each crew.</p>
<p class="meta">Sample discovery · Updated 26 September 2026 · Working interpretation</p>
</header>
<section aria-labelledby="heard">
<h2 id="heard">What we heard</h2>
<aside class="note">Four sources: two interviews, notes from an owner call and a survey export of 23 responses. Every person and company here is invented.</aside>
<p>Planning is a weekly ritual of two to three hours, in a spreadsheet or on paper. The errors crews feel, a wrong address or a double booking, enter when the plan is copied into messages by hand.</p>
<figure class="quote"><blockquote><p>The texts are the worst part honestly. Every crew lead gets a message with their jobs and addresses, and I type those by hand.</p></blockquote><figcaption>Crew lead, landscaping · interview · <a href="#heard">segment 8</a></figcaption></figure>
<div class="figures">
<p class="figure"><strong>2–3 h</strong> to build each week's plan, as crew leads describe it</p>
<p class="figure"><strong>23</strong> survey responses in one export</p>
<p class="figure"><strong>4</strong> sources behind this page</p>
</div>
</section>
<section aria-labelledby="start">
<h2 id="start">Test the hand-off before the planning grid</h2>
<div class="columns">
<article><h3>Generate the hand-off</h3><p>Send each crew its week as a message built from the plan. <span class="status" data-state="evidence">Decided</span></p></article>
<article><h3>Rebuild the planning grid</h3><p>A better grid for the Friday afternoon itself. <span class="status" data-state="open">Not yet tested</span></p></article>
</div>
<div class="table-wrap" role="region" aria-label="How the two starts compare" tabindex="0"><table><caption>How the two starts compare</caption><thead><tr><th scope="col">Start</th><th scope="col">Where errors enter</th><th scope="col">Evidence</th></tr></thead><tbody><tr><th scope="row">Hand-off</th><td>Covered: the typed message</td><td>Two interviews</td></tr><tr><th scope="row">Planning grid</th><td>Not covered</td><td>One owner call</td></tr></tbody></table></div>
<aside class="callout" data-tone="caution"><p><strong>Assumption, unconfirmed.</strong> Crew leads think in jobs rather than days. If they think in days, the message needs a different shape.</p></aside>
</section>
<section class="wide" aria-labelledby="plan">
<h2 id="plan" data-label="The plan">Two tests come before anyone builds a grid</h2>
<p>Both are proposals. Neither has an owner yet, and the months are the team's intention, not a commitment.</p>
<ol class="timeline">
<li><time datetime="2026-10">October 2026</time><strong>Prototype the hand-off</strong><p>A message generated from the plan, tested with two crews.</p></li>
<li><time datetime="2026-11">November 2026</time><strong>Hear from cleaning crews</strong><p>Two more owner interviews about how they think about the week.</p></li>
</ol>
<ul class="lines">
<li><strong>Message from the plan</strong><span>Each crew lead receives their week without anyone typing it out.</span><span class="tag">First test</span></li>
<li><strong>Jobs or days</strong><span>We learn which of the two a crew lead plans in.</span><span class="tag">Second test</span></li>
</ul>
</section>
<section aria-labelledby="next">
<h2 id="next">What we do next</h2>
<dl class="facts">
<dt>In scope</dt><dd>The message each crew receives.</dd>
<dt>Out of scope</dt><dd>The planning grid itself.</dd>
</dl>
<ol class="steps"><li><strong>Prototype the message.</strong> Generate it from the plan, and test it with two crews.</li><li><strong>Interview two more owners</strong> of cleaning crews about how they think about the week.</li></ol>
<nav class="pages" aria-label="Pages beneath this one"><ul>
<li><a href="#heard"><strong>What we heard</strong><span>Four sources, and the words crew leads used.</span></a></li>
<li><a href="#start"><strong>The two starts compared</strong><span>Where errors enter, and what each start covers.</span></a></li>
</ul></nav>
<details><summary>How we know this</summary><p>Quotes are exact and link to their passages. Counts come from the survey export; nothing here is estimated.</p></details>
</section>
</main>`;
}

/** A complete page: a stylesheet around a body. */
export function pageDocument(title: string, stylesheet: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</title>
<style>
${stylesheet}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function houseSpecimen(style: HouseStyle): string {
  return pageDocument(`${style.name}: a Story page specimen`, style.stylesheet, specimenBody());
}

/** The page the app previews a product's Story style on: its own specimen, or the sample page in its stylesheet. */
export function styleSpecimen(s: { name: string; stylesheet: string; specimen_html: string | null }): string {
  return s.specimen_html ?? pageDocument(`${s.name}: a Story page specimen`, s.stylesheet, specimenBody());
}
