import { BASE, faces, rule, schemes, svgUrl, type HouseStyle } from "./kit.ts";

/** A chevron pointing right: the arrow on each page row and the disclosure on details. */
const CHEVRON = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='2.75' stroke-linecap='square'><path d='M9 4.5l7.5 7.5L9 19.5'/></svg>`);

/** An opening quotation shape: two squared blocks with a rising tail. */
const QUOTE = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 24'><path d='M0 24V14C0 6.5 4.6 1.4 12.6 0l1.2 4.2C9.4 5.4 7.4 8 7.2 11.4H13V24ZM18.5 24V14C18.5 6.5 23.1 1.4 31.1 0l1.2 4.2C27.9 5.4 25.9 8 25.7 11.4h5.8V24Z'/></svg>`);

/** A warning triangle with its exclamation cut out, for the caution callout. */
const WARN = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M12 1.5 23.5 22H.5ZM10.7 8.5h2.6l-.4 7.2h-1.8ZM10.7 17.4h2.6V20h-2.6Z'/></svg>`);

/**
 * Report: a Story set out as a status report for people who have five minutes. Every heading states
 * the finding; statuses are Harvey balls (full, half, empty); a tracker carries the milestones and
 * navy-headed tables the detail; every number sits over a short amber bar with what it counts.
 * Navy and amber on white in light; in dark, a deep navy-black ground with raised steps, steel-blue
 * headings and a brighter amber. Libre Franklin throughout.
 */
const CSS = `${schemes(
  {
    "--paper": "#ffffff", "--raise": "#ffffff", "--tint": "#f2f4f7", "--ink": "#1a1f2b", "--head": "#12305a", "--muted": "#5a6273", "--rule": "#d6dae1",
    "--key": "#12305a", "--on-key": "#ffffff", "--panel": "#12305a", "--on-panel": "#ffffff", "--panel-muted": "#c8d4e6", "--panel-rule": "rgba(255, 255, 255, 0.24)",
    "--amber": "#e3a008", "--on-amber": "#12305a", "--amber-soft": "#fdf3d7", "--amber-ring": "rgba(227, 160, 8, 0.32)",
    "--chip": "#e6ecf4", "--on-chip": "#12305a", "--link": "#12305a", "--mark": "#fde5a3",
    "--accent": "#12305a", "--on-accent": "#ffffff", "--focus": "#12305a", "--select": "#fcd46a", "--on-select": "#12305a",
    "--ok": "#12305a", "--caution": "#e3a008", "--open": "#5a6273",
    "--warn-bg": "#e3a008", "--warn-fg": "#12305a", "--warn-icon": "#12305a",
  },
  {
    "--paper": "#0f1724", "--raise": "#162133", "--tint": "#1b283d", "--ink": "#e6eaf1", "--head": "#b3cbec", "--muted": "#a3adbd", "--rule": "#2d3a51",
    "--key": "#9dbce6", "--on-key": "#0f1724", "--panel": "#1a3054", "--on-panel": "#f3f6fb", "--panel-muted": "#bccbe0", "--panel-rule": "rgba(243, 246, 251, 0.2)",
    "--amber": "#f2b632", "--on-amber": "#0f1724", "--amber-soft": "#2b2618", "--amber-ring": "rgba(242, 182, 50, 0.38)",
    "--chip": "#22355a", "--on-chip": "#d0def2", "--link": "#b3cbec", "--mark": "rgba(242, 182, 50, 0.3)",
    "--accent": "#9dbce6", "--on-accent": "#0f1724", "--focus": "#f2b632", "--select": "#f2b632", "--on-select": "#0f1724",
    "--ok": "#9dbce6", "--caution": "#f2b632", "--open": "#a3adbd",
    "--warn-bg": "#3a2d0c", "--warn-fg": "#f7e6bd", "--warn-icon": "#f2b632",
  },
)}${faces({ sans: '"Libre Franklin", "Franklin Gothic", "Helvetica Neue", Arial, system-ui, sans-serif' })}${BASE}
:root { --chevron: ${CHEVRON}; --quote: ${QUOTE}; --warn: ${WARN}; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); font-variant-numeric: lining-nums; -webkit-font-smoothing: antialiased; }
.page { max-width: 58rem; margin: 0 auto; padding: clamp(0.75rem, 3vw, 2.5rem) clamp(1rem, 4vw, 2.5rem) 5rem; }
.opening { display: grid; gap: 1.1rem; margin-bottom: 3.5rem; padding: clamp(2rem, 5.5vw, 3.75rem) clamp(1.5rem, 5vw, 3.5rem) clamp(1.75rem, 4vw, 2.5rem); background: var(--panel); color: var(--on-panel); border-bottom: 5px solid var(--amber); }
.opening > * { margin: 0; }
.opening a { color: inherit; text-decoration-color: var(--amber); }
.opening :focus-visible { outline-color: var(--amber); }
.opening ::selection { background: var(--amber); color: var(--on-amber); }
.kicker { font: 600 0.75rem/1.3 var(--sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--panel-muted); }
h1 { max-width: 21ch; font: 700 clamp(2.1rem, 4.8vw, 3.25rem)/1.08 var(--sans); letter-spacing: -0.022em; }
.lead { max-width: 40rem; font-size: clamp(1.1rem, 1.7vw, 1.25rem); line-height: 1.5; color: var(--panel-muted); }
.opening .meta { margin-top: 0.6rem; padding-top: 1rem; border-top: 1px solid var(--panel-rule); font: 500 0.875rem/1.5 var(--sans); color: var(--panel-muted); }
section { margin-top: 3.5rem; padding-top: 1.4rem; border-top: 1px solid var(--rule); }
.opening + section { border-top: 0; padding-top: 0; }
section > h2 { max-width: 40rem; margin: 0 0 1rem; font: 700 clamp(1.3rem, 2.4vw, 1.5rem)/1.25 var(--sans); letter-spacing: -0.012em; color: var(--head); }
h2[data-label]::before { content: attr(data-label); display: block; margin-bottom: 0.55rem; font: 600 0.75rem/1.3 var(--sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
h3 { margin: 1.75rem 0 0.4rem; font: 700 1.15rem/1.3 var(--sans); color: var(--ink); }
p, ul, ol { max-width: 39rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.25rem; }
li::marker { color: var(--head); }
strong { font-weight: 700; }
a { color: var(--link); text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); text-decoration-thickness: 1.5px; text-underline-offset: 0.2em; transition: text-decoration-color 0.15s; }
a:hover { text-decoration-color: var(--amber); text-decoration-thickness: 2px; }
mark { background: var(--mark); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 1.75rem 2.5rem; margin: 1.75rem 0 1.5rem; }
.figure { max-width: none; margin: 0; font-size: 0.9375rem; line-height: 1.45; color: var(--muted); }
.figure strong { display: block; font: 700 2.75rem/1.05 var(--sans); letter-spacing: -0.02em; color: var(--head); font-variant-numeric: lining-nums tabular-nums; }
.figure strong::after { content: ""; display: block; width: 2.25rem; height: 4px; margin: 0.75rem 0 0.65rem; background: var(--amber); }
.note { max-width: 39rem; margin: 1.5rem 0; padding-top: 0.75rem; border-top: 1px solid var(--rule); font-size: 0.875rem; line-height: 1.55; color: var(--muted); }
.callout { position: relative; max-width: 42rem; margin: 2rem 0; padding: 1.15rem 1.4rem 1.2rem; background: var(--amber-soft); border-top: 3px solid var(--amber); color: var(--ink); }
.callout > * { max-width: none; }
.callout > :last-child { margin-bottom: 0; }
.callout a { color: inherit; }
.callout strong { color: var(--head); }
.callout[data-tone="caution"] { padding-left: 3.6rem; background: var(--warn-bg); border-top: 0; color: var(--warn-fg); }
.callout[data-tone="caution"] strong { color: inherit; }
.callout[data-tone="caution"]::before { content: ""; position: absolute; left: 1.3rem; top: 1.2rem; width: 1.5rem; height: 1.5rem; background: var(--warn-icon); -webkit-mask: var(--warn) center / contain no-repeat; mask: var(--warn) center / contain no-repeat; }
.callout[data-tone="caution"] ::selection { background: var(--warn-fg); color: var(--warn-bg); }
.status { display: inline-flex; align-items: center; gap: 0.45em; font: 600 0.875rem/1.3 var(--sans); color: var(--ink); vertical-align: -0.1em; }
.status::before { content: ""; flex: none; width: 0.95em; height: 0.95em; border-radius: 50%; background: var(--ok); box-shadow: inset 0 0 0 1.5px var(--key); }
.status[data-state="caution"]::before { background: conic-gradient(var(--caution) 0 50%, transparent 0); }
.status[data-state="open"]::before { background: transparent; }
.tag { display: inline-block; padding: 0.24em 0.55em 0.2em; border-radius: 2px; background: var(--chip); color: var(--on-chip); font: 600 0.6875rem/1.35 var(--sans); letter-spacing: 0.07em; text-transform: uppercase; }
.timeline { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 2rem 0 2.25rem; }
.timeline > li { position: relative; padding: 2.35rem 1.25rem 0 0; }
.timeline > li::before { content: ""; position: absolute; left: 0; top: 0; z-index: 1; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--paper); box-shadow: inset 0 0 0 2px var(--key); }
.timeline > li::after { content: ""; position: absolute; top: calc(0.75rem - 1px); left: 1.95rem; right: 0.45rem; height: 2px; background: var(--rule); }
.timeline > li:last-child::after { display: none; }
.timeline > li[data-state="done"]::before, .timeline > li[data-state="done"]::after { background: var(--key); }
.timeline > li[aria-current]::before { background: conic-gradient(var(--amber) 0 50%, var(--paper) 0); box-shadow: inset 0 0 0 2px var(--key), 0 0 0 4px var(--amber-ring); }
.timeline time { margin-bottom: 0.3rem; font: 600 0.75rem/1.4 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.timeline > li[aria-current] time { color: var(--ink); }
.timeline strong { margin-bottom: 0.3rem; font: 700 1.0625rem/1.3 var(--sans); color: var(--head); }
.timeline p { font-size: 0.9375rem; line-height: 1.45; color: var(--muted); }
.lines { grid-template-columns: minmax(8rem, 13rem) minmax(0, 1fr) auto; margin: 1.75rem 0 2rem; border-top: 2px solid var(--head); }
.lines > li { padding: 0.8rem 0; border-bottom: 1px solid var(--rule); line-height: 1.45; }
.lines strong { color: var(--head); }
.facts { margin: 1.5rem 0 2rem; border-top: 2px solid var(--head); }
.facts dt, .facts dd { padding: 0.75rem 0; border-bottom: 1px solid var(--rule); }
.facts dt { font: 600 0.75rem/1.7rem var(--sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.facts dd { line-height: 1.7rem; }
.pages { margin: 1.5rem 0 1rem; }
.pages ul { display: block; border-top: 2px solid var(--head); }
.pages li { border-bottom: 1px solid var(--rule); }
.pages a { display: grid; grid-template-columns: minmax(0, 1fr) auto 1.1rem; align-items: center; column-gap: 1.25rem; row-gap: 0.15rem; padding: 0.95rem 0.6rem; transition: background-color 0.15s; }
.pages a strong { grid-column: 1; font: 700 1.0625rem/1.35 var(--sans); color: var(--head); }
.pages a span:not(.tag):not(.status) { grid-column: 1; font-size: 0.9375rem; line-height: 1.45; color: var(--muted); }
.pages a .tag, .pages a .status { grid-column: 2; grid-row: 1 / span 2; }
.pages a::after { content: ""; grid-column: 3; grid-row: 1 / span 2; width: 1.1rem; height: 1.1rem; background: var(--head); -webkit-mask: var(--chevron) center / contain no-repeat; mask: var(--chevron) center / contain no-repeat; transition: transform 0.15s; }
.pages a:hover { background: var(--tint); }
.pages a:hover::after { transform: translateX(3px); }
.pages a:focus-visible { outline-offset: -2px; }
.flow { gap: 2.75rem; margin: 2rem 0 2.5rem; }
.flow > li { padding-top: 3.1rem; font-size: 0.9375rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: var(--key); color: var(--on-key); font: 700 1rem/1 var(--sans); font-variant-numeric: tabular-nums lining-nums; }
.flow > li + li::before { top: 0.55rem; left: -2.35rem; width: 1.9rem; height: 1.15rem; background: var(--muted); }
.flow strong { margin-bottom: 0.25rem; font: 700 1.0625rem/1.3 var(--sans); color: var(--head); }
.flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.flow .tag { margin-top: 0.6rem; }
.diagram svg { color: var(--head); }
.diagram .node { fill: var(--raise); stroke: var(--head); stroke-width: 1.5; }
.diagram rect.node { rx: 2px; }
.diagram path.node { fill: var(--amber-soft); }
.diagram .node.key { fill: var(--key); stroke: var(--key); }
.diagram .label { fill: var(--ink); font: 600 14px var(--sans); }
.diagram .label.on-key { fill: var(--on-key); }
.diagram .label.small { fill: var(--muted); font: 500 12px var(--sans); }
.diagram .edge { stroke: var(--muted); stroke-width: 1.5; }
.diagram .head { fill: var(--muted); }
.diagram figcaption, .shot figcaption > p:first-child { max-width: 39rem; font-size: 0.875rem; line-height: 1.5; color: var(--muted); }
.shot .screen { border: 1px solid var(--rule); background: var(--paper); }
.pin, .pins > li::before { background: var(--amber); color: var(--on-amber); font: 700 0.8125rem/1 var(--sans); }
.pin { box-shadow: 0 0 0 2px #ffffff; }
.pins { margin: 1.25rem 0 0; }
.pins > li { font-size: 0.9375rem; line-height: 1.5; }
.pins > li::before { top: -0.05rem; }
.quote { max-width: 42rem; margin: 2rem 0; }
.quote blockquote { margin: 0; font: 400 1.25rem/1.5 var(--sans); color: var(--ink); }
.quote blockquote::before { content: ""; display: block; width: 1.85rem; height: 1.4rem; margin-bottom: 0.85rem; background: var(--head); -webkit-mask: var(--quote) left center / contain no-repeat; mask: var(--quote) left center / contain no-repeat; }
.quote blockquote p { max-width: none; margin: 0; }
.quote figcaption { margin-top: 0.8rem; font: 500 0.8125rem/1.5 var(--sans); color: var(--muted); }
.quotes { gap: 2.25rem; }
.quotes .quote { padding-top: 1.25rem; border-top: 1px solid var(--rule); }
.quotes blockquote { font-size: 1.125rem; }
.tally { margin-right: 0.3em; --tally: var(--key); --tally-off: color-mix(in srgb, var(--key) 22%, transparent); }
.tally + strong { white-space: nowrap; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.25rem; margin: 1.75rem 0; }
.columns > * { padding: 1.2rem 1.4rem 1.35rem; background: var(--tint); border-top: 4px solid var(--key); }
.columns h3 { margin-top: 0; color: var(--head); }
.columns > * > :last-child { margin-bottom: 0; }
.text-columns { max-width: none; margin: 1.5rem 0; columns: 2 17rem; column-gap: 2.5rem; column-rule: 1px solid var(--rule); }
.text-columns > * { max-width: none; }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding-bottom: 0.6rem; font: 700 1rem/1.35 var(--sans); color: var(--ink); }
th, td { padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--rule); }
thead th { padding-block: 0.65rem; background: var(--panel); color: var(--on-panel); border-bottom: 0; font: 600 0.75rem/1.35 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; }
tbody th { font-weight: 700; color: var(--head); }
.steps { max-width: 42rem; margin: 1.75rem 0; padding: 0; list-style: none; counter-reset: step; }
.steps > li { position: relative; padding: 0.85rem 0 0.85rem 2.75rem; border-bottom: 1px solid var(--rule); counter-increment: step; }
.steps > li:first-child { border-top: 1px solid var(--rule); }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 0.85rem; display: grid; place-items: center; width: 1.7rem; height: 1.7rem; border-radius: 50%; background: var(--key); color: var(--on-key); font: 700 0.8125rem/1 var(--sans); font-variant-numeric: tabular-nums lining-nums; }
details { max-width: 42rem; margin-top: 1.75rem; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
summary { display: flex; align-items: center; gap: 0.55rem; padding: 0.8rem 0; cursor: pointer; list-style: none; font: 600 1rem/1.4 var(--sans); color: var(--head); }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; flex: none; width: 0.85rem; height: 0.85rem; background: currentColor; -webkit-mask: var(--chevron) center / contain no-repeat; mask: var(--chevron) center / contain no-repeat; transition: transform 0.15s; }
details[open] summary::before { transform: rotate(90deg); }
details > :not(summary) { margin: 0 0 1rem; font-size: 0.9375rem; color: var(--muted); }
@media (max-width: 48rem) {
  .opening { margin-bottom: 2.5rem; }
  section { margin-top: 2.75rem; }
  .timeline { grid-auto-flow: row; grid-template-columns: minmax(0, 1fr); }
  .timeline > li { padding: 0 0 1.4rem 2.6rem; }
  .timeline > li::after { top: 1.95rem; bottom: 0.45rem; left: calc(0.75rem - 1px); right: auto; width: 2px; height: auto; }
  .timeline time { padding-top: 0.15rem; }
  .pages a { grid-template-columns: minmax(0, 1fr) 1.1rem; padding-inline: 0.25rem; }
  .pages a .tag, .pages a .status { grid-column: 1; grid-row: 3; justify-self: start; margin-top: 0.45rem; }
  .pages a::after { grid-column: 2; grid-row: 1 / span 3; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.1rem; }
  .figure strong { font-size: 2.4rem; }
  .lines { grid-template-columns: minmax(0, 1fr) auto; }
  .flow { gap: 1.6rem; }
  .flow > li { min-height: 2.25rem; padding: 0.2rem 0 0 3.25rem; }
  .flow > li + li::before { top: -1.38rem; left: 0.55rem; width: 1.15rem; height: 1.15rem; }
  table { min-width: 34rem; }
}
@media (prefers-reduced-motion: reduce) { a, .pages a, .pages a::after, summary::before { transition: none; } }
@media print {
  .opening, thead th, .status::before, .timeline > li::before, .timeline > li::after, .figure strong::after, .columns > *, .callout, .flow > li::after, .steps > li::before { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pages a::after { display: none; }
}
`;

export const REPORT: HouseStyle = {
  id: "report",
  name: "Report",
  summary: "A navy and amber status report on white: every heading states the finding, statuses are Harvey balls, milestones sit on a tracker, and big navy figures and navy-headed tables carry the detail.",
  best_for: "Briefing executives and boards: a release plan and how far along it is, decisions and the evidence behind them, risks to act on, when the reader wants the finding first and the detail one glance away.",
  character: "Serious, organised and quick to read. White ground, near-black text, navy for headings, figures, table heads and key shapes, amber only as fills: bars, the current milestone, caution, highlights and pins. In dark, a deep navy-black ground with raised steps, steel-blue headings and shapes, and a brighter amber. Libre Franklin throughout, bold for headings and figures.",
  signature: [
    "Statuses as Harvey balls: a full navy ball for evidence, a half amber ball for caution, an empty ring for open, always with the word beside it",
    "A milestone tracker: one ball per milestone joined by a thin line, full when done, half with an amber halo for the current one, empty for planned",
    "Headings that state the finding as a sentence in bold navy, with a quiet uppercase label above when it carries a date or stage",
    "The opening as a solid navy block with white type and an amber bottom edge",
    "Large navy figures, each over a short amber bar with what it counts beneath",
    "Tables with a navy header row and a bold first column; pages beneath as ruled rows ending in a chevron",
  ],
  avoid: [
    "Amber text on a light ground: amber is a fill, a bar or a highlight, never type",
    "Headings that name a topic (Timeline, Research) instead of stating what was found",
    "A number on its own: every figure says what it counts",
    "A Harvey ball without a word naming the state",
    "Colours beyond navy, amber and the greys",
  ],
  rules: `# Report\n\nA Story set out as a status report: the finding first, the detail beneath it.\n\n${rule([
    "Write every h2 as the finding in one sentence (\"Crew leads call the hand-off the painful part\"), never a topic. Put a date, release or stage in data-label, not in the heading.",
    "Mark state with span.status: data-state=\"evidence\" draws a full ball, \"caution\" a half amber ball, \"open\" an empty ring. The text beside it always names the state in words.",
    "A plan is an ol.timeline of two to four milestones: data-state=\"done\" on those reached and aria-current=\"step\" on the one in progress; the rest read as planned. Follow it with ul.lines or a table for the detail.",
    "Put numbers in .figures, three or four in a row, each with what it counts written beneath; never a number without its denominator or unit.",
    "Navy carries structure (headings, figures, table heads, key shapes); amber is only ever a fill: figure bars, the current milestone, caution, mark and pins. Never set text in amber.",
    "Use .callout for the one thing the reader should act on, and data-tone=\"caution\" for an assumption or risk that could change the plan; one or two a page, each starting with a bold label.",
  ])}\n`,
  stylesheet: CSS,
};
