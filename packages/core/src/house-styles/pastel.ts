import { BASE, faces, rule, schemes, svgUrl, type HouseStyle } from "./kit.ts";

/** An opening quotation mark drawn as two blocks with rising tails. */
const QUOTE = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1 -1 35 31'><path d='M0 29V17C0 9.5 3.6 4 10.5 1l2 3.4C8.6 6.6 6.9 9.6 6.6 13H14v16ZM19 29V17C19 9.5 22.6 4 29.5 1l2 3.4C27.6 6.6 25.9 9.6 25.6 13H33v16Z' stroke='#000' stroke-width='1.5' stroke-linejoin='round'/></svg>`);

/** A rounded warning triangle with the exclamation cut out. */
const WARN = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 22'><path fill-rule='evenodd' d='M10.3 2.5a2 2 0 0 1 3.4 0l8.7 15a2 2 0 0 1-1.7 3H3.3a2 2 0 0 1-1.7-3ZM10.8 7.4h2.4l-.3 6.2h-1.8ZM12 15.4a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z'/></svg>`);

/** A disc with a check cut out. */
const CHECK = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path fill-rule='evenodd' d='M10 0a10 10 0 1 0 0 20 10 10 0 1 0 0-20ZM4.8 10.3l1.6-1.6 2.1 2.1 5-5 1.6 1.6-6.6 6.6Z'/></svg>`);

const m = (v: string) => `-webkit-mask: var(${v}) center / contain no-repeat; mask: var(${v}) center / contain no-repeat;`;

/** Tiles take their colour by position: peach, mint, sky, lilac, butter, then again. */
const TILES = ["mint", "sky", "lilac", "butter"].map((t, i) => `:is(.figures, .columns, .pages ul) > :nth-child(5n+${(i + 2) % 5}) { --t: var(--${t}); --t2: var(--${t}-2); }`).join("\n");

const NODES = ["peach", "mint", "sky", "lilac", "butter"].map((t, i) => `.diagram rect.node:nth-of-type(5n+${(i + 1) % 5}) { fill: var(--${t}); }`).join("\n");

/**
 * Pastel: soft colour tiles under crisp near-black type. Every box (a figure, a column, a page link,
 * a quote, a callout, a milestone) sits on a pale tint from a set of five, assigned by position, with
 * 8px corners and no borders or shadows. Type, links and numbers stay near-black; colour lives in
 * the tiles and in the status pills. Dark is its own scheme: a near-black ground with a raised step,
 * the five tints as deep tiles, light type. Onest throughout.
 */
const CSS = `${schemes(
  {
    "--paper": "#ffffff", "--ink": "#16181d", "--muted": "#4f545c", "--rule": "#e5e6e8", "--tint": "#f4f5f6", "--dash": "#80858d",
    "--peach": "#ffe3d3", "--peach-2": "#7a3f22", "--mint": "#d5f2e3", "--mint-2": "#245a40", "--sky": "#d9ebff", "--sky-2": "#2b4f73",
    "--lilac": "#ebe3fb", "--lilac-2": "#4f4378", "--butter": "#fff1c2", "--butter-2": "#66520f",
    "--accent": "#16181d", "--on-accent": "#ffffff", "--focus": "#16181d", "--select": "#bcd9fb", "--on-select": "#16181d",
    "--ok": "#11643f", "--caution": "#8a3a12", "--open": "#24527a", "--mark": "#ffe9a3", "--node-line": "transparent",
  },
  {
    "--paper": "#15171b", "--ink": "#eceef1", "--muted": "#a9aeb6", "--rule": "#2e3238", "--tint": "#1f2227", "--dash": "#7d838c",
    "--peach": "#3b2820", "--peach-2": "#e7bba5", "--mint": "#1c3328", "--mint-2": "#a3d6bb", "--sky": "#1b2c40", "--sky-2": "#a6c7ea",
    "--lilac": "#2c2540", "--lilac-2": "#c5b9ea", "--butter": "#3a321a", "--butter-2": "#e0cf96",
    "--accent": "#eceef1", "--on-accent": "#15171b", "--focus": "#eceef1", "--select": "#35577d", "--on-select": "#ffffff",
    "--ok": "#8ad8ae", "--caution": "#f4a57d", "--open": "#96c3ee", "--mark": "#5e4d1d", "--node-line": "#4a4f58",
  },
)}${faces({ sans: '"Onest", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' })}${BASE}
:root { --r: 8px; --quote: ${QUOTE}; --warn: ${WARN}; --check: ${CHECK}; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); }
.page { max-width: 62rem; margin: 0 auto; padding: clamp(2.5rem, 7vw, 5.5rem) clamp(1.25rem, 4vw, 3rem) 6rem; }
.opening { display: grid; justify-items: start; gap: 1.25rem; margin-bottom: clamp(3.5rem, 7vw, 5rem); }
.opening > * { margin: 0; }
.kicker { margin-bottom: -0.25rem; font: 600 0.875rem/1.3 var(--sans); color: var(--muted); }
h1 { max-width: 19ch; font: 700 clamp(2.3rem, 5.6vw, 3.75rem)/1.05 var(--sans); letter-spacing: -0.025em; }
.lead { max-width: 40rem; font-size: clamp(1.1875rem, 2vw, 1.375rem); line-height: 1.5; }
.opening .meta { max-width: 52rem; margin-top: 0.25rem; font: 500 0.8125rem/1.45 var(--sans); color: var(--muted); }
.opening .meta, .opening .meta:has(> span:not(.status)) > :not(.status) { padding: 0.4rem 0.75rem; border-radius: 6px; background: var(--tint); }
.opening .meta:has(> span:not(.status)) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0; background: none; }
section { margin-top: clamp(3.75rem, 7vw, 5rem); }
h2 { max-width: 30ch; margin: 0 0 1.1rem; font: 650 1.75rem/1.2 var(--sans); letter-spacing: -0.015em; }
h2[data-label]::before { content: attr(data-label); display: block; width: fit-content; margin-bottom: 0.9rem; padding: 0.28rem 0.6rem; border-radius: 6px; background: var(--tint); font: 600 0.8125rem/1.3 var(--sans); color: var(--muted); }
h3 { margin: 2rem 0 0.5rem; font: 650 1.2rem/1.3 var(--sans); letter-spacing: -0.01em; }
p, ul, ol { max-width: 40rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.25rem; }
li::marker { color: var(--muted); }
strong { font-weight: 650; }
a { color: inherit; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); text-decoration-thickness: 0.075em; text-underline-offset: 0.22em; }
a:hover { text-decoration-color: currentColor; text-decoration-thickness: 0.1em; }
mark { padding: 0 0.08em; border-radius: 3px; background: var(--mark); color: inherit; }
:is(.figures, .columns, .pages ul) > * { --t: var(--peach); --t2: var(--peach-2); }
${TILES}
.figure, .columns > *, .pages a, .quote, .callout, .timeline > li, .shot { --chip-bg: color-mix(in srgb, var(--paper) 65%, transparent); border-radius: var(--r); }
.figure, .columns > *, .pages a { background: var(--t); }
.figure, .columns > *, .pages a, .quote, .callout { padding: 1.25rem 1.4rem 1.35rem; }
.callout p, .columns p, .figure, .quote, .quote blockquote p, .shot figcaption > p, details p, .text-columns > * { max-width: none; }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.75rem; margin: 1.75rem 0 1.25rem; }
.figure { margin: 0; font-size: 0.9375rem; line-height: 1.45; color: var(--t2); }
.figure strong { display: block; margin-bottom: 0.65rem; font: 700 clamp(2.25rem, 4.2vw, 3rem)/1 var(--sans); letter-spacing: -0.025em; color: var(--ink); font-variant-numeric: lining-nums proportional-nums; }
.note, .diagram figcaption { max-width: 40rem; margin: 1.25rem 0; font-size: 0.9375rem; line-height: 1.5; color: var(--muted); }
.callout { position: relative; max-width: 44rem; margin: 2rem 0; background: var(--sky); }
.callout[data-tone="caution"] { padding-left: 3.5rem; background: var(--peach); }
.callout[data-tone="caution"]::before { content: ""; position: absolute; left: 1.35rem; top: 1.5rem; width: 1.3rem; height: 1.2rem; background: var(--caution); ${m("--warn")} }
.callout > :last-child, .columns > * > :last-child, details > :last-child, .quote blockquote p:last-child { margin-bottom: 0; }
.status { display: inline-flex; align-items: center; gap: 0.42em; padding: 0.2em 0.65em 0.2em 0.55em; border-radius: 999px; background: var(--mint); color: var(--ok); font: 600 0.8125rem/1.35 var(--sans); vertical-align: 0.08em; }
.status::before { content: ""; flex: none; width: 0.56em; height: 0.56em; border-radius: 50%; background: currentColor; }
.status[data-state="caution"] { background: var(--peach); color: var(--caution); }
.status[data-state="caution"]::before { width: 0.68em; height: 0.6em; border-radius: 0; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.status[data-state="open"] { background: var(--sky); color: var(--open); }
.status[data-state="open"]::before { background: none; border: 1.5px solid currentColor; }
.tag { display: inline-block; padding: 0.18em 0.55em; border-radius: 5px; background: var(--chip-bg, var(--tint)); color: var(--ink); font: 600 0.75rem/1.4 var(--sans); vertical-align: 0.1em; }
.timeline { gap: 0.75rem; margin: 2rem 0 2.25rem; }
.timeline > li { position: relative; padding: 1.1rem 1.25rem 1.25rem; background: var(--tint); outline: 1.5px dashed var(--dash); outline-offset: -1.5px; --t2: var(--muted); }
.timeline > li::after { content: ""; position: absolute; top: 1.1rem; right: 1.1rem; width: 1.05rem; height: 1.05rem; border: 2px solid var(--dash); border-radius: 50%; }
.timeline > li[data-state="done"] { background: var(--mint); outline: 0; --t2: var(--mint-2); }
.timeline > li[data-state="done"]::after { border: 0; background: var(--ok); ${m("--check")} }
.timeline > li[aria-current] { background: var(--butter); outline: 2px solid var(--ink); outline-offset: -2px; --t2: var(--butter-2); }
.timeline > li[aria-current]::after { border: 0; background: var(--ink); }
.timeline time { margin: 0 1.75rem 0.55rem 0; font: 600 0.8125rem/1.3 var(--sans); color: var(--t2); }
.timeline strong { margin-bottom: 0.35rem; font: 650 1.125rem/1.25 var(--sans); }
.timeline > li[aria-current] strong { font-weight: 700; }
.timeline p { font-size: 0.9375rem; line-height: 1.45; color: var(--t2); }
.lines, .facts { margin: 1.75rem 0 2rem; border-top: 1px solid var(--rule); }
.lines > li, .facts dt, .facts dd { padding: 0.85rem 0; border-bottom: 1px solid var(--rule); }
.lines strong { font: 650 1rem/1.4 var(--sans); }
.lines > li > span:not(.tag):not(.status), .flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.facts dt { font: 600 0.875rem/1.94 var(--sans); color: var(--muted); }
.pages { margin: 1.75rem 0 1rem; }
.pages ul { gap: 0.75rem; }
.pages a { position: relative; display: flex; flex-direction: column; min-height: 11rem; }
.pages a strong { margin-bottom: 0.4rem; font: 650 1.1875rem/1.25 var(--sans); letter-spacing: -0.01em; }
.pages a:hover strong { text-decoration: underline; text-decoration-thickness: 0.08em; text-underline-offset: 0.2em; }
.pages a span:not(.tag):not(.status) { margin-bottom: 1.25rem; font-size: 0.9375rem; line-height: 1.45; color: var(--t2); }
.pages a .tag, .pages a .status { align-self: flex-start; margin: auto 2.75rem 0 0; }
.pages a::after { content: ""; position: absolute; right: 1.3rem; bottom: 1.35rem; width: 1.25rem; height: 1.25rem; background: var(--ink); ${m("--arrow")} transition: transform 0.2s ease-out; }
.pages a:hover::after, .pages a:focus-visible::after { transform: translateX(0.3rem); }
.flow > li::after, .steps li::before { position: absolute; left: 0; top: 0; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums lining-nums; }
.flow { gap: 2.5rem; margin: 2rem 0 2.5rem; }
.flow > li { padding-top: 3.3rem; font-size: 0.9375rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); width: 2.5rem; height: 2.5rem; font-size: 1.0625rem; }
.flow > li + li::before { top: 0.75rem; }
.flow strong { margin-bottom: 0.25rem; font: 650 1.0625rem/1.3 var(--sans); }
.flow .tag { margin-top: 0.65rem; }
.diagram svg { color: var(--ink); }
.diagram .node { fill: var(--sky); stroke: var(--node-line); stroke-width: 1.25; }
.diagram rect.node { rx: 8px; }
${NODES}
.diagram path.node { fill: var(--lilac); }
.diagram rect.node.key, .diagram .node.key { fill: var(--ink); stroke: var(--ink); }
.diagram .edge { stroke: var(--ink); stroke-width: 1.75; }
.diagram .head { fill: var(--ink); }
.diagram .label { fill: var(--ink); font: 500 14px var(--sans); }
.diagram .label.on-key { fill: var(--on-accent); font-weight: 650; }
.diagram .label.small { fill: var(--muted); font-size: 12.5px; }
.shot { padding: clamp(1rem, 3vw, 1.75rem); background: var(--sky); }
.shot .screen > svg, .shot .screen > img { border-radius: 0.875rem; }
.shot[data-device="phone"] { gap: 1.5rem 2.5rem; }
.shot figcaption { font-size: 0.9375rem; line-height: 1.5; }
.shot figcaption > p { color: var(--sky-2); }
.shot figcaption > p:first-child { margin-bottom: 1.25rem; font-weight: 500; }
.pin { outline: 2px solid var(--paper); }
.pin, .pins > li::before { font: 700 0.8125rem/1 var(--sans); }
.pins { margin: 0; }
.pins > li::before { top: -0.05rem; }
.quote { max-width: 44rem; margin: 2rem 0; padding-top: 1.4rem; background: var(--lilac); }
.quote::before { content: ""; display: block; width: 2.25rem; height: 1.95rem; margin-bottom: 1rem; background: var(--ink); ${m("--quote")} }
.quote blockquote { margin: 0; font: 400 1.3125rem/1.45 var(--sans); }
.quote blockquote p { margin: 0 0 0.6em; }
.quote figcaption { margin-top: 1rem; font: 500 0.8125rem/1.45 var(--sans); color: var(--lilac-2); }
.quotes { gap: 0.75rem; }
.quotes .quote { display: flex; flex-direction: column; }
.quotes blockquote { flex: 1; font-size: 1.0625rem; line-height: 1.5; }
.quotes .quote::before { width: 1.85rem; height: 1.6rem; margin-bottom: 0.85rem; }
.tally + strong { white-space: nowrap; }
.tally { --tally: var(--ink); --tally-off: color-mix(in srgb, var(--ink) 18%, transparent); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.75rem; margin: 1.75rem 0; }
.columns h3 { margin-top: 0; }
.text-columns { columns: 2 18rem; column-gap: 2.5rem; max-width: none; margin: 1.5rem 0; }
.text-columns > * { break-inside: avoid; }
.table-wrap { margin: 2rem 0; }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding-bottom: 0.75rem; font: 650 1.125rem/1.3 var(--sans); }
th, td { padding: 0.75rem 0.9rem; border-bottom: 1px solid var(--rule); }
thead th { padding-block: 0.6rem; border-bottom: 0; background: var(--tint); font: 600 0.8125rem/1.4 var(--sans); }
thead th:first-child { border-radius: var(--r) 0 0 var(--r); }
thead th:last-child { border-radius: 0 var(--r) var(--r) 0; }
tbody th { font-weight: 650; }
.steps { counter-reset: step; list-style: none; max-width: 40rem; margin: 1.75rem 0; padding: 0; }
.steps li { position: relative; min-height: 1.85rem; padding: 0.1rem 0 0 2.75rem; counter-increment: step; }
.steps li + li { margin-top: 1rem; }
.steps li::before { content: counter(step); width: 1.85rem; height: 1.85rem; font-size: 0.875rem; }
details { max-width: 40rem; margin-top: 1.75rem; padding: 0.85rem 1.25rem; border-radius: var(--r); background: var(--tint); }
summary { display: flex; align-items: center; gap: 0.55rem; cursor: pointer; font-weight: 600; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; flex: none; width: 0.5rem; height: 0.5rem; margin: 0 0.3rem 0 0.15rem; border: solid currentColor; border-width: 2px 2px 0 0; transform: rotate(45deg); transition: transform 0.2s; }
details[open] summary { margin-bottom: 0.6rem; }
details[open] summary::before { transform: rotate(135deg); }
@media (max-width: 48rem) {
  h2 { font-size: 1.5rem; }
  .flow > li { min-height: 2.5rem; padding: 0.15rem 0 0 3.5rem; }
  .flow > li + li::before { top: -1.7rem; left: 0.45rem; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.15rem; }
  .figure, .columns > *, .pages a, .quote, .callout { padding-inline: 1.2rem; }
  .callout[data-tone="caution"] { padding-left: 3.2rem; }
  .callout[data-tone="caution"]::before { left: 1.15rem; }
  .quote blockquote { font-size: 1.1875rem; }
  .pages a { min-height: 0; }
}
@media (prefers-reduced-motion: reduce) { .pages a::after, summary::before { transition: none; } }
@media print {
  .page { padding: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pages a::after { display: none; }
}
`;

export const PASTEL: HouseStyle = {
  id: "pastel",
  name: "Pastel",
  summary: "Soft colour tiles under crisp near-black type: every box sits on one of five pale tints (peach, mint, sky, lilac, butter) chosen by its position, on a white page with no borders or shadows.",
  best_for: "Release plans, landing pages and evidence summaries for a broad audience: pages with many small boxes (figures, options, pages beneath, quotes) that should feel friendly and stay businesslike.",
  character: "A white page with firm near-black Onest type. Five pale tiles (peach, mint, sky, lilac, butter) carry every box, with 8px corners and nothing around them. Status pills use deep green, rust and blue-grey on matching tints. In dark, a near-black ground with a raised grey step, the five tiles as deep tints, and light type.",
  signature: [
    "Every box on its own pale tile, coloured by position: peach, mint, sky, lilac, butter, then again",
    "Figures as tiles with big bold numbers",
    "A plan as a row of tiles: done on mint with a check, current on butter with an ink outline, planned on grey with a dashed outline",
    "Quotes on lilac tiles under a large drawn quote shape",
    "Numbers in ink circles with white figures, for flows, steps and pins",
    "Status pills on matching tints, each with its own mark: a dot, a triangle, a ring",
  ],
  avoid: [
    "Borders, shadows or gradients on tiles: a tile is a flat tint with 8px corners",
    "Coloured text, headings or links: type stays near-black and colour belongs to the tiles",
    "Choosing tile colours by hand to mean something: figures, columns and pages take theirs by position",
    "Illustrations, emoji or symbols used as icons",
    "Tiles inside tables, or a tile inside a tile",
  ],
  rules: `# Pastel\n\n${rule([
    "Colour belongs to boxes, never to type. Figures, columns and page links take peach, mint, sky, lilac and butter in order of position; never reorder them to make a point.",
    "A few colours carry meaning: mint and .status data-state=\"evidence\" for what is shown or done, peach and data-state=\"caution\" for risk (aside.callout data-tone=\"caution\"), sky for open questions and plain callouts, lilac for what people said, butter for what is current.",
    "Group small comparable things so they become tiles: .figures with two to four numbers, .columns with two or three options, nav.pages for the pages beneath, .quotes with two or three voices. Prose stays on the white page.",
    "Mark a plan: ol.timeline with data-state=\"done\" on each milestone reached and aria-current=\"step\" on the one in progress; the rest read as planned.",
    "Keep the .kicker to a few plain words. Put each item of the opening's .meta in its own span to give each one a pill.",
    "Never add borders, shadows, emoji or illustrations; tables stay flat, with a grey header and rules between rows.",
  ])}\n`,
  stylesheet: CSS,
};
