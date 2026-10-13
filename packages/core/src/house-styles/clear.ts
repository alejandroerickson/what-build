import { BASE, faces, rule, schemes, svgUrl, type HouseStyle } from "./kit.ts";

/** A milestone reached: a filled circle with a tick cut out of it, so the ground shows through. */
const DONE = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><mask id='t'><rect width='24' height='24' fill='#fff'/><path d='M6.4 12.3l3.7 3.7 7.5-7.8' fill='none' stroke='#000' stroke-width='2.7'/></mask><circle cx='12' cy='12' r='12' mask='url(#t)'/></svg>`);

/** Warning text's mark: a filled circle with an exclamation mark cut out of it. */
const WARN = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M12 0a12 12 0 1 0 0 24a12 12 0 1 0 0-24zM10.35 4.6h3.3l-.5 9.9h-2.3zM12 16.3a1.9 1.9 0 1 0 0 3.8a1.9 1.9 0 1 0 0-3.8z'/></svg>`);

/**
 * Clear: the plainness of public-service design systems. Big bold type in Public Sans, near-black
 * on white, underlined links in the text colour, and one yellow kept for focus, selection and the
 * words that matter. Every block takes a form readers already know how to use: a numbered step
 * list for the plan, summary lists with a rule under every row, a task list of pages, tinted tags
 * that name their state, and warning text for caution. Dark is a deep neutral ground with
 * off-white text, lifted green and red, and the same yellow.
 */
const CSS = `${schemes(
  {
    "--paper": "#ffffff", "--ink": "#0b0c0c", "--muted": "#505a5f", "--rule": "#b1b4b6", "--tint": "#f3f2f1",
    "--accent": "#ffdd00", "--on-accent": "#0b0c0c", "--focus": "#ffdd00", "--focus-ink": "#0b0c0c", "--select": "#ffdd00", "--on-select": "#0b0c0c", "--mark": "#ffdd00", "--on-mark": "#0b0c0c",
    "--ok": "#00703c", "--caution": "#d4351c", "--open": "#505a5f",
    "--ok-bg": "#cce2d8", "--ok-ink": "#005a30", "--caution-bg": "#f4cdc6", "--caution-ink": "#8e2412", "--open-bg": "#e5e6e7", "--open-ink": "#383f43", "--tag-bg": "#e5e6e7",
    "--panel": "#00703c", "--on-panel": "#ffffff", "--pin": "#0b0c0c", "--on-pin": "#ffffff",
  },
  {
    "--paper": "#0f1112", "--ink": "#f0f0ee", "--muted": "#b4b9bc", "--rule": "#495054", "--tint": "#1b1e20",
    "--accent": "#ffdd00", "--on-accent": "#0b0c0c", "--focus": "#ffdd00", "--focus-ink": "#0b0c0c", "--select": "#ffdd00", "--on-select": "#0b0c0c", "--mark": "#ffdd00", "--on-mark": "#0b0c0c",
    "--ok": "#4fbf87", "--caution": "#ff7a66", "--open": "#b4b9bc",
    "--ok-bg": "#153b29", "--ok-ink": "#a9e6c6", "--caution-bg": "#4a1d16", "--caution-ink": "#ffc6bc", "--open-bg": "#2a2f32", "--open-ink": "#d6d9db", "--tag-bg": "#2a2f32",
    "--panel": "#17633f", "--on-panel": "#ffffff", "--pin": "#0b0c0c", "--on-pin": "#ffffff",
  },
)}:root { --done: ${DONE}; --warn: ${WARN}; }
${faces({ sans: '"Public Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.1875rem/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
.page { max-width: 60rem; margin: 0 auto; padding: clamp(2rem, 5vw, 3.5rem) clamp(1rem, 4vw, 2rem) 5rem; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 0; box-shadow: inset 0 0 0 2px var(--focus-ink); }
a { color: var(--ink); text-decoration: underline; text-decoration-thickness: max(1px, 0.0625rem); text-underline-offset: 0.15em; }
a:hover { text-decoration-thickness: max(3px, 0.1875rem); text-decoration-skip-ink: none; }
mark { padding: 0 0.1em; border-radius: 0; background: var(--mark); color: var(--on-mark); }
.opening { margin-bottom: 3rem; }
.opening > * { margin: 0; }
.kicker { margin-bottom: 0.4rem; font: 400 1.1875rem/1.35 var(--sans); color: var(--muted); }
h1 { max-width: 46rem; margin: 0 0 1.5rem; font: 700 clamp(2.25rem, 1rem + 4.2vw, 3.5rem)/1.09 var(--sans); letter-spacing: -0.012em; }
.opening h1 { margin-bottom: 1.5rem; }
.lead { max-width: 40rem; margin-bottom: 1.25rem; font: 400 1.5rem/1.45 var(--sans); }
.opening .meta { margin-top: 1.25rem; font-size: 1rem; line-height: 1.5; color: var(--muted); }
section { margin-top: 3rem; padding-top: 2.5rem; border-top: 1px solid var(--rule); }
section > :last-child { margin-bottom: 0; }
section section { margin-top: 2rem; padding-top: 0; border-top: 0; }
h2 { max-width: 46rem; margin: 0 0 1.25rem; font: 700 2.25rem/1.15 var(--sans); letter-spacing: -0.006em; }
h2[data-label]::before { content: attr(data-label); display: block; margin-bottom: 0.35rem; font: 400 1.1875rem/1.35 var(--sans); letter-spacing: 0; color: var(--muted); }
h3 { margin: 2rem 0 0.75rem; font: 700 1.5rem/1.25 var(--sans); }
p, ul, ol { max-width: 40rem; margin: 0 0 1.25rem; }
:where(ul:not([class]), ol:not([class])) { padding-left: 1.25rem; }
:where(ul:not([class]), ol:not([class])) > li + li { margin-top: 0.35rem; }
strong, b { font-weight: 700; }
hr { margin: 2.5rem 0; border: 0; border-top: 1px solid var(--rule); }
.note { max-width: 40rem; margin: 1.5rem 0; font-size: 1rem; line-height: 1.5; color: var(--muted); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1.25rem; margin: 2rem 0 1.5rem; }
.figure { max-width: none; margin: 0; padding: 1.5rem 1.5rem 1.6rem; background: var(--tint); font-size: 1.0625rem; line-height: 1.45; }
.figure strong { display: block; margin-bottom: 0.6rem; font: 700 clamp(2.5rem, 1.6rem + 2.2vw, 3.25rem)/1.05 var(--sans); letter-spacing: -0.012em; font-variant-numeric: tabular-nums lining-nums; }
.figure:first-child { background: var(--panel); color: var(--on-panel); }
.callout { max-width: 40rem; margin: 2rem 0; padding: 1.25rem 1.5rem; background: var(--tint); }
.callout > :last-child, .columns > * > :last-child, details > :last-child { margin-bottom: 0; }
.callout[data-tone="caution"] { position: relative; min-height: 2.5rem; padding: 0.25rem 0 0.25rem 3.4rem; background: none; font-weight: 700; }
.callout[data-tone="caution"]::before { content: ""; position: absolute; left: 0; top: 0.05rem; width: 2.4rem; height: 2.4rem; background: var(--ink); -webkit-mask: var(--warn) center / contain no-repeat; mask: var(--warn) center / contain no-repeat; }
.status, .tag { display: inline-block; padding: 0.2em 0.5em 0.24em; border-radius: 0; font: 700 0.9375rem/1.25 var(--sans); letter-spacing: 0; vertical-align: 0.08em; }
.status { background: var(--ok-bg); color: var(--ok-ink); }
.status[data-state="caution"] { background: var(--caution-bg); color: var(--caution-ink); }
.status[data-state="open"] { background: var(--open-bg); color: var(--open-ink); }
.tag { background: var(--tag-bg); color: var(--ink); }
.timeline { grid-template-columns: minmax(0, 1fr); max-width: 44rem; margin: 2rem 0 0.5rem; }
.timeline > li { position: relative; margin: 0; padding: 0.75rem 1.25rem 2.25rem 4rem; }
.timeline > li::before { content: counter(milestone); position: absolute; left: 0; top: 0.25rem; z-index: 1; display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 3px solid var(--ink); border-radius: 50%; background: var(--paper); color: var(--ink); font: 700 1.0625rem/1 var(--sans); font-variant-numeric: tabular-nums lining-nums; }
.timeline > li::after { content: ""; position: absolute; left: calc(1.25rem - 1.5px); top: 2.75rem; bottom: -0.25rem; width: 3px; background: var(--rule); }
.timeline > li:last-child::after { content: none; }
.timeline > li[data-state="done"]::before { content: ""; border-color: var(--ok); background: var(--ok); -webkit-mask: var(--done) center / 100% no-repeat; mask: var(--done) center / 100% no-repeat; }
.timeline > li[data-state="done"]::after { background: var(--ok); }
.timeline > li[aria-current] { background: linear-gradient(var(--tint) 0 0) 3.25rem 0 / calc(100% - 3.25rem) calc(100% - 1.5rem) no-repeat; }
.timeline > li[aria-current]::before { background: var(--ink); color: var(--paper); }
.timeline time { font-size: 1rem; line-height: 1.5; color: var(--muted); }
.timeline strong { margin: 0.1rem 0 0.25rem; font: 700 1.25rem/1.3 var(--sans); }
.timeline p { font-size: 1.0625rem; line-height: 1.5; color: var(--muted); }
.timeline > li[aria-current] time, .timeline > li[aria-current] p { color: var(--ink); }
.lines { grid-template-columns: minmax(9rem, 15rem) minmax(0, 1fr) auto; margin: 1.5rem 0 2rem; }
.lines > li { margin: 0; padding: 0.8rem 0; border-bottom: 1px solid var(--rule); }
.facts { grid-template-columns: minmax(8rem, 15rem) minmax(0, 1fr); margin: 1.5rem 0 2rem; }
.facts dt, .facts dd { padding: 0.8rem 0; border-bottom: 1px solid var(--rule); }
.facts dt { font-weight: 700; }
.pages { max-width: 46rem; margin: 1.5rem 0 2rem; }
.pages ul { display: block; border-top: 1px solid var(--rule); }
.pages li { margin: 0; border-bottom: 1px solid var(--rule); }
.pages a { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 1.5rem; align-items: center; height: auto; margin: 0 -0.75rem; padding: 1rem 0.75rem; transition: background-color 0.15s; }
.pages a strong { font: 700 1.1875rem/1.35 var(--sans); text-decoration: underline; text-decoration-thickness: max(1px, 0.0625rem); text-underline-offset: 0.15em; }
.pages a span:not(.tag):not(.status) { grid-column: 1; margin-top: 0.2rem; font-size: 1.0625rem; line-height: 1.45; color: var(--muted); }
.pages a .tag, .pages a .status { grid-column: 2; grid-row: 1 / span 2; justify-self: end; }
.pages a:hover { background-color: var(--tint); }
.pages a:hover strong { text-decoration-thickness: max(3px, 0.1875rem); text-decoration-skip-ink: none; }
a:focus-visible, summary:focus-visible, .pages a:focus-visible { outline: 3px solid transparent; box-shadow: none; background: linear-gradient(var(--focus-ink) 0 0) 0 100% / 100% 4px no-repeat, var(--focus); color: var(--focus-ink); text-decoration: none; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.pages a:focus-visible strong { text-decoration: none; }
.pages a:focus-visible span:not(.tag):not(.status) { color: var(--focus-ink); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1.5rem; margin: 2rem 0; }
.columns > * { padding: 0 1.25rem 1.25rem; border: 1px solid var(--rule); }
.columns > * > * { max-width: none; }
.columns h3 { margin: 0 -1.25rem 1rem; padding: 0.85rem 1.25rem; background: var(--tint); font-size: 1.1875rem; line-height: 1.35; }
.text-columns { max-width: none; columns: 2 18rem; column-gap: 2.5rem; column-rule: 1px solid var(--rule); }
.text-columns > * { max-width: none; break-inside: avoid; }
.table-wrap { margin: 2rem 0; }
table { font-size: 1.0625rem; line-height: 1.45; }
caption { padding-bottom: 0.9rem; font: 700 1.3125rem/1.3 var(--sans); }
th, td { padding: 0.7rem 1.25rem 0.7rem 0; border-bottom: 1px solid var(--rule); }
th:last-child, td:last-child { padding-right: 0; }
th { font-weight: 700; }
.steps { padding-left: 1.5rem; }
.steps li + li { margin-top: 0.75rem; }
.steps li::marker { font-weight: 700; }
details { max-width: 40rem; margin: 1.75rem 0; }
summary { position: relative; display: inline-block; padding-left: 1.5rem; cursor: pointer; list-style: none; text-decoration: underline; text-decoration-thickness: max(1px, 0.0625rem); text-underline-offset: 0.15em; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; position: absolute; left: 0.1rem; top: 0.42em; width: 0.7em; height: 0.75em; background: currentColor; clip-path: polygon(0 0, 100% 50%, 0 100%); transition: transform 0.15s; }
details[open] > summary::before { transform: rotate(90deg); }
summary:hover { text-decoration-thickness: max(3px, 0.1875rem); }
details > :not(summary) { margin: 1rem 0 0; padding-left: 1.5rem; }
.quote { max-width: 40rem; margin: 2rem 0; }
.quote blockquote { margin: 0; font: 400 1.5rem/1.4 var(--sans); }
.quote blockquote p { max-width: none; margin: 0; }
.quote blockquote p + p { margin-top: 0.75rem; }
.quote figcaption { margin-top: 0.75rem; font-size: 1rem; line-height: 1.5; color: var(--muted); }
.quotes { gap: 1.5rem 2rem; margin: 2rem 0; }
.quotes > .quote { padding-top: 1rem; border-top: 1px solid var(--rule); }
.quotes blockquote { font-size: 1.25rem; line-height: 1.45; }
.flow { gap: 2.75rem; margin: 2rem 0 2.5rem; }
.flow > li { margin: 0; padding-top: 3.25rem; font-size: 1.0625rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: var(--ink); color: var(--paper); font: 700 1.0625rem/1 var(--sans); font-variant-numeric: tabular-nums lining-nums; }
.flow > li + li::before { top: 0.625rem; left: -2.2rem; }
.flow strong { margin-bottom: 0.25rem; font: 700 1.1875rem/1.3 var(--sans); }
.flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.flow .tag, .flow .status { margin-top: 0.6rem; }
.diagram svg { color: var(--ink); }
.diagram .node { fill: var(--paper); stroke: var(--ink); stroke-width: 2; }
.diagram rect.node { rx: 0; }
.diagram .node.key { fill: var(--accent); stroke: var(--ink); }
.diagram .edge { stroke: var(--ink); stroke-width: 2; }
.diagram .head { fill: var(--ink); }
.diagram .label { fill: var(--ink); font: 400 15px var(--sans); }
.diagram .label.on-key { fill: var(--on-accent); font-weight: 700; }
.diagram .label.small { fill: var(--muted); font: 400 13px var(--sans); }
.diagram figcaption, .shot figcaption > p:first-child { max-width: 40rem; font-size: 1rem; line-height: 1.5; color: var(--muted); }
.shot .screen { border: 1px solid var(--rule); }
.pin, .pins > li::before { width: 2rem; height: 2rem; background: var(--pin); color: var(--on-pin); font: 700 1rem/1 var(--sans); box-shadow: 0 0 0 2px var(--on-pin); }
.pin { margin: -1rem 0 0 -1rem; }
.pins { margin: 1.25rem 0 0; }
.pins > li { min-height: 2rem; padding-left: 2.9rem; font-size: 1.0625rem; line-height: 1.5; }
.pins > li::before { left: 2px; top: 0; }
.tally { --tally: var(--ink); --tally-off: var(--rule); }
@media (max-width: 48rem) {
  body { font-size: 1.125rem; }
  section { margin-top: 2.5rem; padding-top: 2rem; }
  h2 { font-size: 1.625rem; line-height: 1.2; }
  h3 { font-size: 1.3125rem; }
  .lead { font-size: 1.25rem; }
  .lines { grid-template-columns: minmax(0, 1fr) auto; }
  .facts { grid-template-columns: minmax(0, 1fr); }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.2rem; }
  .figure strong { font-size: 2.5rem; }
  .timeline > li { padding-left: 3.5rem; padding-right: 0.75rem; }
  .timeline > li[aria-current] { background-position: 2.85rem 0; background-size: calc(100% - 2.85rem) calc(100% - 1.5rem); }
  .pages a { grid-template-columns: minmax(0, 1fr); }
  .pages a .tag, .pages a .status { grid-column: 1; grid-row: auto; justify-self: start; margin-top: 0.6rem; }
  .flow { gap: 2.4rem; }
  .flow > li { min-height: 2.25rem; padding: 0.3rem 0 0 3.25rem; }
  .flow > li + li::before { top: -1.9rem; left: 0.325rem; }
  .quote blockquote { font-size: 1.25rem; }
  .quotes blockquote { font-size: 1.1875rem; }
}
@media (prefers-reduced-motion: reduce) { .pages a, summary::before { transition: none; } }
@media print {
  body { font-size: 12pt; }
  .page { max-width: none; padding: 0; }
  section { break-inside: auto; }
  .figure, .status, .tag, .timeline > li::before, .timeline > li::after, .timeline > li[aria-current], .flow > li::after, .callout { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export const CLEAR: HouseStyle = {
  id: "clear",
  name: "Clear",
  summary: "Plain public-service pages: big bold headings, near-black text on white, underlined links that turn yellow on focus, and blocks readers already know how to use: a numbered step list, summary lists, a task list of pages, tags that name their state, and warning text.",
  best_for: "Pages many people must trust and act on: a release plan, a decision, scope and status for stakeholders outside the team, read on any screen and with assistive technology.",
  character: "White ground, near-black text, one grey for secondary text and rules, and one yellow kept for focus, selection and marked words. Green means done or evidence, red means caution, grey means open. Dark is a deep neutral ground with off-white text, lifted green and red, and the same yellow. Public Sans throughout: bold headings, a 19px regular body, sentence case everywhere.",
  signature: [
    "A focused link turns yellow with a thick dark bar beneath it; selection and marked words use the same yellow",
    "The plan as a numbered step list joined by a line: done steps ticked in green, the current step filled and highlighted, planned steps hollow",
    "Pages beneath as a task list: bold underlined titles, a line on what each holds, a tag at the right, a rule between rows",
    "Facts and lines as summary lists: a bold key column and a rule under every row",
    "Caution as warning text: bold words beside a filled circle with an exclamation mark cut out of it",
    "The lead figure in a solid green panel with white text",
  ],
  avoid: [
    "Decoration: gradients, shadows, rounded cards, coloured headings, icons that carry nothing",
    "Yellow for anything but focus, selection, marked words and the key node of a diagram",
    "Blue or coloured links: links are the text colour, underlined",
    "Capitals for labels or headings: everything is sentence case",
    "A state shown by colour alone: every tag and status names its state in words",
  ],
  rules: `# Clear\n\nPlain public-service pages: big bold type, near-black on white, one yellow for focus.\n\n${rule([
    "Write plain words in sentence case. The h1 states the conclusion and each h2 says what its section shows. Use data-label only for a date, a release or a stage, never to number sections.",
    "Colours are states. Green (status evidence, a done milestone) means done or backed by evidence; red (status caution) means read with care; grey (status open) means not yet known. The text of every status names its state.",
    "Yellow is reserved for focus, selection, mark around the few words that matter (once or twice a page) and the one key node of a diagram (node key). Never use it to decorate.",
    "Use the blocks as readers know them: ol.timeline for the plan (data-state=\"done\" for reached milestones, aria-current=\"step\" on the current one), nav.pages as the task list of pages beneath, dl.facts for scope and measures, ul.lines for one line per feature or risk.",
    "Put what changes how the page should be read in aside.callout data-tone=\"caution\", its status in the first words: it shows as bold warning text. Use a plain aside.callout for a neutral aside, and the first .figure for the number that matters most: it sits in the green panel.",
    "Add nothing decorative: no coloured headings, no icons, no images that do not carry content.",
  ])}\n`,
  stylesheet: CSS,
};
