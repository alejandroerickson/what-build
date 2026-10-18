import { BASE, faces, rule, schemes, type HouseStyle } from "./kit.ts";

/** Headings, figures and labels take the face's widest setting; body text stays at its normal width. */
const W = "font-stretch: var(--wide);";

/**
 * Wide: extended headings over a normal-width body. Archivo carries a width axis, so headings,
 * figures and labels are set at 125% while paragraphs stay at 100% for reading. Black and white,
 * thin rules and square marks, and one signal orange for what is current and what matters, always
 * with ink text on it. In dark, a near-black ground with real surface steps and a lifted orange.
 */
const CSS = `${schemes(
  {
    "--paper": "#ffffff", "--ink": "#111214", "--muted": "#5b5e63", "--rule": "#e3e4e6", "--edge": "#111214", "--line": "#b9bcc1", "--tint": "#f3f4f5", "--panel": "#ffffff",
    "--accent": "#ff4f00", "--accent-text": "#c23a00", "--on-accent": "#111214", "--focus": "#e04400", "--select": "#ff4f00", "--on-select": "#111214",
    "--ok": "#1d7a45", "--caution": "#ff4f00", "--open": "#75787d", "--mark": "#ffcfb8", "--field": "#fff0e8",
  },
  {
    "--paper": "#111214", "--ink": "#f2f2f0", "--muted": "#a3a6ab", "--rule": "#2b2d31", "--edge": "#686b71", "--line": "#4a4d53", "--tint": "#1a1c1f", "--panel": "#18191c",
    "--accent": "#ff6a26", "--accent-text": "#ff7c42", "--on-accent": "#111214", "--focus": "#ff6a26", "--select": "#ff6a26", "--on-select": "#111214",
    "--ok": "#4cbf7e", "--caution": "#ff6a26", "--open": "#8b8e93", "--mark": "#5a2a14", "--field": "#2b1a12",
  },
)}${faces({ sans: '"Archivo", "Helvetica Neue", Arial, system-ui, sans-serif' })}${BASE}
:root { --wide: 125%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); font-stretch: 100%; -webkit-font-smoothing: antialiased; }
.page { max-width: 68rem; margin: 0 auto; padding: 0 clamp(1.25rem, 5vw, 4rem) 6rem; }
.opening { display: grid; gap: 1.5rem; padding: clamp(3rem, 9vw, 6.5rem) 0 2.25rem; border-bottom: 1px solid var(--edge); }
.opening > * { margin: 0; }
.kicker, .opening .meta { font: 500 0.8125rem/1.5 var(--sans); ${W} color: var(--muted); }
h1 { max-width: 60rem; font: 700 clamp(2.125rem, 5.6vw, 4.25rem)/1.02 var(--sans); ${W} letter-spacing: -0.02em; }
.lead { max-width: 40rem; font-size: clamp(1.1875rem, 1.8vw, 1.3125rem); line-height: 1.5; }
.opening .meta { padding-top: 0.25rem; }
section { margin-top: clamp(3.5rem, 7vw, 5.5rem); padding-top: 1.25rem; border-top: 1px solid var(--rule); }
.opening + section { margin-top: 0; padding-top: clamp(2.5rem, 5vw, 3.5rem); border-top: 0; }
section > h2 { max-width: 44rem; margin: 0 0 1.25rem; font: 700 clamp(1.375rem, 2.6vw, 1.75rem)/1.2 var(--sans); ${W} letter-spacing: -0.01em; }
h2[data-label]::before { content: attr(data-label); display: block; margin-bottom: 0.875rem; font: 600 0.6875rem/1.2 var(--sans); ${W} letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
h3 { margin: 2rem 0 0.5rem; font: 700 1.0625rem/1.3 var(--sans); ${W} }
p, ul, ol { max-width: 38rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.25rem; }
li::marker { color: var(--muted); }
strong { font-weight: 700; }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.22em; transition: color 0.15s, text-decoration-color 0.15s; }
a:hover { color: var(--accent-text); text-decoration-color: var(--accent); text-decoration-thickness: 2px; }
mark { padding: 0 0.1em; border-radius: 0; background: var(--mark); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 2rem; margin: 2.25rem 0 2rem; }
.figure { max-width: none; margin: 0; padding-top: 1rem; border-top: 1px solid var(--edge); font-size: 0.9375rem; line-height: 1.5; color: var(--muted); }
.figure strong { display: block; margin-bottom: 0.75rem; font: 300 clamp(2.5rem, 4.4vw, 3.5rem)/1 var(--sans); ${W} letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums lining-nums; white-space: nowrap; }
.note { max-width: 38rem; margin: 1.75rem 0; padding-top: 0.875rem; border-top: 1px solid var(--rule); font-size: 0.9375rem; line-height: 1.55; color: var(--muted); }
.callout { position: relative; max-width: 44rem; margin: 2.25rem 0; padding: 1.25rem 1.5rem; border: 1px solid var(--edge); }
.callout > :last-child { margin-bottom: 0; }
.callout[data-tone="caution"] { padding-left: 3.75rem; border-color: var(--accent); background: var(--field); }
.callout[data-tone="caution"]::before { content: ""; position: absolute; left: 1.25rem; top: 1.4rem; width: 1.375rem; height: 1.375rem; background: linear-gradient(var(--on-accent), var(--on-accent)) 50% 0.25rem / 3px 0.55rem no-repeat, linear-gradient(var(--on-accent), var(--on-accent)) 50% calc(100% - 0.25rem) / 3px 3px no-repeat, var(--accent); }
.status { display: inline-flex; align-items: center; gap: 0.5em; font: 600 0.6875rem/1.2 var(--sans); ${W} letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); vertical-align: 0.1em; }
.status::before { content: ""; flex: none; width: 0.625rem; height: 0.625rem; background: var(--ok); }
.status[data-state="caution"]::before { background: var(--caution); }
.status[data-state="open"]::before { background: transparent; box-shadow: inset 0 0 0 1.5px var(--open); }
.tag { display: inline-block; padding: 0.3em 0.55em 0.25em; border: 1px solid var(--line); font: 600 0.6875rem/1.2 var(--sans); ${W} letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink); vertical-align: 0.1em; }
.timeline { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 2.25rem 0 2.75rem; }
.timeline > li { position: relative; padding: 0 1.5rem 0 0; background: linear-gradient(var(--track, var(--line)), var(--track, var(--line))) 0 calc(0.875rem - 1px) / 100% 2px no-repeat; }
.timeline > li[data-state="done"] { --track: var(--ink); }
.timeline > li:last-child { background: none; }
.timeline > li::before { content: ""; display: block; width: 0.875rem; height: 0.875rem; margin: 0.4375rem 0 1.25rem; background: var(--paper); box-shadow: inset 0 0 0 2px var(--muted); }
.timeline > li[data-state="done"]::before { background: var(--ink); box-shadow: none; }
.timeline time { height: 1.25rem; margin-bottom: 0.5rem; font: 600 0.6875rem/1.25rem var(--sans); ${W} letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.timeline > li[aria-current]::before { visibility: hidden; }
.timeline > li[aria-current] time { position: absolute; left: 0; top: 0; height: 1.75rem; padding: 0 0.625rem; line-height: 1.75rem; background: var(--accent); color: var(--on-accent); font-weight: 700; }
.timeline > li[aria-current] strong { padding-top: 1.75rem; }
.timeline strong { margin-bottom: 0.4rem; font: 700 1.0625rem/1.25 var(--sans); ${W} }
.timeline p { font-size: 0.9375rem; line-height: 1.5; color: var(--muted); }
.lines { grid-template-columns: minmax(9rem, 15rem) minmax(0, 1fr) auto; margin: 2.25rem 0; border-top: 1px solid var(--edge); }
.lines > li { grid-template-columns: minmax(9rem, 15rem) minmax(0, 1fr) auto; grid-template-columns: subgrid; padding: 0.95rem 0; border-bottom: 1px solid var(--rule); font-size: 0.9375rem; line-height: 1.5; }
.lines strong { font: 700 0.9375rem/1.4 var(--sans); ${W} }
.facts { margin: 2rem 0; border-top: 1px solid var(--edge); }
.facts dt, .facts dd { padding: 0.9rem 0; border-bottom: 1px solid var(--rule); }
.facts dt { font: 600 0.6875rem/1.7rem var(--sans); ${W} letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.pages { margin: 2rem 0 0.5rem; }
.pages ul { row-gap: 1.75rem; }
.pages a { position: relative; display: flex; flex-direction: column; gap: 0.5rem; padding: 1.1rem 2.5rem 0.25rem 0; border-top: 1px solid var(--edge); transition: border-color 0.2s; }
.pages a::after { content: ""; position: absolute; top: 1.2rem; right: 0; width: 1.25rem; height: 1.25rem; background: var(--ink); -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; transition: transform 0.2s, background-color 0.2s; }
.pages a:hover { color: inherit; border-top-color: var(--accent); }
.pages a:hover::after { background: var(--accent); transform: translateX(0.25rem); }
.pages a strong { font: 700 1.125rem/1.25 var(--sans); ${W} }
.pages a span:not(.tag) { font-size: 0.9375rem; line-height: 1.5; color: var(--muted); }
.pages a .tag { align-self: flex-start; margin-top: auto; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1.5rem; margin: 2rem 0; }
.columns > * { padding: 1.5rem 1.5rem 1.375rem; border: 1px solid var(--line); background: var(--panel); }
.columns h3 { margin-top: 0; }
.columns > * > :last-child { margin-bottom: 0; }
.text-columns { max-width: none; columns: 2 18rem; column-gap: 2.5rem; column-rule: 1px solid var(--rule); }
.text-columns > * { max-width: none; }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding-bottom: 0.875rem; font: 700 1rem/1.3 var(--sans); ${W} }
th, td { padding: 0.8rem 1.25rem 0.8rem 0; border-bottom: 1px solid var(--rule); }
thead th { padding-top: 0; padding-bottom: 0.6rem; border-bottom-color: var(--edge); font: 600 0.6875rem/1.4 var(--sans); ${W} letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); vertical-align: bottom; }
tbody th { font: 600 0.875rem/1.45 var(--sans); ${W} }
td, tbody th { font-variant-numeric: tabular-nums lining-nums; }
.steps { counter-reset: step; list-style: none; max-width: 40rem; margin: 2rem 0; padding: 0; }
.steps li { position: relative; counter-increment: step; padding: 1rem 0 1rem 3rem; border-top: 1px solid var(--rule); }
.steps li:last-child { border-bottom: 1px solid var(--rule); }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 1rem; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; box-shadow: inset 0 0 0 1px var(--edge); font: 600 0.75rem/1 var(--sans); ${W} font-variant-numeric: tabular-nums lining-nums; }
details { max-width: 40rem; margin-top: 2rem; border-top: 1px solid var(--edge); border-bottom: 1px solid var(--rule); }
summary { position: relative; padding: 1rem 2.25rem 1rem 0; cursor: pointer; list-style: none; font: 700 0.9375rem/1.4 var(--sans); ${W} }
summary::-webkit-details-marker { display: none; }
summary::after { content: ""; position: absolute; right: 0.25rem; top: 50%; width: 0.875rem; height: 0.875rem; margin-top: -0.4375rem; background: linear-gradient(var(--ink), var(--ink)) center / 100% 2px no-repeat, linear-gradient(var(--ink), var(--ink)) center / 2px 100% no-repeat; transition: background-size 0.2s; }
details[open] summary::after { background-size: 100% 2px, 2px 0; }
details > p:last-child { margin-bottom: 1.25rem; }
.quote { margin: 2.25rem 0; padding-top: 1rem; border-top: 1px solid var(--edge); }
.quote blockquote { margin: 0; font: 400 clamp(1.25rem, 2.2vw, 1.5rem)/1.45 var(--sans); }
.quote blockquote p { max-width: 36rem; margin: 0; }
.quote figcaption { margin-top: 1rem; font: 600 0.6875rem/1.6 var(--sans); ${W} letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.quotes { gap: 2rem; margin: 2.25rem 0; }
.quotes .quote { display: flex; flex-direction: column; justify-content: space-between; }
.quotes blockquote { font-size: 1.1875rem; line-height: 1.5; }
.flow { gap: 2.5rem; margin: 2.25rem 0 2.75rem; }
.flow > li { padding-top: 1rem; border-top: 1px solid var(--edge); font-size: 0.9375rem; line-height: 1.5; }
.flow > li + li::before { top: -0.5rem; left: -2.05rem; width: 1.6rem; height: 1rem; }
.flow strong { margin-bottom: 0.35rem; font: 700 1rem/1.3 var(--sans); ${W} }
.flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.flow .tag { margin-top: 0.75rem; }
.diagram svg { color: var(--ink); }
.diagram .node { fill: var(--panel); stroke: var(--ink); stroke-width: 1.5; }
.diagram rect.node { rx: 0; }
.diagram path.node { fill: var(--tint); }
.diagram .node.key { fill: var(--accent); stroke: var(--accent); }
.diagram .label { fill: var(--ink); font: 600 14px var(--sans); }
.diagram .label.on-key { fill: var(--on-accent); }
.diagram .label.small { fill: var(--muted); font: 500 12px var(--sans); ${W} letter-spacing: 0.02em; }
.diagram .edge { stroke: var(--ink); stroke-width: 1.5; }
.diagram .head { fill: var(--ink); }
.diagram figcaption, .shot figcaption > p:first-child { font-size: 0.875rem; line-height: 1.5; color: var(--muted); }
.shot { margin: 2.5rem 0; }
.shot .screen { border: 1px solid var(--edge); background: var(--paper); }
.pin, .pins > li::before { width: 1.625rem; height: 1.625rem; border-radius: 0; background: var(--accent); color: var(--on-accent); font: 700 0.8125rem/1 var(--sans); ${W} }
.pin { margin: -0.8125rem 0 0 -0.8125rem; box-shadow: 0 0 0 2px var(--paper); }
.pins { margin: 1.25rem 0 0; }
.pins > li { padding-left: 2.5rem; font-size: 0.9375rem; line-height: 1.5; }
.pins > li::before { top: 0; }
.tally { --dot: 0.75em; --tally: var(--ink); --tally-off: var(--line); aspect-ratio: var(--of, 10) / 0.75; vertical-align: 0; -webkit-mask: linear-gradient(90deg, #000 75%, transparent 0) 0 0 / calc(100% / var(--of, 10)) 100% repeat-x; mask: linear-gradient(90deg, #000 75%, transparent 0) 0 0 / calc(100% / var(--of, 10)) 100% repeat-x; }
@media (max-width: 48rem) {
  :root { --wide: 112%; }
  .opening { gap: 1.25rem; }
  .figure strong { font-size: 2.5rem; }
  .timeline { grid-auto-flow: row; grid-template-columns: minmax(0, 1fr); }
  .timeline > li { padding: 0 0 1.75rem 2.25rem; background-position: calc(0.4375rem - 1px) 0.5rem; background-size: 2px 100%; }
  .timeline > li::before { position: absolute; left: 0; top: 0.1875rem; margin: 0; }
  .timeline > li[aria-current]::before { visibility: visible; top: 0.3125rem; background: var(--accent); box-shadow: none; }
  .timeline > li[aria-current] time { position: static; display: inline-block; height: 1.5rem; padding: 0 0.5rem; line-height: 1.5rem; }
  .timeline > li[aria-current] strong { padding-top: 0; }
  .lines { grid-template-columns: minmax(0, 1fr) auto; }
  .lines > li { grid-template-columns: minmax(0, 1fr) auto; grid-template-columns: subgrid; row-gap: 0.25rem; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.15rem; }
  .flow > li + li::before { top: -1.9rem; left: 0.3rem; }
  .callout { padding: 1.125rem 1.25rem; }
  .callout[data-tone="caution"] { padding-left: 3.25rem; }
  .callout[data-tone="caution"]::before { left: 1rem; top: 1.3rem; }
}
@media (prefers-reduced-motion: reduce) { a, .pages a, .pages a::after, summary::after { transition: none; } }
@media print {
  .page { max-width: none; padding: 0; }
  .opening { padding-top: 0; }
  section { margin-top: 2.5rem; }
  .pages a::after { display: none; }
  .timeline > li, .timeline > li::before, .timeline time, .callout, .status::before, .diagram { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export const WIDE: HouseStyle = {
  id: "wide",
  name: "Wide",
  summary: "Extended headings, figures and labels over a normal-width body, in black and white with thin rules and square marks, and one orange that marks what is current and what matters.",
  best_for: "Release plans, roadmaps and product overviews that should read as calm and confident: one clear current step, a few hard numbers, and the pages to read next.",
  character: "Precise, technical and calm. A white ground with near-black ink, grey for secondary text and 1px rules, and one signal orange that always carries ink text; in dark, a near-black ground with off-white ink, darker panels and a lifted orange. Archivo throughout: headings, figures and labels at its widest setting, sentence case; paragraphs and quotes at normal width.",
  signature: [
    "Extended headings: the title, section headings and figures set at 125% width in sentence case",
    "A release track: done milestones as ink squares on a 2px line, the current one as an orange block carrying its date, planned ones hollow",
    "Large light extended figures, each over a 1px ink rule",
    "Small wide capitals for every label: section labels, table heads, tags, states and quote sources",
    "Orange only for what is current or what matters: the current milestone, the key diagram node, marked words, pins and cautions",
    "Pages to read next as ruled entries whose arrow turns orange on hover",
  ],
  avoid: [
    "Orange as decoration, as the ground of a whole block, or with white text on it",
    "Wide paragraphs: body text and quotes stay at normal width for reading",
    "Capitals in headings: only the small labels are capitals",
    "Rounded corners, shadows and tinted cards: structure is 1px rules and square marks",
  ],
  rules: `# Wide\n\nExtended headings over a normal-width body, in black and white with one signal orange.\n\n${rule([
    "Orange means current or important and nothing else: the milestone the team is working towards, the key node in a diagram, the words that matter (mark), the pins on a mockup and a caution callout. Use it once or twice per section at most.",
    "Text on orange is always ink, never white. States keep their colours: evidence green for decided or supported, orange for caution, a hollow grey square for open; the label always names the state in words.",
    "Put a plan on the track (ol.timeline): mark every milestone reached data-state=\"done\" and exactly one aria-current=\"step\"; leave the rest plain so they draw hollow.",
    "Write headings in sentence case and let the width carry them. Keep the h1 to one conclusion of about twelve words; it wraps to three lines at most.",
    "Give .figures two to four real numbers of about eight characters, so each sits on one line at display size, with the words beneath saying what was counted.",
    "Keep labels short (one to four words): section labels (data-label), tags, states and quote sources are set wide in capitals and run long quickly.",
  ])}\n`,
  stylesheet: CSS,
};
