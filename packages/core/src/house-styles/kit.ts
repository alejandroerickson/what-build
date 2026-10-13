/**
 * What every house style is built from: its light and dark schemes, the faces it names once, and
 * BASE, the rules no style should have to repeat (box model, reflow, focus, and the structure of the
 * shared vocabulary). A style then gives the vocabulary its character on top.
 */

import { THEME_ATTRIBUTE } from "../story-theme.ts";

export type HouseStyleId =
  | "clear" | "large" | "report" | "tonal" | "wide" | "pastel" | "wayfinding" | "isotype" | "blocks" | "riso";

export interface HouseStyle {
  id: HouseStyleId;
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

export type Scheme = Record<string, string>;

const decl = (tokens: Scheme, indent: string) =>
  Object.entries(tokens)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join("\n");

/** Light by default; dark by system preference unless the app forces light; forced either way by the app. */
export function schemes(light: Scheme, dark: Scheme): string {
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

/**
 * Each style names its faces once, as custom properties, and every rule refers to them. A team
 * adapting a style changes a face in one place, and the stylesheet pasted into every page stays small.
 * A face WhatBuild carries (story-fonts.ts) is named in double quotes, which is how the server finds it.
 */
export const faces = (f: Record<string, string>) => `:root { ${Object.entries(f).map(([k, v]) => `--${k}: ${v};`).join(" ")} }\n`;

/**
 * An SVG as a CSS url() of a data: URI, quoted. Parentheses are escaped too, so an SVG that refers to
 * its own filter (url(#n)) never reads as a url() that would reach the network.
 */
export const svgUrl = (svg: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s*\n\s*/g, " ").trim()).replace(/\(/g, "%28").replace(/\)/g, "%29")}")`;

/** Markdown bullet list for a style's rules. */
export const rule = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

/** What every house style needs regardless of character: box model, reflow, focus, table scrolling, and the vocabulary's structure. */
export const BASE = `*, *::before, *::after { box-sizing: border-box; }
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
.pages a span.tag, .pages a span.status { display: inline-block; }
mark { padding: 0 0.12em; border-radius: 0.12em; background: var(--mark, color-mix(in srgb, var(--accent, currentColor) 24%, transparent)); color: inherit; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.quotes { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.5rem; max-width: none; margin: 2rem 0; }
.quotes > .quote { margin: 0; max-width: none; }
.flow { list-style: none; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2.5rem; max-width: none; margin: 2rem 0; padding: 0; counter-reset: flow; }
.flow > li { position: relative; counter-increment: flow; }
.flow > li > strong, .flow > li > span:not(.tag):not(.status) { display: block; }
.flow > li + li::before { content: ""; position: absolute; top: 1.2rem; left: -2.05rem; width: 1.6rem; height: 1rem; background: currentColor; -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; }
.diagram { max-width: 100%; margin: 2rem 0; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }
.diagram svg { display: block; width: 100%; min-width: 34rem; max-width: 52rem; height: auto; overflow: visible; }
.diagram .node { fill: var(--paper); stroke: currentColor; stroke-width: 1.5; }
.diagram .node.key { fill: var(--accent, currentColor); stroke: var(--accent, currentColor); }
.diagram .edge { fill: none; stroke: currentColor; stroke-width: 1.5; }
.diagram .head { fill: currentColor; stroke: none; }
.diagram .label { fill: currentColor; font-size: 14px; }
.diagram .label.small { fill: var(--muted); font-size: 12px; }
.diagram .label.on-key { fill: var(--on-accent, var(--paper)); }
.diagram figcaption, .shot figcaption { margin-top: 0.75rem; }
.shot { margin: 2rem 0; }
.shot .screen { position: relative; }
.shot .screen > img, .shot .screen > svg { display: block; width: 100%; height: auto; }
.shot[data-device="phone"] { display: grid; grid-template-columns: minmax(0, 20rem) minmax(0, 1fr); gap: 1.5rem 3rem; align-items: start; }
.shot[data-device="phone"] figcaption { margin-top: 0; }
.pin { position: absolute; left: var(--x, 50%); top: var(--y, 50%); z-index: 1; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; margin: -0.875rem 0 0 -0.875rem; border-radius: 50%; background: var(--accent, var(--ink)); color: var(--on-accent, var(--paper)); font-size: 0.8125rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums lining-nums; }
.pins { list-style: none; max-width: none; padding: 0; counter-reset: pin; }
.pins > li { position: relative; min-height: 1.75rem; padding-left: 2.6rem; counter-increment: pin; }
.pins > li + li { margin-top: 1rem; }
.pins > li::before { content: counter(pin); position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--accent, var(--ink)); color: var(--on-accent, var(--paper)); font-size: 0.8125rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums lining-nums; }
.tally { --dot: 0.8em; display: inline-block; max-width: 100%; height: calc(var(--dot) * 0.84); width: calc(var(--of, 10) * var(--dot) - var(--dot) * 0.16); vertical-align: -0.04em; background: linear-gradient(90deg, var(--tally, currentColor) calc(var(--n, 0) * var(--dot)), var(--tally-off, color-mix(in srgb, currentColor 22%, transparent)) 0); -webkit-mask: radial-gradient(circle closest-side, #000 94%, transparent) calc(var(--dot) * -0.08) 0 / var(--dot) 100% repeat-x; mask: radial-gradient(circle closest-side, #000 94%, transparent) calc(var(--dot) * -0.08) 0 / var(--dot) 100% repeat-x; }
@media (max-width: 48rem) {
  .lines { grid-template-columns: minmax(0, 1fr) auto; }
  .lines > li { grid-template-columns: minmax(0, 1fr) auto; grid-template-columns: subgrid; }
  .lines > li > :nth-child(2):not(:last-child) { grid-column: 1 / -1; grid-row: 2; }
  .lines > li > :nth-child(2):last-child { grid-column: 1 / -1; }
  .facts { grid-template-columns: minmax(0, 1fr); }
  .facts dt { padding-right: 0; }
  .flow { grid-auto-flow: row; gap: 2.4rem; }
  .flow > li + li::before { top: -1.9rem; left: 0.3rem; transform: rotate(90deg); }
  .shot[data-device="phone"] { grid-template-columns: minmax(0, 1fr); }
  .shot[data-device="phone"] .screen { width: 100%; max-width: 20rem; }
}
@media print {
  .timeline > li, .lines > li, .pages li, .figure, .quote, .callout, tr, .flow > li, .diagram, .shot { break-inside: avoid; }
  h2, h3 { break-after: avoid; }
  .pin, .pins > li::before, .tally, mark { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;
