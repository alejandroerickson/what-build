import { BASE, faces, rule, schemes, svgUrl, type HouseStyle } from "./kit.ts";

/** A tick, for a milestone already reached. */
const CHECK = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 12.5l5 5L20 6.5'/></svg>`);

/** A warning triangle with its exclamation, for a caution callout. */
const WARN = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 2.6L22.6 21H1.4Z' fill='none' stroke='#000' stroke-width='2.2' stroke-linejoin='round'/><path d='M12 9.2v5.6' stroke='#000' stroke-width='2.4' stroke-linecap='round'/><circle cx='12' cy='17.9' r='1.4'/></svg>`);

/**
 * Large: a Story set big enough to read from across a room. A 22px body, headlines up to 92px,
 * numbers at 96px in a light weight, and sections far apart, so a page shows one idea at a time on
 * a large screen. Black, grey and white only; green, red and grey dots and marks carry state, and
 * nothing else is coloured. Red Hat Display for headings and numbers, Red Hat Text for reading.
 */
const CSS = `${schemes(
  {
    "--paper": "#ffffff", "--ink": "#141414", "--muted": "#5c5c5c", "--rule": "#e2e2e2", "--tint": "#f4f4f2", "--bezel": "#141414",
    "--accent": "#141414", "--on-accent": "#ffffff", "--focus": "#141414", "--select": "#dcdcd6", "--on-select": "#141414",
    "--ok": "#1f7a44", "--caution": "#b3261e", "--open": "#767672",
  },
  {
    "--paper": "#151515", "--ink": "#f1f1ee", "--muted": "#a8a8a3", "--rule": "#2e2e2c", "--tint": "#1e1e1d", "--bezel": "#3a3a37",
    "--accent": "#f1f1ee", "--on-accent": "#151515", "--focus": "#f1f1ee", "--select": "#4a4a45", "--on-select": "#f1f1ee",
    "--ok": "#6cc58e", "--caution": "#f47c6e", "--open": "#8e8e89",
  },
)}${faces({
  display: '"Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif',
  text: '"Red Hat Text", system-ui, -apple-system, "Segoe UI", sans-serif',
})}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.375rem/1.55 var(--text); font-kerning: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 4px; }
.page { container-type: inline-size; max-width: 70rem; margin: 0 auto; padding: clamp(3rem, 9vw, 8rem) clamp(1.25rem, 6vw, 5rem) clamp(5rem, 10vw, 9rem); }
.opening { margin-bottom: clamp(5rem, 11vw, 8.5rem); }
.opening > * { margin: 0; }
.kicker { margin-bottom: 1.75rem; font: 500 1.125rem/1.3 var(--text); color: var(--muted); }
h1 { max-width: 15ch; font: 500 clamp(2.875rem, 7.4vw, 5.75rem)/1 var(--display); letter-spacing: -0.03em; }
.opening .lead { max-width: 38rem; margin-top: 2.5rem; font: 400 1.75rem/1.4 var(--display); letter-spacing: -0.005em; color: var(--muted); }
.opening .meta { max-width: 44rem; margin-top: 2.5rem; font-size: 1.0625rem; line-height: 1.5; color: var(--muted); }
.opening a { color: inherit; }
section { margin-top: clamp(5rem, 11vw, 8rem); }
section > h2 { max-width: 22ch; margin: 0 0 2.25rem; font: 500 clamp(2.125rem, 4.4vw, 3.5rem)/1.07 var(--display); letter-spacing: -0.025em; }
h2[data-label]::before { content: attr(data-label); display: block; margin-bottom: 1.1rem; font: 500 1.125rem/1.3 var(--text); letter-spacing: 0; color: var(--muted); }
h3 { margin: 3rem 0 0.75rem; font: 600 1.75rem/1.2 var(--display); letter-spacing: -0.01em; }
p, ul, ol { max-width: 40rem; margin: 0 0 1.1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.3em; }
section > ul:not([class]) > li + li, section > ol:not([class]) > li + li { margin-top: 0.4em; }
strong, b { font-weight: 600; }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 0.09em; text-underline-offset: 0.2em; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); transition: text-decoration-color 0.15s; }
a:hover { text-decoration-color: currentColor; }
mark { padding: 0.02em 0.18em; border-radius: 0; background: var(--ink); color: var(--paper); }
.text-columns { max-width: none; columns: 2 22rem; column-gap: 3.5rem; }
.text-columns > * { max-width: none; }
.figures { margin: 3rem 0; border-bottom: 1px solid var(--rule); }
.figure { display: flow-root; max-width: none; margin: 0; padding: 2rem 0 2rem 26rem; border-top: 1px solid var(--rule); font-size: 1.375rem; line-height: 1.45; color: var(--muted); }
.figure strong { float: left; width: 24rem; margin: -0.55rem 0 0 -26rem; font: 300 6rem/1 var(--display); letter-spacing: -0.035em; color: var(--ink); font-variant-numeric: lining-nums; }
.note { max-width: 36rem; margin: 2.25rem 0; font-size: 1.125rem; line-height: 1.55; color: var(--muted); }
.note > :last-child, .callout > :last-child, .columns > * > :last-child { margin-bottom: 0; }
.callout { position: relative; max-width: 46rem; margin: 3.5rem 0; padding: 2rem 2.5rem; border: 3px solid var(--ink); font-size: 1.5rem; line-height: 1.5; }
.callout p { max-width: none; }
.callout a { color: inherit; }
.callout[data-tone="caution"] { padding-left: 6.25rem; border-color: var(--caution); }
.callout[data-tone="caution"]::before { content: ""; position: absolute; left: 2.25rem; top: 2.15rem; width: 2.5rem; height: 2.5rem; background: var(--caution); -webkit-mask: ${WARN} center / contain no-repeat; mask: ${WARN} center / contain no-repeat; }
.status, .tag { display: inline-flex; align-items: center; gap: 0.5em; font: 500 0.82em/1.3 var(--text); letter-spacing: 0.005em; vertical-align: 0.06em; }
.status { color: var(--ink); }
.status::before, .tag::before { content: ""; flex: none; width: 0.62em; height: 0.62em; border-radius: 50%; background: var(--ok); }
.status[data-state="caution"]::before { border-radius: 0; background: var(--caution); }
.status[data-state="open"]::before { background: transparent; box-shadow: inset 0 0 0 0.14em var(--open); }
.tag { color: var(--muted); }
.tag::before { width: 0.45em; height: 0.45em; border-radius: 0; background: currentColor; }
.timeline { display: block; margin: 3.5rem 0; border-bottom: 1px solid var(--rule); }
.timeline > li { display: grid; grid-template-columns: minmax(10rem, 18rem) minmax(0, 1fr); column-gap: 3rem; padding: 2.25rem 0 2.5rem; border-top: 1px solid var(--rule); }
.timeline time { grid-column: 1; grid-row: 1 / span 2; padding-top: 0.4rem; font: 500 1.5rem/1.3 var(--display); color: var(--muted); font-variant-numeric: lining-nums; }
.timeline strong { grid-column: 2; font: 500 2rem/1.15 var(--display); letter-spacing: -0.015em; }
.timeline p { grid-column: 2; max-width: 36rem; margin-top: 0.65rem; font-size: 1.25rem; line-height: 1.5; color: var(--muted); }
.timeline > li[data-state="done"] strong { font-weight: 400; color: var(--muted); }
.timeline > li[data-state="done"] time::before { content: ""; display: inline-block; width: 0.8em; height: 0.8em; margin-right: 0.45em; vertical-align: -0.06em; background: var(--ok); -webkit-mask: ${CHECK} center / contain no-repeat; mask: ${CHECK} center / contain no-repeat; }
.timeline > li[aria-current] { border-top: 0.4rem solid var(--ink); padding-top: 2rem; }
.timeline > li[aria-current] time { color: var(--ink); }
.timeline > li[aria-current] strong { font-weight: 600; }
.lines { grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr) auto; column-gap: 3rem; margin: 3.5rem 0; border-top: 1px solid var(--rule); }
.lines > li { column-gap: 3rem; padding: 1.6rem 0; border-bottom: 1px solid var(--rule); }
.lines strong { font: 600 1.5rem/1.25 var(--display); letter-spacing: -0.01em; }
.lines > li > span:not(.tag):not(.status) { font-size: 1.25rem; line-height: 1.45; color: var(--muted); }
.facts { grid-template-columns: minmax(10rem, 18rem) minmax(0, 1fr); margin: 3.5rem 0; border-bottom: 1px solid var(--rule); }
.facts dt, .facts dd { padding: 1.6rem 0; border-top: 1px solid var(--rule); }
.facts dt { padding-right: 3rem; font: 600 1.375rem/1.55 var(--display); }
.pages { max-width: 52rem; margin: 3rem 0 0; }
.pages ul { display: block; border-bottom: 1px solid var(--rule); }
.pages li { border-top: 1px solid var(--rule); }
.pages a { position: relative; padding: 2rem 5rem 2.1rem 0; }
.pages a::after { content: ""; position: absolute; right: 0.5rem; top: 2.15rem; width: 2rem; height: 2rem; background: currentColor; -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; transition: transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1); }
.pages a:hover::after { transform: translateX(0.6rem); }
.pages a strong { margin-bottom: 0.5rem; font: 500 2rem/1.15 var(--display); letter-spacing: -0.015em; }
.pages a:hover strong { text-decoration: underline; text-decoration-thickness: 0.06em; text-underline-offset: 0.16em; }
.pages a span:not(.tag):not(.status) { max-width: 36rem; font-size: 1.25rem; line-height: 1.45; color: var(--muted); }
.pages a .tag, .pages a .status { margin-top: 0.85rem; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 3rem 4rem; margin: 3.5rem 0; }
.columns > * { padding-top: 1.75rem; border-top: 3px solid var(--ink); }
.columns h3 { margin-top: 0; }
.columns p { max-width: none; }
.table-wrap { margin: 3.5rem 0; }
table { font-size: 1.25rem; line-height: 1.4; }
caption { padding-bottom: 1.25rem; font: 600 1.5rem/1.3 var(--display); letter-spacing: -0.01em; }
th, td { padding: 1.15rem 1.5rem 1.15rem 0; }
thead th { padding-top: 0; padding-bottom: 0.9rem; border-bottom: 2px solid var(--ink); font: 500 1rem/1.3 var(--text); color: var(--muted); }
tbody tr { border-bottom: 1px solid var(--rule); }
tbody th { min-width: 10.5rem; font-weight: 600; }
.steps { max-width: 44rem; margin: 3rem 0; padding: 0; list-style: none; counter-reset: step; border-bottom: 1px solid var(--rule); }
.steps li { position: relative; padding: 1.6rem 0 1.6rem 5rem; border-top: 1px solid var(--rule); counter-increment: step; }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 0.7rem; font: 300 2.75rem/1 var(--display); font-variant-numeric: lining-nums tabular-nums; }
details { max-width: 40rem; margin-top: 3rem; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
summary { display: flex; align-items: center; gap: 1rem; padding: 1.4rem 0; cursor: pointer; font: 600 1.375rem/1.3 var(--display); list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; flex: none; width: 0.55rem; height: 0.55rem; margin: 0 0.15rem 0 0.05rem; border: solid currentColor; border-width: 0 3px 3px 0; transform: rotate(-45deg); transition: transform 0.2s; }
details[open] summary::before { transform: translateY(-0.15rem) rotate(45deg); }
details > :not(summary) { margin-bottom: 1.5rem; }
.quote { max-width: 48rem; margin: 4rem 0; }
.quote blockquote { margin: 0; font: 400 2.25rem/1.28 var(--display); letter-spacing: -0.015em; }
.quote blockquote p { max-width: none; margin: 0; }
.quote blockquote p + p { margin-top: 0.6em; }
.quote figcaption { max-width: 36rem; margin-top: 1.4rem; font-size: 1.125rem; line-height: 1.45; color: var(--muted); }
.quotes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4rem 4.5rem; margin: 3.5rem 0 4rem; }
.quotes > .quote { padding-top: 1.75rem; border-top: 1px solid var(--rule); }
.quotes blockquote { font-size: 1.875rem; line-height: 1.3; }
.flow { gap: 3.5rem; margin: 3.5rem 0 4rem; }
.flow > li { padding-top: 5rem; font-size: 1.125rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); position: absolute; left: 0; top: 0; font: 300 3.5rem/1 var(--display); font-variant-numeric: lining-nums; }
.flow > li + li::before { top: 0.75rem; left: -2.95rem; width: 2.4rem; height: 2rem; }
.flow strong { margin-bottom: 0.5rem; font: 600 1.5rem/1.2 var(--display); letter-spacing: -0.01em; }
.flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.flow .tag { margin-top: 0.9rem; }
.diagram { margin: 3.5rem 0; }
.diagram svg { max-width: 60rem; color: var(--ink); }
.diagram .node { fill: var(--paper); stroke: var(--ink); stroke-width: 2; }
.diagram path.node { fill: var(--tint); }
.diagram .node.key { fill: var(--ink); stroke: var(--ink); }
.diagram .edge { stroke: var(--ink); stroke-width: 2; }
.diagram .head { fill: var(--ink); }
.diagram .label { fill: var(--ink); font: 500 15px var(--text); }
.diagram .label.small { fill: var(--muted); font: 400 14px var(--text); }
.diagram .label.on-key { fill: var(--paper); }
.diagram figcaption, .shot figcaption > p:first-child { max-width: 40rem; font-size: 1.125rem; line-height: 1.5; color: var(--muted); }
.diagram figcaption { margin-top: 1.25rem; }
.shot { margin: 4rem 0; }
.shot .screen { border: 0.6rem solid var(--bezel); border-radius: 2.5rem; background: var(--bezel); }
.shot .screen > svg, .shot .screen > img { border-radius: 1.9rem; }
.shot:not([data-device="phone"]) .screen { border-width: 2px; border-radius: 0.5rem; }
.shot:not([data-device="phone"]) .screen > svg, .shot:not([data-device="phone"]) .screen > img { border-radius: 0.35rem; }
.shot[data-device="phone"] { grid-template-columns: minmax(0, 21rem) minmax(0, 1fr); gap: 2rem 4rem; }
.shot figcaption > p:first-child { margin-bottom: 1.75rem; }
.pin, .pins > li::before { width: 2.25rem; height: 2.25rem; background: var(--ink); color: var(--paper); font: 600 1.0625rem/1 var(--display); }
.pin { margin: -1.125rem 0 0 -1.125rem; box-shadow: 0 0 0 3px var(--paper); }
.pins { margin: 0; }
.pins > li { min-height: 2.25rem; padding-left: 3.5rem; font-size: 1.25rem; line-height: 1.45; }
.pins > li + li { margin-top: 1.5rem; }
.pins > li::before { top: -0.05rem; }
.tally { --dot: min(1.1em, calc(min(100cqi, 40rem) / var(--of, 10))); --tally: var(--ink); --tally-off: color-mix(in srgb, var(--ink) 16%, transparent); margin-right: 0.35em; vertical-align: -0.1em; -webkit-mask-position: calc(var(--dot) * -0.08) 0; mask-position: calc(var(--dot) * -0.08) 0; }
p > .tally:first-child { --dot: min(1.3em, calc(min(100cqi, 40rem) / var(--of, 10))); display: block; margin: 0.4rem 0 1rem; }
@media (max-width: 48rem) {
  body { font-size: 1.1875rem; }
  .page { padding: 2.75rem 1.25rem 5rem; }
  .opening { margin-bottom: 4.5rem; }
  .opening .lead { margin-top: 1.75rem; font-size: 1.375rem; }
  .opening .meta { margin-top: 1.75rem; font-size: 1rem; }
  section { margin-top: 4.5rem; }
  section > h2 { margin-bottom: 1.5rem; }
  h2[data-label]::before { margin-bottom: 0.75rem; font-size: 1rem; }
  h3 { margin-top: 2.25rem; font-size: 1.4375rem; }
  .figure { padding: 1.4rem 0; font-size: 1.1875rem; }
  .figure strong { float: none; display: block; width: auto; margin: 0 0 0.35rem; font-size: 4rem; }
  .callout { padding: 1.4rem 1.5rem; font-size: 1.25rem; }
  .callout[data-tone="caution"] { padding-left: 4.25rem; }
  .callout[data-tone="caution"]::before { left: 1.35rem; top: 1.55rem; width: 1.9rem; height: 1.9rem; }
  .timeline > li { grid-template-columns: minmax(0, 1fr); padding: 1.6rem 0 1.75rem; }
  .timeline > li[aria-current] { padding-top: 1.4rem; }
  .timeline time { grid-row: auto; margin-bottom: 0.35rem; padding: 0; font-size: 1.1875rem; }
  .timeline strong, .timeline p { grid-column: 1; }
  .timeline strong { font-size: 1.5rem; }
  .timeline p { font-size: 1.0625rem; }
  .lines { grid-template-columns: minmax(0, 1fr) auto; }
  .lines > li { row-gap: 0.4rem; padding: 1.2rem 0; }
  .lines strong { font-size: 1.25rem; }
  .lines > li > span:not(.tag):not(.status) { font-size: 1.0625rem; }
  .facts { grid-template-columns: minmax(0, 1fr); }
  .facts dt { padding: 1.2rem 0 0.2rem; font-size: 1.1875rem; }
  .facts dd { padding: 0 0 1.2rem; border-top: 0; }
  .pages a { padding: 1.4rem 3rem 1.5rem 0; }
  .pages a::after { right: 0; top: 1.55rem; width: 1.5rem; height: 1.5rem; }
  .pages a strong { font-size: 1.5rem; }
  .pages a span:not(.tag):not(.status) { font-size: 1.0625rem; }
  .columns { gap: 2.5rem; }
  table { font-size: 1.0625rem; }
  th, td { min-width: 9rem; padding: 0.9rem 1.25rem 0.9rem 0; }
  .steps li { padding: 1.2rem 0 1.2rem 3.25rem; }
  .steps li::before { top: 1rem; font-size: 2rem; }
  .quote { margin: 3rem 0; }
  .quote blockquote { font-size: 1.625rem; }
  .quotes { grid-template-columns: minmax(0, 1fr); gap: 2.5rem; }
  .quotes blockquote { font-size: 1.5rem; }
  .flow { gap: 2.4rem; }
  .flow > li { padding: 0 0 0 3.25rem; font-size: 1.0625rem; }
  .flow > li::after { top: -0.2rem; font-size: 2.5rem; }
  .flow > li + li::before { top: -1.95rem; left: -0.4rem; width: 2.2rem; height: 1.5rem; }
  .flow strong { font-size: 1.3125rem; }
  .shot[data-device="phone"] { grid-template-columns: minmax(0, 1fr); }
  .shot .screen > svg, .shot .screen > img { border-radius: 1.7rem; }
  .pins > li { font-size: 1.0625rem; }
}
@media (prefers-reduced-motion: reduce) { a, .pages a::after, summary::before { transition: none; } }
@media print {
  body { font-size: 12pt; }
  .page { max-width: none; padding: 0; }
  section { margin-top: 2.5rem; }
  h1 { font-size: 34pt; }
  section > h2 { font-size: 22pt; }
  .figure strong { font-size: 40pt; }
  .pages a::after { display: none; }
  .status::before, .tag::before, .timeline > li[data-state="done"] time::before, .callout[data-tone="caution"]::before, .shot .screen { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export const LARGE: HouseStyle = {
  id: "large",
  name: "Large",
  summary: "Big type with wide space between sections: a 22px body, headlines up to 92px, numbers at 96px one to a row, in black, grey and white, with colour only on the marks that show state.",
  best_for: "Pages read on a large screen or shared in a meeting: a release plan, a decision and its reasons, a few numbers that have to carry across a room.",
  character: "Calm and sure. Near-black text on white with grey for secondary text and hairline rules; in dark, warm off-white on near-black with lighter greys and its own rules. Green, red and grey appear only as small state marks. Red Hat Display for headings and numbers, Red Hat Text for reading.",
  signature: [
    "Headlines up to 5.75rem and numbers at 6rem in a light weight, one figure to a row beside what it counts",
    "A release plan as stacked rows: reached rows grey with a green tick, the current row under a thick black bar, planned rows plain",
    "Links to other pages as large rows with an arrow that moves on hover",
    "A callout in a thick black frame; a caution callout in red with a drawn warning mark",
    "Highlighted words reversed out of a black band",
    "Quotes at 2.25rem, two to a row in a wall of voices",
  ],
  avoid: [
    "Colour on anything but state: only the green, red and grey marks are coloured",
    "Long paragraphs: two or three sentences, one idea each",
    "Shrinking type to fit more on the page: cut words instead",
    "Filled boxes, tinted panels and shadows around content",
    "More than one or two highlighted phrases on a page",
  ],
  rules: `# Large\n\nA Story set big enough to read from across a room: one idea at a time, in black and grey, with colour only for state.\n\n${rule([
    "Write for a room: one idea per section, a heading that states it as a sentence, and paragraphs of two or three sentences. Cut words before anything gets smaller.",
    "Colour means state and nothing else: green is evidence or done, red is caution, grey is open. Every .status names its state in words beside its mark.",
    "Put the numbers that matter in .figures, one per row, written short (\"19 of 23\", \"2.5 h\") so each stays on one line at full size.",
    "In ol.timeline, mark what is reached with data-state=\"done\" and the release in progress with aria-current=\"step\"; the current row carries the thick bar, so mark only one.",
    "Use <mark> once or twice a page, on a few words of a quote or passage: it reverses the text out of black and is the strongest emphasis the page has. Keep the framed .callout for the one thing that changes how the page reads.",
  ])}\n`,
  stylesheet: CSS,
};
