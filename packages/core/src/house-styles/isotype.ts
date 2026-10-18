import { BASE, faces, rule, schemes, svgUrl, type HouseStyle } from "./kit.ts";

/** One person, the unit an Isotype chart counts in. */
const PERSON = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 20'><circle cx='6' cy='3.4' r='3'/><path d='M1.4 19.2V11C1.4 8.6 3.3 7.6 6 7.6S10.6 8.6 10.6 11V19.2Z'/></svg>`);

/**
 * Isotype: a Story told in pictorial statistics, after the picture language Otto Neurath's team made
 * for public exhibitions. Counts drawn as rows of figures, flat red, blue, ochre and green, keys
 * shaped as circle, square and triangle, and plain geometric type in capitals for labels. Light
 * paper in light; the same flat colours, lifted, on charcoal in dark. Jost throughout.
 */
const CSS = `${schemes(
  {
    "--paper": "#f4f3ee", "--ink": "#1c1c1a", "--muted": "#55554f", "--rule": "#cfcdc4", "--tint": "#e8e6de",
    "--red": "#c63a2a", "--blue": "#28588a", "--ochre": "#d99a2b", "--green": "#477a43", "--on-red": "#ffffff", "--on-blue": "#ffffff", "--on-ochre": "#1c1c1a", "--on-green": "#ffffff",
    "--accent": "#28588a", "--on-accent": "#ffffff", "--focus": "#28588a", "--select": "#d99a2b", "--on-select": "#1c1c1a",
    "--ok": "#477a43", "--caution": "#c63a2a", "--open": "#55554f", "--mark": "rgba(217, 154, 43, 0.42)",
  },
  {
    "--paper": "#1c1e22", "--ink": "#ecebe5", "--muted": "#aaa9a1", "--rule": "#3a3c42", "--tint": "#26292e",
    "--red": "#ef705f", "--blue": "#7cb0e6", "--ochre": "#f0bd5a", "--green": "#8fc787", "--on-red": "#1c1e22", "--on-blue": "#1c1e22", "--on-ochre": "#1c1e22", "--on-green": "#1c1e22",
    "--accent": "#7cb0e6", "--on-accent": "#1c1e22", "--focus": "#f0bd5a", "--select": "#f0bd5a", "--on-select": "#1c1e22",
    "--ok": "#8fc787", "--caution": "#ef705f", "--open": "#aaa9a1", "--mark": "rgba(240, 189, 90, 0.3)",
  },
)}${faces({ sans: '"Jost", Futura, "Century Gothic", "Avenir Next", sans-serif' })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
.page { max-width: 74rem; margin: 0 auto; padding: clamp(0.75rem, 2.5vw, 2rem) clamp(1rem, 4vw, 3rem) 5rem; }
.opening { display: grid; gap: 1.25rem; margin-bottom: 4rem; padding: clamp(2rem, 5.5vw, 4rem) clamp(1.5rem, 5vw, 3.75rem) clamp(2rem, 5vw, 3.25rem); background: var(--blue); color: var(--on-blue); }
.opening > * { margin: 0; }
.opening a { color: inherit; }
.kicker { font: 500 0.875rem/1.2 var(--sans); letter-spacing: 0.16em; text-transform: uppercase; }
h1 { max-width: 17ch; font: 600 clamp(2.4rem, 5.8vw, 4.6rem)/1.02 var(--sans); letter-spacing: -0.02em; }
.lead { max-width: 40rem; font-size: clamp(1.15rem, 1.9vw, 1.35rem); line-height: 1.5; }
.opening .meta { font: 500 0.8125rem/1.6 var(--sans); letter-spacing: 0.12em; text-transform: uppercase; }
section { margin-top: 4.5rem; }
section > h2 { max-width: 26ch; margin: 0 0 1.4rem; font: 600 clamp(1.65rem, 3.1vw, 2.35rem)/1.1 var(--sans); letter-spacing: -0.015em; }
h2[data-label]::before { content: attr(data-label); display: block; margin-bottom: 0.9rem; padding-left: 1.35rem; background: linear-gradient(var(--red), var(--red)) 0 0.2em / 0.8rem 0.8rem no-repeat; font: 500 0.8125rem/1.2 var(--sans); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
section:nth-of-type(4n+2) > h2[data-label]::before { background-image: linear-gradient(var(--blue), var(--blue)); }
section:nth-of-type(4n+3) > h2[data-label]::before { background-image: linear-gradient(var(--ochre), var(--ochre)); }
section:nth-of-type(4n) > h2[data-label]::before { background-image: linear-gradient(var(--green), var(--green)); }
h3 { margin: 1.5rem 0 0.45rem; font: 600 1.25rem/1.25 var(--sans); }
p, ul, ol { max-width: 40rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.2rem; }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--blue); text-decoration-thickness: 2px; text-underline-offset: 0.2em; }
a:hover { color: var(--blue); }
mark { background: var(--mark); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 2rem; margin: 2rem 0 1.5rem; }
.figure { margin: 0; font-size: 0.9375rem; line-height: 1.45; color: var(--muted); }
.figure::before { content: ""; display: block; width: 1.6rem; height: 1.6rem; margin-bottom: 1rem; border-radius: 50%; background: var(--red); }
.figure:nth-child(3n+2)::before { border-radius: 0; background: var(--blue); }
.figure:nth-child(3n)::before { width: 1.85rem; border-radius: 0; background: var(--ochre); clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.figure strong { display: block; margin-bottom: 0.5rem; font: 600 clamp(2.5rem, 4.8vw, 3.6rem)/1 var(--sans); letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: lining-nums; }
.note { max-width: 40rem; margin: 1.5rem 0; padding-left: 1.35rem; background: linear-gradient(var(--ochre), var(--ochre)) 0 0.4em / 0.7rem 0.7rem no-repeat; font-size: 0.9375rem; color: var(--muted); }
.callout { position: relative; max-width: 44rem; margin: 2rem 0; padding: 1.2rem 1.4rem; background: var(--tint); }
.callout[data-tone="caution"] { padding-left: 4rem; background: var(--ochre); color: var(--on-ochre); }
.callout[data-tone="caution"]::before { content: ""; position: absolute; left: 1.3rem; top: 1.35rem; width: 1.6rem; height: 1.4rem; background: var(--on-ochre); clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.callout a { color: inherit; }
.callout > :last-child { margin-bottom: 0; }
.status { display: inline-flex; align-items: center; gap: 0.45em; color: var(--ink); font: 500 0.75rem/1.2 var(--sans); letter-spacing: 0.1em; text-transform: uppercase; vertical-align: 0.1em; }
.status::before { content: ""; width: 0.8em; height: 0.8em; border-radius: 50%; background: var(--ok); }
.status[data-state="caution"]::before { width: 0.9em; border-radius: 0; background: var(--caution); clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.status[data-state="open"]::before { border-radius: 0; background: transparent; box-shadow: inset 0 0 0 2px var(--open); }
.tag { display: inline-block; padding: 0.3em 0.6em 0.26em; background: var(--ink); color: var(--paper); font: 500 0.6875rem/1.2 var(--sans); letter-spacing: 0.12em; text-transform: uppercase; }
.timeline { gap: 0.35rem; margin: 2rem 0 2.5rem; }
.timeline > li { padding-right: 1rem; }
.timeline > li::before { content: ""; display: block; height: 1.5rem; margin: 0 -1rem 1rem 0; background: var(--tint); }
.timeline > li[data-state="done"]::before { background: var(--green); }
.timeline > li[aria-current]::before { background: var(--red); }
.timeline > li[aria-current] ~ li::before { background: repeating-linear-gradient(90deg, var(--blue) 0 1rem, transparent 0 1.4rem); }
.timeline time { margin-bottom: 0.4rem; font: 500 0.75rem/1.3 var(--sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.timeline strong { margin-bottom: 0.3rem; font: 600 1.2rem/1.2 var(--sans); }
.timeline p { font-size: 0.9375rem; line-height: 1.45; color: var(--muted); }
.lines { margin: 1.5rem 0 2rem; border-top: 2px solid var(--ink); font-size: 0.9375rem; line-height: 1.45; }
.lines > li { padding: 0.8rem 0; border-bottom: 1px solid var(--rule); }
.lines strong { font: 600 1.0625rem/1.3 var(--sans); }
.facts { margin: 1.5rem 0 2rem; border-top: 2px solid var(--ink); }
.facts dt, .facts dd { padding: 0.8rem 0; border-bottom: 1px solid var(--rule); }
.facts dt { font: 500 0.75rem/2 var(--sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.pages { margin: 1.75rem 0 1rem; }
.pages ul { gap: 1rem; }
.pages a { position: relative; display: flex; flex-direction: column; min-height: 11.5rem; padding: 1.3rem 1.4rem 1.4rem; background: var(--blue); color: var(--on-blue); transition: background 0.2s, color 0.2s; }
.pages li:nth-child(4n+2) a { background: var(--red); color: var(--on-red); }
.pages li:nth-child(4n+3) a { background: var(--green); color: var(--on-green); }
.pages li:nth-child(4n+4) a { background: var(--ochre); color: var(--on-ochre); }
.pages a::after { content: ""; position: absolute; right: 1.3rem; bottom: 1.35rem; width: 1.5rem; height: 1.5rem; background: currentColor; -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.pages a:hover { background: var(--ink); color: var(--paper); }
.pages a:hover::after { transform: translateX(0.3rem); }
.pages a strong { margin-bottom: 0.45rem; font: 600 1.4rem/1.12 var(--sans); }
.pages a span:not(.tag) { margin-bottom: 1.25rem; font-size: 0.9375rem; line-height: 1.45; }
.pages a .tag { align-self: flex-start; margin-top: auto; background: transparent; color: inherit; box-shadow: inset 0 0 0 1.5px currentColor; }
.flow { gap: 2.75rem; margin: 2rem 0 2.5rem; }
.flow > li { padding-top: 4rem; font-size: 0.9375rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 50%; background: var(--blue); color: var(--on-blue); font: 600 1.35rem/1 var(--sans); }
.flow > li:last-child::after { background: var(--red); color: var(--on-red); }
.flow > li + li::before { top: 1rem; left: -2.4rem; width: 2.1rem; height: 1.2rem; }
.flow strong { margin-bottom: 0.3rem; font: 600 1.1rem/1.25 var(--sans); }
.flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.flow .tag { margin-top: 0.7rem; }
.diagram { margin: 2rem 0; }
.diagram svg { color: var(--ink); }
.diagram .node { fill: var(--paper); stroke: var(--ink); stroke-width: 2; }
.diagram rect.node { rx: 0; }
.diagram path.node { fill: var(--ochre); stroke: var(--ochre); }
.diagram .node.key { fill: var(--red); stroke: var(--red); }
.diagram .label { fill: var(--ink); font: 500 15px var(--sans); }
.diagram path.node + .label { fill: var(--on-ochre); }
.diagram .label.on-key { fill: var(--on-red); }
.diagram .label.small { fill: var(--muted); font: 500 13px var(--sans); }
.diagram .edge { stroke: var(--ink); stroke-width: 2.5; }
.diagram .head { fill: var(--ink); }
.diagram figcaption, .shot figcaption > p:first-child { font-size: 0.875rem; color: var(--muted); }
.shot .screen { padding: 0.45rem; border-radius: 2rem; background: var(--ink); }
.shot .screen > svg, .shot .screen > img { border-radius: 1.6rem; }
.pin, .pins > li::before { width: 2rem; height: 2rem; background: var(--red); color: var(--on-red); font: 600 1rem/1 var(--sans); }
.pin { margin: -1rem 0 0 -1rem; box-shadow: 0 0 0 2.5px #ffffff; }
.pins > li { padding-left: 3rem; font-size: 0.9375rem; }
.pins > li::before { top: -0.15rem; }
.quote { margin: 2rem 0; }
.quote blockquote { margin: 0; font: 400 clamp(1.2rem, 2.1vw, 1.5rem)/1.45 var(--sans); }
.quote blockquote p { max-width: none; margin: 0; }
.quote blockquote::before { content: "\\201C"; display: grid; place-items: center; width: 2.3rem; height: 2.3rem; margin-bottom: 1rem; padding-top: 0.55rem; border-radius: 50%; background: var(--red); color: var(--on-red); font: 600 2.4rem/1 var(--sans); }
.quote figcaption { margin-top: 0.9rem; font: 500 0.75rem/1.6 var(--sans); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.quotes { gap: 2rem; }
.quotes .quote { display: flex; flex-direction: column; justify-content: space-between; }
.quotes .quote:nth-child(3n+2) blockquote::before { border-radius: 0; background: var(--blue); color: var(--on-blue); }
.quotes .quote:nth-child(3n) blockquote::before { background: var(--green); color: var(--on-green); }
.quotes blockquote { font-size: 1.15rem; line-height: 1.5; }
.tally { aspect-ratio: var(--of, 10) / 1.6; vertical-align: -0.3em; --tally: var(--blue); --tally-off: color-mix(in srgb, var(--ink) 20%, transparent); -webkit-mask: ${PERSON} 0 0 / calc(100% / var(--of, 10)) 100% repeat-x; mask: ${PERSON} 0 0 / calc(100% / var(--of, 10)) 100% repeat-x; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; margin: 1.75rem 0; }
.columns > * { padding: 1.3rem 1.4rem 1.4rem; background: var(--tint); }
.columns h3 { margin-top: 0; padding-left: 1.4rem; background: linear-gradient(var(--blue), var(--blue)) 0 0.32em / 0.85rem 0.85rem no-repeat; }
.columns > :nth-child(even) h3 { background-image: linear-gradient(var(--ochre), var(--ochre)); }
.columns > * > :last-child { margin-bottom: 0; }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding-bottom: 0.65rem; font: 600 1.15rem/1.3 var(--sans); }
th, td { padding: 0.75rem 0.9rem; }
thead th { background: var(--blue); color: var(--on-blue); font: 500 0.75rem/1.4 var(--sans); letter-spacing: 0.12em; text-transform: uppercase; }
tbody tr:nth-child(even) { background: var(--tint); }
tbody th { font-weight: 600; }
.steps { counter-reset: step; list-style: none; padding: 0; }
.steps li { position: relative; counter-increment: step; padding: 1rem 0 1rem 3.4rem; border-top: 1px solid var(--rule); }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 0.8rem; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: var(--blue); color: var(--on-blue); font: 600 1.05rem/1 var(--sans); }
details { max-width: 40rem; margin-top: 1.5rem; padding: 0.9rem 0; border-top: 2px solid var(--ink); }
summary { display: flex; align-items: center; gap: 0.7rem; cursor: pointer; font: 600 1rem/1.4 var(--sans); list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; width: 0.7rem; height: 0.65rem; background: var(--red); clip-path: polygon(0 0, 100% 50%, 0 100%); transition: transform 0.2s; }
details[open] summary::before { transform: rotate(90deg); }
details > :last-child { margin-bottom: 0; }
@media (max-width: 48rem) {
  .timeline > li::before { margin-right: 0; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.1rem; }
}
@media (prefers-reduced-motion: reduce) { .pages a, .pages a::after, summary::before { transition: none; } }
@media print { .opening, .pages a, thead th, .timeline > li::before, .figure::before { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

export const ISOTYPE: HouseStyle = {
  id: "isotype",
  name: "Isotype",
  summary: "Pictorial statistics after Otto Neurath's picture language: counts drawn as rows of figures, flat red, blue, ochre and green, shaped keys, and plain geometric capitals for labels.",
  best_for: "Explaining evidence to people who were not in the research: how many said what, how the plan breaks down, what each part is for.",
  character: "Clear, civic, friendly. Light paper with four flat colours and black; in dark the same colours, lifted, on charcoal. Jost, a geometric sans in the spirit of Futura.",
  signature: ["Counts drawn as rows of figures (span.tally), filled for those who said it", "The opening as a flat blue title panel", "Figures keyed by a circle, a square and a triangle", "A plan as a bar: done green, current red, planned dashed blue", "Pages beneath as flat colour tiles", "Section labels keyed with a coloured square"],
  avoid: ["Shading, gradients and shadows: every colour is flat", "Pictures that are not counts: a row of figures always means a number", "More than four colours", "Lower-case labels: labels are spaced capitals"],
  rules: `# Isotype\n\nA Story told in pictorial statistics.\n\n${rule([
    "When a number counts people or things, show it as a row of figures (span.tally with --n and --of) beside the number in words. One figure is always one unit.",
    "Colours have jobs: red is what matters now, blue is the plan and links, green is done, ochre is caution and decisions. Never use them for decoration.",
    "Labels (data-label, captions, table heads) are spaced capitals; headings and text are sentence case.",
    "A plan is a bar (ol.timeline): data-state=\"done\" fills green, aria-current=\"step\" red, the rest dashed.",
    "Keep charts honest: a stated denominator, no third dimension.",
  ])}\n`,
  stylesheet: CSS,
};
