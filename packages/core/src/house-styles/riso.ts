import { BASE, faces, rule, schemes, svgUrl, type HouseStyle } from "./kit.ts";

/** Ink grain: speckles where the drum left the paper bare. Light speckles on light paper, dark on dark. */
const grain = (rgb: string, strength: number) =>
  svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${rgb} 0 0 0 0 ${rgb} 0 0 0 0 ${rgb} ${strength} 0 0 0 ${(-strength * 0.68).toFixed(2)}'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);

/**
 * Riso: a Story printed on a risograph in two inks, fluorescent pink and blue. Blocks carry the
 * grain of the drum, headings print a little out of register, where pink and blue overlap they
 * make a third colour, and a halftone does the work of grey. Natural paper in light; the same inks
 * on black stock in dark. Bricolage Grotesque throughout.
 */
const CSS = `${schemes(
  {
    "--paper": "#f8f7f3", "--ink": "#2a4a9f", "--muted": "#4a62a6", "--rule": "#bcc6df", "--blue": "#2a4a9f", "--pink": "#ff4fa3", "--over": "#2a1a6a",
    "--on-blue": "#f8f7f3", "--tint-pink": "#fdd5e8", "--tint-blue": "#dfe5f2", "--misreg": "rgba(255, 79, 163, 0.85)", "--grain": grain("1", 7), "--blend": "multiply",
    "--accent": "#ff4fa3", "--on-accent": "#2a1a6a", "--focus": "#ff4fa3", "--select": "#ff4fa3", "--on-select": "#2a1a6a",
    "--ok": "#2a4a9f", "--caution": "#ff4fa3", "--open": "#4a62a6", "--mark": "#ffb0d6",
  },
  {
    "--paper": "#13161f", "--ink": "#eef0f7", "--muted": "#aeb8d4", "--rule": "#2d3550", "--blue": "#7da7ff", "--pink": "#ff5fb4", "--over": "#1c0d2e",
    "--on-blue": "#13161f", "--tint-pink": "#3b1d33", "--tint-blue": "#1c2742", "--misreg": "rgba(255, 95, 180, 0.8)", "--grain": grain("0", 7), "--blend": "screen",
    "--accent": "#ff5fb4", "--on-accent": "#1c0d2e", "--focus": "#ff5fb4", "--select": "#ff5fb4", "--on-select": "#1c0d2e",
    "--ok": "#7da7ff", "--caution": "#ff5fb4", "--open": "#aeb8d4", "--mark": "#ff5fb4",
  },
)}${faces({ sans: '"Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif' })}${BASE}
:root { --halftone: radial-gradient(circle, var(--blue) 30%, transparent 33%) 0 0 / 8px 8px; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
.page { max-width: 74rem; margin: 0 auto; padding: 0 clamp(1rem, 4vw, 3rem) 5rem; overflow-x: clip; }
.opening { position: relative; isolation: isolate; display: grid; gap: 1.25rem; margin-bottom: 4rem; padding: clamp(3rem, 9vw, 6.5rem) 0 clamp(2rem, 5vw, 3.5rem); }
.opening::before { content: ""; position: absolute; z-index: -1; right: clamp(-3rem, -2vw, 0rem); top: clamp(1rem, 4vw, 2.5rem); width: clamp(11rem, 34vw, 26rem); aspect-ratio: 1; border-radius: 50%; background: var(--grain), var(--pink); mix-blend-mode: var(--blend); }
.opening::after { content: ""; position: absolute; z-index: -1; right: clamp(4rem, 16vw, 13rem); top: clamp(5rem, 14vw, 11rem); width: clamp(8rem, 22vw, 17rem); aspect-ratio: 1.3; background: var(--halftone); mix-blend-mode: var(--blend); -webkit-mask: linear-gradient(115deg, transparent 8%, #000 60%); mask: linear-gradient(115deg, transparent 8%, #000 60%); }
.opening > * { margin: 0; }
.kicker { font: 700 0.875rem/1.2 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--pink); }
h1, h2 { text-shadow: 0.055em 0.045em 0 var(--misreg); }
h1 { max-width: 14ch; font: 800 clamp(2.8rem, 7.2vw, 5.9rem)/0.94 var(--sans); letter-spacing: -0.035em; color: var(--blue); }
.lead { max-width: 36rem; font-size: clamp(1.15rem, 1.9vw, 1.35rem); line-height: 1.5; }
.opening .meta { justify-self: start; padding: 0.4rem 0.75rem; border: 2px solid var(--pink); border-radius: 0.3rem; font: 700 0.75rem/1.5 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; transform: rotate(-1.5deg); }
section { margin-top: 4.5rem; }
section > h2 { max-width: 24ch; margin: 0 0 1.4rem; font: 800 clamp(1.8rem, 3.5vw, 2.8rem)/1.04 var(--sans); letter-spacing: -0.03em; color: var(--blue); }
h2[data-label]::before { content: attr(data-label); display: table; margin-bottom: 1rem; padding: 0.3rem 0.65rem 0.32rem; background: var(--grain), var(--pink); color: var(--over); font: 700 0.8125rem/1.15 var(--sans); letter-spacing: 0.07em; text-transform: uppercase; text-shadow: none; transform: rotate(-1.5deg); }
h3 { margin: 1.5rem 0 0.45rem; font: 800 1.3rem/1.2 var(--sans); letter-spacing: -0.015em; }
p, ul, ol { max-width: 40rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.2rem; }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--pink); text-decoration-thickness: 0.15em; text-underline-offset: 0.18em; }
a:hover { background: var(--tint-pink); }
mark { background: var(--mark); color: var(--over); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1.25rem; margin: 2rem 0 1.5rem; }
.figure { margin: 0; padding: 1.3rem 1.4rem 1.5rem; background: var(--grain), var(--pink); color: var(--over); font: 500 0.9375rem/1.45 var(--sans); }
.figure:nth-child(3n+2) { background: var(--grain), var(--blue); color: var(--on-blue); }
.figure:nth-child(3n) { position: relative; padding: 1.3rem 2rem 2.1rem 1.4rem; background: linear-gradient(var(--paper), var(--paper)) 0 0 / calc(100% - 0.6rem) calc(100% - 0.6rem) no-repeat, var(--halftone); color: var(--ink); }
.figure:nth-child(3n)::after { content: ""; position: absolute; inset: 0 0.6rem 0.6rem 0; border: 2px solid var(--blue); pointer-events: none; }
.figure strong { display: block; margin-bottom: 0.55rem; font: 800 clamp(2.6rem, 5vw, 3.9rem)/0.95 var(--sans); letter-spacing: -0.035em; font-variant-numeric: lining-nums; }
.note { max-width: 40rem; margin: 1.5rem 0; padding: 0.9rem 1.15rem; background: var(--tint-blue); font-size: 0.9375rem; }
.callout { max-width: 44rem; margin: 2rem 0; padding: 1.2rem 1.4rem; background: var(--tint-blue); }
.callout[data-tone="caution"] { background: var(--grain), var(--pink); color: var(--over); box-shadow: 0.45rem 0.45rem 0 var(--blue); }
.callout a { color: inherit; }
.callout > :last-child { margin-bottom: 0; }
.status { display: inline-block; padding: 0.22em 0.55em 0.24em; border: 1.5px solid var(--blue); border-radius: 0.25rem; background: var(--blue); color: var(--on-blue); font: 700 0.6875rem/1.2 var(--sans); letter-spacing: 0.07em; text-transform: uppercase; vertical-align: 0.12em; }
.status[data-state="caution"] { border-color: var(--pink); background: var(--pink); color: var(--over); }
.status[data-state="open"] { background: transparent; color: var(--blue); }
.tag { display: inline-block; padding: 0.2em 0.5em 0.24em; border-radius: 0.2rem; background: var(--tint-pink); color: var(--ink); font: 700 0.75rem/1.25 var(--sans); }
.timeline { gap: 0; margin: 2.25rem 0 2.5rem; }
.timeline > li { padding: 1.1rem 1.25rem 1.35rem; background: var(--tint-blue); }
.timeline > li[data-state="done"] { background: var(--grain), var(--blue); color: var(--on-blue); }
.timeline > li[aria-current] { position: relative; z-index: 1; background: var(--grain), var(--pink); color: var(--over); box-shadow: 0.4rem 0.4rem 0 var(--blue); transform: translateY(-0.4rem); }
.timeline > li[aria-current] ~ li { background: radial-gradient(circle, var(--rule) 28%, transparent 32%) 0 0 / 7px 7px, var(--paper); box-shadow: inset 0 0 0 2px var(--rule); }
.timeline time { margin-bottom: 1.1rem; font: 700 0.8125rem/1.2 var(--sans); letter-spacing: 0.07em; text-transform: uppercase; }
.timeline strong { margin-bottom: 0.35rem; font: 800 1.3rem/1.1 var(--sans); letter-spacing: -0.02em; }
.timeline p { font-size: 0.9375rem; line-height: 1.45; }
.timeline > li:not([data-state]):not([aria-current]) strong, .timeline > li:not([data-state]):not([aria-current]) p { background: var(--paper); box-shadow: 0 0 0 0.15em var(--paper); }
.lines { margin: 1.5rem 0 2rem; border-top: 3px solid var(--blue); font-size: 0.9375rem; line-height: 1.45; }
.lines > li { padding: 0.85rem 0; border-bottom: 1.5px solid var(--rule); }
.lines strong { font: 800 1.0625rem/1.3 var(--sans); }
.facts { margin: 1.5rem 0 2rem; border-top: 3px solid var(--blue); }
.facts dt, .facts dd { padding: 0.85rem 0; border-bottom: 1.5px solid var(--rule); }
.facts dt { font: 800 0.8125rem/1.9 var(--sans); letter-spacing: 0.06em; text-transform: uppercase; }
.pages { margin: 1.75rem 0.5rem 1rem 0; }
.pages ul { gap: 1.5rem; }
.pages a { position: relative; padding: 1.25rem 3.25rem 1.35rem 1.3rem; border: 2px solid var(--blue); background: var(--paper); box-shadow: 0.5rem 0.5rem 0 var(--pink); transition: box-shadow 0.2s, transform 0.2s; }
.pages a::after { content: ""; position: absolute; right: 1.1rem; top: 1.25rem; width: 1.4rem; height: 1.4rem; background: var(--blue); -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; }
.pages a:hover { transform: translate(0.25rem, 0.25rem); box-shadow: 0.2rem 0.2rem 0 var(--pink); }
.pages a strong { margin-bottom: 0.4rem; font: 800 1.35rem/1.1 var(--sans); letter-spacing: -0.02em; color: var(--blue); }
.pages a span:not(.tag) { font-size: 0.9375rem; line-height: 1.45; }
.pages a .tag { margin-top: 0.85rem; }
.flow { gap: 2.75rem; margin: 2rem 0 2.5rem; }
.flow > li { padding: 3.9rem 1.15rem 1.25rem; background: var(--tint-blue); font-size: 0.9375rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); position: absolute; left: 1rem; top: 0.6rem; font: 800 2.6rem/1 var(--sans); color: var(--pink); text-shadow: -0.05em -0.04em 0 var(--blue); mix-blend-mode: var(--blend); }
.flow > li + li::before { top: 1.6rem; left: -2.35rem; width: 2rem; height: 1.2rem; background: var(--pink); }
.flow strong { margin-bottom: 0.3rem; font: 800 1.0625rem/1.25 var(--sans); }
.flow .tag { margin-top: 0.7rem; }
.diagram { margin: 2rem 0; }
.diagram svg { color: var(--blue); }
.diagram .node { fill: var(--paper); stroke: var(--blue); stroke-width: 2.25; }
.diagram rect.node { rx: 4px; }
.diagram .node.key { fill: var(--pink); stroke: var(--pink); }
.diagram path.node { fill: var(--tint-blue); }
.diagram .label { fill: var(--blue); font: 700 15px var(--sans); }
.diagram .label.on-key { fill: var(--over); }
.diagram .label.small { fill: var(--pink); font: 700 12.5px var(--sans); }
.diagram .edge { stroke: var(--blue); stroke-width: 2.25; }
.diagram .head { fill: var(--blue); }
.diagram figcaption, .shot figcaption > p:first-child { font-size: 0.875rem; color: var(--muted); }
.shot { margin: 2.5rem 0 2rem; }
.shot .screen { padding: 0.45rem; border-radius: 2.2rem; background: var(--blue); box-shadow: 0.8rem 0.8rem 0 var(--pink); }
.shot .screen > svg, .shot .screen > img { border-radius: 1.8rem; }
.pin, .pins > li::before { width: 2rem; height: 2rem; background: var(--pink); color: #2a1a6a; font: 800 1rem/1 var(--sans); }
.pin { margin: -1rem 0 0 -1rem; box-shadow: 0.15rem 0.15rem 0 #2a4a9f; }
.pins > li { padding-left: 3rem; font-size: 0.9375rem; }
.pins > li::before { top: -0.15rem; }
.quote { margin: 2rem 0; }
.quote blockquote { margin: 0; font: 600 clamp(1.25rem, 2.2vw, 1.6rem)/1.35 var(--sans); letter-spacing: -0.015em; }
.quote blockquote p { max-width: none; margin: 0; }
.quote blockquote::before { content: "\\201C"; display: block; height: 0.5em; font: 800 4rem/1 var(--sans); color: var(--pink); text-shadow: 0.05em 0.04em 0 var(--blue); }
.quote figcaption { margin-top: 0.9rem; font: 700 0.8125rem/1.45 var(--sans); color: var(--muted); }
.quotes { gap: 1.25rem; }
.quotes .quote { display: flex; flex-direction: column; justify-content: space-between; padding: 1.2rem 1.3rem 1.15rem; background: var(--tint-pink); }
.quotes .quote:nth-child(even) { background: var(--tint-blue); }
.quotes blockquote { font-size: 1.15rem; line-height: 1.45; }
.tally { --tally: var(--pink); --tally-off: var(--tint-blue); }
.figure:nth-child(3n+1) .tally, .callout[data-tone="caution"] .tally, .timeline > li[aria-current] .tally { --tally: var(--over); --tally-off: color-mix(in srgb, var(--over) 25%, transparent); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.5rem; margin: 1.75rem 0.5rem 1.75rem 0; }
.columns > * { padding: 1.25rem 1.4rem 1.4rem; border: 2px solid var(--blue); box-shadow: 0.45rem 0.45rem 0 var(--tint-pink); }
.columns h3 { margin-top: 0; color: var(--blue); }
.columns > * > :last-child { margin-bottom: 0; }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding-bottom: 0.65rem; font: 800 1.2rem/1.3 var(--sans); color: var(--blue); }
th, td { padding: 0.75rem 0.9rem; }
thead th { background: var(--grain), var(--blue); color: var(--on-blue); font: 700 0.75rem/1.4 var(--sans); letter-spacing: 0.07em; text-transform: uppercase; }
tbody th, tbody td { border-bottom: 1.5px solid var(--rule); }
tbody th { font-weight: 800; }
.steps { counter-reset: step; list-style: none; padding: 0; }
.steps li { position: relative; counter-increment: step; padding: 1rem 0 1rem 3.4rem; border-top: 1.5px solid var(--rule); }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 0.8rem; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: var(--grain), var(--pink); color: var(--over); font: 800 1.05rem/1 var(--sans); }
details { max-width: 40rem; margin-top: 1.5rem; padding: 0.9rem 0; border-top: 3px solid var(--blue); }
summary { display: flex; align-items: center; gap: 0.65rem; cursor: pointer; font-weight: 800; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; width: 0.85rem; height: 0.85rem; border-radius: 50%; background: var(--pink); box-shadow: 0.12rem 0.12rem 0 var(--blue); }
details[open] summary::before { border-radius: 0; }
details > :last-child { margin-bottom: 0; }
@media (max-width: 48rem) {
  .opening::before { opacity: 0.75; }
  .timeline > li[aria-current] { transform: none; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.1rem; }
}
@media (prefers-reduced-motion: reduce) { .pages a { transition: none; } }
@media print { .figure, .callout, .timeline > li, thead th, .steps li::before, h2[data-label]::before { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

export const RISO: HouseStyle = {
  id: "riso",
  name: "Riso",
  summary: "A risograph print in two inks, fluorescent pink and blue: grainy blocks, headings a little out of register, a third colour where the inks overlap, and halftone for grey.",
  best_for: "Stories with personality for audiences who will share them: a product's direction, a launch plan, the voices behind it.",
  character: "Lively, tactile, a little imperfect on purpose. Two inks on natural paper; on black stock in dark. Bricolage Grotesque throughout.",
  signature: ["A pink disc and a halftone overprinting behind the opening", "Headings printed slightly out of register in pink", "Grainy ink blocks for figures, labels and the current milestone", "Pages beneath as cards with a pink offset", "Two inks only: a state is blue, pink or an outline"],
  avoid: ["A third ink: overlap makes the third colour", "Pink for text on paper: it is too light to read", "Grain or halftone behind running text", "Perfect alignment everywhere: one deliberate offset per block is the style; more is noise"],
  rules: `# Riso\n\nA Story printed in two inks.\n\n${rule([
    "There are two inks, blue and fluorescent pink. Text is blue; pink is for blocks, marks and highlights, never for text on paper.",
    "A state is a print: solid blue (evidence), solid pink (caution) or an outline (open), always named in words.",
    "Grainy blocks are for figures, labels, the current milestone and caution. Running text stays on paper.",
    "One offset per block: a pink shadow behind a card, a misregistered heading. Do not stack effects.",
    "Mockups keep their own colours; their frame is blue with a pink offset.",
  ])}\n`,
  stylesheet: CSS,
};
