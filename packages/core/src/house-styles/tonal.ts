import { BASE, faces, rule, schemes, svgUrl, type HouseStyle } from "./kit.ts";

/** Marks drawn as masks, so each takes the colour of the surface it sits on. */
const CHECK = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='M5 12.5l4.5 4.5L19 7.5'/></svg>`);
const WARN = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M10.27 3.5a2 2 0 0 1 3.46 0l8.4 14.5A2 2 0 0 1 20.4 21H3.6a2 2 0 0 1-1.73-3zM11 8.5h2v6h-2zM11 16.2h2v2.2h-2z'/></svg>`);
const INFO = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20zM11 10.5h2V17h-2zM11 6.8h2V9h-2z'/></svg>`);
const QUOTE = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 24'><path d='M0 24V14.5C0 6.6 4.2 1.7 12.6 0L14 3.6C9.6 5 7.5 7.6 7.2 11H14v13zM19 24V14.5C19 6.6 23.2 1.7 31.6 0L33 3.6C28.6 5 26.5 7.6 26.2 11H33v13z'/></svg>`);
const CHEVRON = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='M9 5l7 7-7 7'/></svg>`);

/**
 * Tonal: one seed hue, sea green, generates every surface. The ground is faintly tinted, containers
 * step deeper in the same hue, corners are large and soft, and statuses are pills. No borders, no
 * shadows: a surface is told apart by its tone. Figtree throughout.
 */
const CSS = `${schemes(
  {
    "--paper": "#f3faf7", "--ink": "#102620", "--muted": "#3f5650", "--rule": "#c4d9d1", "--tint": "#e3f2ec",
    "--c-low": "#e3f2ec", "--c-mid": "#cfe9de", "--c-high": "#b5ddd0", "--chip": "#b5ddd0", "--node": "#bfe3d6", "--neutral": "#d5dcd9", "--step": "#cfe9de",
    "--accent": "#006b56", "--on-accent": "#ffffff", "--pc": "#a3f2d8", "--on-pc": "#002118", "--pc-deep": "#8fe3c7",
    "--warn": "#8f4a00", "--warn-c": "#ffdcc6", "--on-warn-c": "#321200",
    "--ok": "#006b56", "--caution": "#8f4a00", "--open": "#3f5650",
    "--focus": "#006b56", "--select": "#006b56", "--on-select": "#ffffff", "--mark": "#a3f2d8",
    "--tally-off": "#c4dfd5", "--pin-ring": "#ffffff",
  },
  {
    "--paper": "#0e1513", "--ink": "#dce6e1", "--muted": "#a7bab3", "--rule": "#2e3e38", "--tint": "#17211e",
    "--c-low": "#17211e", "--c-mid": "#1e2b27", "--c-high": "#273631", "--chip": "#2f423c", "--node": "#2c3e38", "--neutral": "#2e3532", "--step": "#273631",
    "--accent": "#7fd8bb", "--on-accent": "#00382c", "--pc": "#005140", "--on-pc": "#a3f2d8", "--pc-deep": "#00443a",
    "--warn": "#ffb68c", "--warn-c": "#5c2f0e", "--on-warn-c": "#ffdcc6",
    "--ok": "#7fd8bb", "--caution": "#ffb68c", "--open": "#a7bab3",
    "--focus": "#7fd8bb", "--select": "#7fd8bb", "--on-select": "#00382c", "--mark": "#005140",
    "--tally-off": "#2f423c", "--pin-ring": "#0e1513",
  },
)}${faces({ sans: '"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif' })}${BASE}
:root { --r-l: 1.75rem; --r-m: 1rem; --r-s: 0.375rem; --col: 48rem; --i-check: ${CHECK}; --i-warn: ${WARN}; --i-info: ${INFO}; --i-quote: ${QUOTE}; --i-chevron: ${CHEVRON}; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
.page { max-width: 68rem; margin: 0 auto; padding: clamp(0.75rem, 2.5vw, 1.75rem) clamp(1rem, 4vw, 2.5rem) 6rem; }
.opening { display: grid; justify-items: start; gap: 1.25rem; margin: 0 0 4.5rem; padding: clamp(2rem, 6vw, 4.5rem) clamp(1.5rem, 5.5vw, 4rem) clamp(1.75rem, 5vw, 3.25rem); border-radius: clamp(1.5rem, 3vw, 2.25rem); background: var(--pc); color: var(--on-pc); }
.opening > * { margin: 0; }
.opening a { color: inherit; text-decoration-color: currentColor; }
.kicker { font: 600 0.875rem/1.3 var(--sans); color: color-mix(in srgb, currentColor 78%, transparent); }
h1 { max-width: 18ch; font: 600 clamp(2.5rem, 6vw, 3.75rem)/1.08 var(--sans); letter-spacing: -0.025em; }
.lead { max-width: 38rem; font-size: clamp(1.125rem, 1.8vw, 1.3125rem); line-height: 1.5; color: color-mix(in srgb, var(--on-pc) 86%, var(--pc)); }
.opening .meta { display: inline-flex; max-width: none; align-items: baseline; gap: 0.55rem; margin-top: 0.5rem; padding: 0.45rem 1rem 0.45rem 0.8rem; border-radius: 1.15rem; background: var(--pc-deep); font: 600 0.8125rem/1.4 var(--sans); }
.opening .meta::before { content: ""; flex: none; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: currentColor; }
section { max-width: var(--col); margin: 4.5rem auto 0; }
section.wide { max-width: none; }
section.wide > h2, section.wide > h3, section.wide > p, section.wide > ul:not([class]) { margin-left: max(0px, 50% - var(--col) / 2); }
h2 { margin: 0 0 1rem; font: 600 1.75rem/1.2 var(--sans); letter-spacing: -0.012em; }
h2[data-label]::before { content: attr(data-label); display: block; width: fit-content; margin-bottom: 0.85rem; padding: 0.3rem 0.8rem; border-radius: 999px; background: var(--c-mid); color: var(--muted); font: 600 0.8125rem/1.3 var(--sans); letter-spacing: 0; }
h3 { margin: 2rem 0 0.5rem; font: 600 1.25rem/1.3 var(--sans); }
p, ul, ol { max-width: 40rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.3rem; }
li::marker { color: var(--accent); }
strong { font-weight: 600; }
a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 0.2em; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); transition: text-decoration-color 0.15s; }
a:hover { text-decoration-color: currentColor; }
mark { padding: 0.04em 0.22em; border-radius: 0.3em; color: var(--on-pc); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.75rem; margin: 1.75rem 0 1.25rem; }
.figure { margin: 0; padding: 1.4rem 1.5rem 1.5rem; border-radius: var(--r-l); background: var(--c-low); color: var(--muted); font-size: 0.9375rem; line-height: 1.45; }
.figure strong { display: block; margin-bottom: 0.6rem; font: 600 clamp(2.125rem, 3.8vw, 2.5rem)/1.05 var(--sans); letter-spacing: -0.02em; color: var(--accent); font-variant-numeric: tabular-nums lining-nums; }
.note { position: relative; max-width: 40rem; margin: 1.25rem 0; padding-left: 1.85rem; color: var(--muted); font-size: 0.9375rem; line-height: 1.5; }
.note::before { content: ""; position: absolute; left: 0; top: 0.12rem; width: 1.15rem; height: 1.15rem; background: var(--accent); -webkit-mask: var(--i-info) center / contain no-repeat; mask: var(--i-info) center / contain no-repeat; }
.callout { position: relative; max-width: 44rem; margin: 2rem 0; padding: 1.3rem 1.6rem; border-radius: var(--r-l); background: var(--c-mid); }
.callout[data-tone="caution"] { padding-left: 4rem; background: var(--warn-c); color: var(--on-warn-c); }
.callout[data-tone="caution"]::before { content: ""; position: absolute; left: 1.45rem; top: 1.4rem; width: 1.5rem; height: 1.5rem; background: var(--caution); -webkit-mask: var(--i-warn) center / contain no-repeat; mask: var(--i-warn) center / contain no-repeat; }
.callout a { color: inherit; }
.callout > :last-child, .columns > * > :last-child, details > :last-child { margin-bottom: 0; }
.status { display: inline-flex; align-items: center; gap: 0.35em; padding: 0.24em 0.75em 0.24em 0.5em; border-radius: 999px; background: var(--pc); color: var(--on-pc); font: 600 0.8125rem/1.3 var(--sans); vertical-align: 0.08em; }
.status::before { content: ""; flex: none; width: 1.05em; height: 1.05em; background: var(--ok); -webkit-mask: var(--i-check) center / contain no-repeat; mask: var(--i-check) center / contain no-repeat; }
.status[data-state="caution"] { background: var(--warn-c); color: var(--on-warn-c); }
.status[data-state="caution"]::before { background: var(--caution); -webkit-mask-image: var(--i-warn); mask-image: var(--i-warn); }
.status[data-state="open"] { background: var(--neutral); color: var(--ink); }
.status[data-state="open"]::before { width: 0.8em; height: 0.8em; margin: 0 0.125em; border: 2px solid var(--open); border-radius: 50%; background: none; -webkit-mask: none; mask: none; }
.tag { display: inline-block; padding: 0.24em 0.75em; border-radius: 999px; background: var(--chip); color: var(--ink); font: 600 0.75rem/1.3 var(--sans); }
.timeline { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); column-gap: 3px; margin: 2rem 0 2.25rem; }
.timeline > li { position: relative; padding-right: 1.25rem; }
.timeline > li::before { content: ""; display: block; height: 1.75rem; margin-bottom: 1rem; border-radius: var(--r-s); background: var(--step); }
.timeline > li:first-child::before { border-radius: 999px var(--r-s) var(--r-s) 999px; }
.timeline > li:last-child::before { border-radius: var(--r-s) 999px 999px var(--r-s); }
.timeline > li[data-state="done"]::before { background: var(--accent); }
.timeline > li[aria-current]::before { background: var(--pc); box-shadow: inset 0 0 0 2px var(--accent); }
.timeline > li[data-state="done"]::after, .timeline > li[aria-current]::after { content: ""; position: absolute; left: 0.6rem; top: 0.35rem; width: 1.05rem; height: 1.05rem; background: var(--on-accent); -webkit-mask: var(--i-check) center / contain no-repeat; mask: var(--i-check) center / contain no-repeat; }
.timeline > li[aria-current]::after { left: 0.7rem; top: 0.5rem; width: 0.75rem; height: 0.75rem; border-radius: 50%; background: var(--accent); -webkit-mask: none; mask: none; }
.timeline time { margin-bottom: 0.3rem; font: 600 0.8125rem/1.3 var(--sans); color: var(--muted); font-variant-numeric: lining-nums; }
.timeline > li[aria-current] time { color: var(--accent); }
.timeline strong { margin-bottom: 0.3rem; font: 600 1.125rem/1.3 var(--sans); }
.timeline p { font-size: 0.9375rem; line-height: 1.45; color: var(--muted); }
.lines, .facts { margin: 1.5rem 0 2rem; padding: 0.3rem 1.5rem; border-radius: var(--r-l); background: var(--c-low); font-size: 0.9375rem; line-height: 1.45; }
.lines > li { padding: 0.95rem 0; }
.lines > li + li { border-top: 1px solid var(--rule); }
.lines strong { font: 600 1rem/1.4 var(--sans); }
.lines > li > span:not(.tag):not(.status) { color: var(--muted); }
.facts { font-size: 1rem; line-height: 1.5rem; }
.facts dt, .facts dd { padding: 0.95rem 0; }
.facts dd + dt, .facts dd + dt + dd { border-top: 1px solid var(--rule); }
.facts dt { font: 600 0.8125rem/1.5rem var(--sans); color: var(--muted); }
.pages { margin: 1.5rem 0 1rem; }
.pages ul, .steps { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; }
.pages a { position: relative; padding: 1.1rem 5rem 1.2rem 1.5rem; border-radius: var(--r-s); background: var(--c-low); transition: background-color 0.15s; }
.pages li:first-child a, .steps > li:first-child { border-top-left-radius: 1.5rem; border-top-right-radius: 1.5rem; }
.pages li:last-child a, .steps > li:last-child { border-bottom-left-radius: 1.5rem; border-bottom-right-radius: 1.5rem; }
.pages a::before { content: ""; position: absolute; right: 1.25rem; top: 50%; width: 2.5rem; height: 2.5rem; margin-top: -1.25rem; border-radius: 50%; background: var(--pc); transition: background-color 0.15s; }
.pages a::after { content: ""; position: absolute; right: 1.9rem; top: 50%; width: 1.2rem; height: 1.2rem; margin-top: -0.6rem; background: var(--on-pc); -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; transition: transform 0.15s, background-color 0.15s; }
.pages a:hover { background: var(--c-mid); }
.pages a:hover::before { background: var(--accent); }
.pages a:hover::after { background: var(--on-accent); transform: translateX(2px); }
.pages a strong { font: 600 1.125rem/1.3 var(--sans); }
.pages a span:not(.tag):not(.status) { margin-top: 0.25rem; color: var(--muted); font-size: 0.9375rem; line-height: 1.45; }
.pages a .tag, .pages a .status { margin-top: 0.7rem; }
.steps { max-width: none; margin: 1.75rem 0; padding: 0; list-style: none; counter-reset: step; }
.steps > li { position: relative; padding: 1rem 1.5rem 1.05rem 4rem; border-radius: var(--r-s); background: var(--c-low); counter-increment: step; }
.steps > li::before { content: counter(step); position: absolute; left: 1.25rem; top: 0.95rem; display: grid; place-items: center; width: 1.85rem; height: 1.85rem; border-radius: 50%; background: var(--pc); color: var(--on-pc); font: 700 0.875rem/1 var(--sans); font-variant-numeric: tabular-nums; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.75rem; margin: 1.75rem 0; }
.columns > * { padding: 1.4rem 1.6rem 1.5rem; border-radius: var(--r-l); background: var(--c-low); }
.columns h3 { margin-top: 0; }
.text-columns { max-width: none; columns: 2 19rem; column-gap: 2.5rem; }
.text-columns > * { max-width: none; }
.table-wrap { margin: 1.75rem 0; border-radius: var(--r-l); background: var(--c-low); }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding: 1.15rem 1.4rem 0.9rem; font: 600 1.0625rem/1.3 var(--sans); }
th, td { padding: 0.8rem 1rem; }
th:first-child, td:first-child { padding-left: 1.4rem; }
th:last-child, td:last-child { padding-right: 1.4rem; }
thead th { background: var(--step); color: var(--muted); font: 600 0.8125rem/1.4 var(--sans); }
tbody tr + tr > * { border-top: 1px solid var(--rule); }
tbody th { font-weight: 600; }
details { max-width: 40rem; margin-top: 1.5rem; padding: 0 1.4rem; border-radius: var(--r-m); background: var(--c-low); }
details[open] { padding-bottom: 1.1rem; }
summary { display: flex; align-items: center; gap: 0.6rem; padding: 0.9rem 0; cursor: pointer; font: 600 1rem/1.4 var(--sans); list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; flex: none; width: 1rem; height: 1rem; background: var(--accent); -webkit-mask: var(--i-chevron) center / contain no-repeat; mask: var(--i-chevron) center / contain no-repeat; transition: transform 0.15s; }
details[open] summary::before { transform: rotate(90deg); }
.quote { display: flex; flex-direction: column; gap: 1rem; margin: 2rem 0; padding: 1.5rem 1.6rem 1.35rem; border-radius: var(--r-l); background: var(--c-low); }
.quote blockquote { margin: 0; font: 400 1.3125rem/1.5 var(--sans); }
.quote blockquote::before { content: ""; display: block; width: 2.4rem; height: 1.7rem; margin-bottom: 1rem; background: var(--accent); -webkit-mask: var(--i-quote) left center / contain no-repeat; mask: var(--i-quote) left center / contain no-repeat; }
.quote blockquote p { max-width: none; margin: 0; }
.quote figcaption { font: 600 0.8125rem/1.5 var(--sans); color: var(--muted); }
.quotes { gap: 0.75rem; margin: 1.75rem 0; }
.quotes .quote { justify-content: space-between; }
.quotes blockquote { font-size: 1.0625rem; }
.flow { gap: 2.5rem; margin: 2rem 0 2.5rem; }
.flow > li { padding-top: 3.75rem; font-size: 0.9375rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: 50%; background: var(--pc); color: var(--on-pc); font: 700 1.0625rem/1 var(--sans); font-variant-numeric: tabular-nums; }
.flow > li + li::before { top: 0.875rem; background: var(--muted); }
.flow strong { margin-bottom: 0.25rem; font: 600 1.0625rem/1.3 var(--sans); }
.flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.flow .tag { margin-top: 0.65rem; }
.diagram, .shot[data-device="phone"] { padding: clamp(1.25rem, 3.5vw, 2rem); border-radius: var(--r-l); background: var(--c-low); }
.diagram svg { color: var(--ink); }
.diagram .node { fill: var(--node); stroke: var(--node); stroke-width: 2; stroke-linejoin: round; }
.diagram rect.node { rx: 14px; }
.diagram path.node { stroke-width: 10; }
.diagram .node.key { fill: var(--accent); stroke: var(--accent); }
.diagram .edge { stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.diagram .head { fill: var(--muted); }
.diagram .label { fill: var(--ink); font: 600 14.5px var(--sans); }
.diagram .label.small { fill: var(--muted); font: 500 13px var(--sans); }
.diagram .label.on-key { fill: var(--on-accent); }
.diagram figcaption, .shot figcaption > p:first-child { color: var(--muted); font-size: 0.9375rem; line-height: 1.5; }
.diagram figcaption { margin-top: 1.25rem; }
.shot .screen { border-radius: 1.5rem; box-shadow: 0 0 0 0.4rem var(--c-high); }
.shot .screen > svg, .shot .screen > img { border-radius: 1.5rem; }
.shot[data-device="phone"] { gap: 1.5rem 2.5rem; }
.pin, .pins > li::before { width: 1.9rem; height: 1.9rem; background: var(--accent); color: var(--on-accent); font: 700 0.875rem/1 var(--sans); }
.pin { margin: -0.95rem 0 0 -0.95rem; box-shadow: 0 0 0 3px var(--pin-ring); }
.pins { margin: 1.25rem 0 0; }
.pins > li { padding-left: 2.8rem; font-size: 0.9375rem; line-height: 1.5; }
.pins > li::before { top: -0.05rem; }
.tally { --dot: 0.85em; --tally: var(--accent); vertical-align: -0.02em; }
@media (max-width: 48rem) {
  .opening { margin-bottom: 3.5rem; }
  section { margin-top: 3.5rem; }
  .timeline { grid-auto-flow: row; grid-template-columns: minmax(0, 1fr); row-gap: 3px; }
  .timeline > li { padding: 0.15rem 0 1.25rem 2.75rem; }
  .timeline > li::before { position: absolute; left: 0; top: 0; bottom: 0; width: 1.75rem; height: auto; margin: 0; }
  .timeline > li:first-child::before { border-radius: 999px 999px var(--r-s) var(--r-s); }
  .timeline > li:last-child::before { border-radius: var(--r-s) var(--r-s) 999px 999px; }
  .timeline > li[data-state="done"]::after { left: 0.35rem; top: 0.4rem; }
  .timeline > li[aria-current]::after { left: 0.5rem; top: 0.55rem; }
  .lines, .facts { padding: 0.2rem 1.15rem; }
  .tally { --dot: 0.7em; }
  th, td { min-width: 8.5rem; }
  .facts dt { padding-bottom: 0; }
  .facts dd { padding-top: 0.15rem; }
  .facts dd + dt + dd { border-top: 0; }
  .pages a { padding-left: 1.15rem; padding-right: 4.25rem; }
  .pages a::before { right: 0.9rem; }
  .pages a::after { right: 1.55rem; }
  .flow { gap: 2.25rem; }
  .flow > li { min-height: 2.75rem; padding: 0.35rem 0 0 3.75rem; }
  .flow > li + li::before { top: -1.85rem; left: 0.575rem; }
  .quote, .columns > *, .figure { padding-left: 1.25rem; padding-right: 1.25rem; }
  .callout { padding: 1.15rem 1.25rem; }
  .callout[data-tone="caution"] { padding-left: 3.4rem; }
  .callout[data-tone="caution"]::before { left: 1.1rem; top: 1.25rem; }
}
@media (prefers-reduced-motion: reduce) { a, .pages a, .pages a::before, .pages a::after, summary::before { transition: none; } }
@media print {
  .page { max-width: none; padding: 0; }
  .opening, .figure, .status, .tag, .lines, .facts, .pages a, .pages a::before, .steps > li, .columns > *, .table-wrap, thead th, .quote, .callout, .timeline > li::before, .timeline > li::after, .flow > li::after, .diagram { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export const TONAL: HouseStyle = {
  id: "tonal",
  name: "Tonal",
  summary: "Every surface is a tone of one sea green: a faintly tinted ground, containers that step deeper in the same hue, large soft corners, pill statuses, and no borders or shadows anywhere.",
  best_for: "Release plans and product updates that should read as calm, friendly, current software: plans with progress, lists of pages and states that a reader scans.",
  character: "Calm and modern. A pale green-tinted ground with three deeper green container tones, a deep sea-green primary, a mint primary container and one warm orange role for caution; in dark, the same hue on near-black green with lifted mint accents. Figtree, a friendly geometric sans, in regular and semibold.",
  signature: [
    "The opening as a large mint container with soft corners and the meta line as a chip",
    "Figures as three tonal containers with the number large in sea green",
    "A plan as a connected row of pill segments: done filled with a check, current mint with a dot and an inner ring, planned plain",
    "Pages beneath as one grouped list, rows split by thin gaps, each ending in a round arrow chip",
    "Statuses as pills with a drawn mark: a check on mint for evidence, a triangle on warm orange for caution, a ring on grey for open",
  ],
  avoid: [
    "Borders, outlines or shadows on containers: a surface differs from its neighbour only by tone",
    "A second hue for decoration: green is the system, warm orange means caution and nothing else",
    "White cards on a grey ground",
    "Small corners on large containers, or square chips",
    "Uppercase or letter-spaced labels: labels are sentence case",
  ],
  rules: `# Tonal\n\n${rule([
    "Colour has jobs: sea green (primary) is progress, links and the one node or number that matters; the mint container is the opening, evidence and highlights; warm orange is caution only. Containers in plain green tones carry everything else.",
    "Mark a plan in ol.timeline with data-state=\"done\" for what is reached and aria-current=\"step\" for what the team works towards; the rest reads as planned. Two to four segments.",
    "Use span.status for every state, with words that name it: evidence for what is decided or supported, caution for thin or risky ground, open for what is untested. Use span.tag for groups such as a release.",
    "Put the pages beneath a page in nav.pages as one grouped list; give each row a title and one line on what it holds.",
    "Keep the vocabulary's surfaces: never add a border, outline or shadow to a container, and never set a label in capitals.",
  ])}\n`,
  stylesheet: CSS,
};
