import { BASE, faces, rule, schemes, type HouseStyle } from "./kit.ts";

/**
 * Blocks: a Story built from solid coloured blocks, after the neo-brutalist web. Thick black edges,
 * hard offset shadows, candy fills, pill labels, and blocks that press in when you click them.
 * Everything sits square: nothing is tilted. The blocks keep their colours in dark; the ground goes black
 * and the shadows turn light. Gabarito throughout.
 */
const CSS = `${schemes(
  {
    "--paper": "#fffdf6", "--ink": "#111111", "--muted": "#4a4a4a", "--edge": "#111111", "--shadow": "#111111", "--rule": "#111111",
    "--yellow": "#ffd23f", "--pink": "#ff9ebb", "--mint": "#5fe3b3", "--sky": "#86ccff", "--orange": "#ff9a3c", "--white": "#ffffff", "--on-block": "#111111", "--soft-on-block": "#2f2f2f",
    "--accent": "#111111", "--on-accent": "#ffd23f", "--focus": "#111111", "--select": "#ffd23f", "--on-select": "#111111",
    "--ok": "#5fe3b3", "--caution": "#ff9a3c", "--open": "#ffffff", "--mark-bg": "#111111", "--mark-fg": "#ffd23f",
  },
  {
    "--paper": "#141414", "--ink": "#f6f4ee", "--muted": "#b9b6ad", "--edge": "#111111", "--shadow": "#f6f4ee", "--rule": "#f6f4ee",
    "--yellow": "#ffd23f", "--pink": "#ff9ebb", "--mint": "#5fe3b3", "--sky": "#86ccff", "--orange": "#ff9a3c", "--white": "#ffffff", "--on-block": "#111111", "--soft-on-block": "#2f2f2f",
    "--accent": "#ffd23f", "--on-accent": "#111111", "--focus": "#ffd23f", "--select": "#ffd23f", "--on-select": "#111111",
    "--ok": "#5fe3b3", "--caution": "#ff9a3c", "--open": "#ffffff", "--mark-bg": "#ffd23f", "--mark-fg": "#111111",
  },
)}${faces({ sans: '"Gabarito", "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif' })}${BASE}
:root { --block: 3px solid var(--edge); --lift: 5px 5px 0 var(--shadow); --radius: 0.75rem; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
.page { max-width: 76rem; margin: 0 auto; padding: clamp(1rem, 3vw, 2.5rem) clamp(1rem, 4vw, 3rem) 5rem; }
.opening { display: grid; gap: 1.2rem; margin: 0 8px 4rem 0; padding: clamp(1.75rem, 5vw, 3.5rem); border: var(--block); border-radius: 1rem; background: var(--yellow); color: var(--on-block); box-shadow: 8px 8px 0 var(--shadow); }
.opening > * { margin: 0; }
.opening a { color: inherit; }
.kicker { font: 800 0.875rem/1.2 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; }
h1 { max-width: 16ch; font: 900 clamp(2.6rem, 6.6vw, 5.4rem)/0.97 var(--sans); letter-spacing: -0.035em; }
.lead { max-width: 40rem; font: 500 clamp(1.15rem, 1.9vw, 1.35rem)/1.5 var(--sans); }
.opening .meta { justify-self: start; padding: 0.4rem 0.85rem; border: 2.5px solid var(--edge); border-radius: 999px; background: var(--white); font: 700 0.8125rem/1.4 var(--sans); box-shadow: 3px 3px 0 var(--edge); }
section { margin-top: 4.5rem; }
section > h2 { max-width: 24ch; margin: 0 0 1.4rem; font: 900 clamp(1.8rem, 3.6vw, 2.8rem)/1.04 var(--sans); letter-spacing: -0.03em; }
h2[data-label]::before { content: attr(data-label); display: table; margin-bottom: 1rem; padding: 0.3rem 0.85rem 0.32rem; border: 2.5px solid var(--edge); border-radius: 999px; background: var(--pink); color: var(--on-block); font: 800 0.8125rem/1.2 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; box-shadow: 3px 3px 0 var(--shadow); }
section:nth-of-type(3n+2) > h2[data-label]::before { background: var(--sky); }
section:nth-of-type(3n) > h2[data-label]::before { background: var(--mint); }
h3 { margin: 1.5rem 0 0.45rem; font: 800 1.3rem/1.2 var(--sans); letter-spacing: -0.015em; }
p, ul, ol { max-width: 40rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.2rem; }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--pink); text-decoration-thickness: 0.2em; text-underline-offset: 0.18em; }
a:hover { background: var(--yellow); color: var(--on-block); text-decoration-color: var(--edge); }
mark { padding: 0.04em 0.28em; border-radius: 0.3em; background: var(--mark-bg); color: var(--mark-fg); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1.5rem; margin: 1.75rem 6px 1.75rem 0; }
.figure { margin: 0; padding: 1.25rem 1.4rem 1.5rem; border: var(--block); border-radius: var(--radius); background: var(--pink); color: var(--on-block); font: 600 0.9375rem/1.4 var(--sans); box-shadow: var(--lift); }
.figure:nth-child(3n+2) { background: var(--mint); }
.figure:nth-child(3n) { background: var(--sky); }
.figure strong { display: block; margin-bottom: 0.55rem; font: 900 clamp(2.6rem, 5vw, 3.8rem)/1 var(--sans); letter-spacing: -0.035em; font-variant-numeric: lining-nums; }
.note { max-width: 40rem; margin: 1.5rem 6px 1.5rem 0; padding: 0.95rem 1.2rem; border: var(--block); border-radius: var(--radius); background: var(--white); color: var(--on-block); font-size: 0.9375rem; box-shadow: 4px 4px 0 var(--shadow); }
.callout { max-width: 44rem; margin: 2rem 6px 2rem 0; padding: 1.2rem 1.4rem; border: var(--block); border-radius: var(--radius); background: var(--sky); color: var(--on-block); box-shadow: var(--lift); }
.callout[data-tone="caution"] { padding-top: 2.1rem; background: repeating-linear-gradient(90deg, var(--edge) 0 12px, var(--yellow) 12px 24px) 0 0 / 100% 0.85rem no-repeat, var(--yellow); }
.callout a { color: inherit; }
.callout > :last-child { margin-bottom: 0; }
.status { display: inline-flex; align-items: center; gap: 0.38em; padding: 0.22em 0.65em 0.24em 0.5em; border: 2px solid var(--edge); border-radius: 999px; background: var(--ok); color: var(--on-block); font: 800 0.75rem/1.2 var(--sans); vertical-align: 0.08em; }
.status::before { content: ""; width: 0.6em; height: 0.6em; border-radius: 50%; background: var(--edge); }
.status[data-state="caution"] { background: var(--caution); }
.status[data-state="caution"]::before { border-radius: 0.1em; }
.status[data-state="open"] { background: var(--open); }
.status[data-state="open"]::before { background: transparent; box-shadow: inset 0 0 0 2px var(--edge); }
.tag { display: inline-block; padding: 0.16em 0.55em 0.2em; border: 2px solid var(--edge); border-radius: 0.4rem; background: var(--sky); color: var(--on-block); font: 800 0.75rem/1.3 var(--sans); }
.timeline { position: relative; gap: 1.25rem; margin: 2.25rem 6px 2.5rem 0; }
.timeline::before { content: ""; position: absolute; left: 1rem; right: 1rem; top: 2.2rem; height: 5px; border-radius: 3px; background: var(--ink); }
.timeline > li { position: relative; padding: 1rem 1.15rem 1.25rem; border: var(--block); border-radius: var(--radius); background: var(--white); color: var(--on-block); box-shadow: var(--lift); }
.timeline > li[data-state="done"] { background: var(--mint); }
.timeline > li[aria-current] { background: var(--yellow); box-shadow: 8px 8px 0 var(--shadow); }
.timeline > li[aria-current] ~ li { border-style: dashed; box-shadow: none; }
.timeline time { margin-bottom: 0.6rem; font: 800 0.8125rem/1.2 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; }
.timeline strong { margin-bottom: 0.35rem; font: 900 1.25rem/1.12 var(--sans); letter-spacing: -0.02em; }
.timeline p { font-size: 0.9375rem; line-height: 1.45; color: var(--soft-on-block); }
.lines { margin: 1.5rem 0 2rem; border-top: 3px solid var(--rule); font-size: 0.9375rem; line-height: 1.45; }
.lines > li { padding: 0.85rem 0; border-bottom: 2px solid var(--rule); }
.lines strong { font: 800 1.0625rem/1.3 var(--sans); }
.facts { margin: 1.5rem 0 2rem; border-top: 3px solid var(--rule); }
.facts dt, .facts dd { padding: 0.85rem 0; border-bottom: 2px solid var(--rule); }
.facts dt { font: 900 1rem/1.5 var(--sans); }
.pages { margin: 1.75rem 6px 1rem 0; }
.pages ul { gap: 1.5rem; }
.pages a { position: relative; padding: 1.25rem 4rem 1.4rem 1.3rem; border: var(--block); border-radius: 0.9rem; background: var(--pink); color: var(--on-block); box-shadow: 6px 6px 0 var(--shadow); transition: transform 0.15s ease-out, box-shadow 0.15s ease-out; }
.pages li:nth-child(3n+2) a { background: var(--sky); }
.pages li:nth-child(3n) a { background: var(--mint); }
.pages a::after { content: ""; position: absolute; top: 1rem; right: 1rem; width: 2.35rem; height: 2.35rem; border: 2.5px solid var(--edge); border-radius: 50%; background: var(--white) var(--arrow) center / 1.05rem no-repeat; }
.pages a:hover { transform: translate(-2px, -2px); box-shadow: 8px 8px 0 var(--shadow); }
.pages a:active { transform: translate(4px, 4px); box-shadow: 2px 2px 0 var(--shadow); }
.pages a strong { margin-bottom: 0.4rem; font: 900 1.4rem/1.08 var(--sans); letter-spacing: -0.02em; }
.pages a span:not(.tag) { font-size: 0.9375rem; line-height: 1.45; color: var(--soft-on-block); }
.pages a .tag { margin-top: 0.9rem; background: var(--white); }
.flow { gap: 2.75rem; margin: 2rem 6px 2.5rem 0; }
.flow > li { padding: 1rem 1.1rem 1.2rem; border: var(--block); border-radius: var(--radius); background: var(--white); color: var(--on-block); font-size: 0.9375rem; line-height: 1.45; box-shadow: 4px 4px 0 var(--shadow); }
.flow > li:last-child { background: var(--yellow); }
.flow > li + li::before { top: 1.35rem; left: -2.45rem; width: 2.1rem; height: 1.5rem; background: var(--ink); }
.flow strong { margin-bottom: 0.3rem; font: 900 1.1rem/1.2 var(--sans); }
.flow > li > span:not(.tag):not(.status) { color: var(--soft-on-block); }
.flow .tag { margin-top: 0.75rem; background: var(--pink); }
.diagram { margin: 2rem 8px 2rem 0; padding: 1.5rem; border: var(--block); border-radius: 1rem; background: var(--white); color: var(--on-block); box-shadow: 6px 6px 0 var(--shadow); }
.diagram svg { margin: 0 auto; color: var(--on-block); }
.diagram .node { fill: #ffffff; stroke: #111111; stroke-width: 3; }
.diagram rect.node { rx: 10px; }
.diagram .node.key { fill: var(--yellow); stroke: #111111; }
.diagram path.node { fill: var(--sky); }
.diagram .label { fill: #111111; font: 800 15px var(--sans); }
.diagram .label.on-key { fill: #111111; }
.diagram .label.small { fill: #4a4a4a; font: 700 12.5px var(--sans); }
.diagram .edge { stroke: #111111; stroke-width: 3; stroke-linejoin: round; }
.diagram .head { fill: #111111; }
.diagram figcaption { margin-top: 1rem; font-size: 0.875rem; font-weight: 600; color: #4a4a4a; }
.shot { margin: 2.25rem 0; }
.shot .screen { padding: 0.5rem; border: var(--block); border-radius: 2.4rem; background: #111111; box-shadow: 8px 8px 0 var(--pink); }
.shot .screen > svg, .shot .screen > img { border-radius: 1.8rem; }
.shot figcaption { padding: 1.25rem 1.4rem 1.4rem; border: var(--block); border-radius: var(--radius); background: var(--white); color: var(--on-block); box-shadow: var(--lift); }
.shot figcaption > p:first-child { margin-bottom: 1rem; font-weight: 700; }
.shot figcaption a { color: inherit; }
.pin, .pins > li::before { width: 2.1rem; height: 2.1rem; border: 2.5px solid #111111; background: var(--yellow); color: #111111; font: 900 1rem/1 var(--sans); }
.pin { margin: -1.05rem 0 0 -1.05rem; box-shadow: 3px 3px 0 #111111; }
.pins > li { padding-left: 3.1rem; font-size: 0.9375rem; }
.pins > li::before { top: -0.15rem; }
.quote { position: relative; margin: 2rem 6px 2.5rem 0; padding: 1.3rem 1.4rem 1.2rem; border: var(--block); border-radius: 1rem; background: var(--yellow); color: var(--on-block); box-shadow: var(--lift); }
.quote blockquote { margin: 0; font: 700 1.15rem/1.45 var(--sans); }
.quote blockquote p { max-width: none; margin: 0; }
.quote figcaption { margin-top: 0.9rem; font: 700 0.8125rem/1.4 var(--sans); color: var(--soft-on-block); }
.quote a { color: inherit; }
.quote mark { background: #111111; color: #ffffff; }
.quotes { gap: 1.5rem; margin: 2rem 6px 2.5rem 0; }
.quotes .quote { display: flex; flex-direction: column; justify-content: space-between; margin: 0; }
.quotes .quote:nth-child(3n+2) { background: var(--pink); }
.quotes .quote:nth-child(3n) { background: var(--sky); }
.tally { --tally: var(--ink); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.5rem; margin: 1.75rem 6px 1.75rem 0; }
.columns > * { padding: 1.25rem 1.4rem 1.4rem; border: var(--block); border-radius: var(--radius); background: var(--mint); color: var(--on-block); box-shadow: var(--lift); }
.columns > :nth-child(even) { background: var(--white); }
.columns h3 { margin-top: 0; }
.columns > * > :last-child { margin-bottom: 0; }
.table-wrap { margin-right: 6px; border: var(--block); border-radius: var(--radius); background: var(--white); color: var(--on-block); box-shadow: var(--lift); }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding: 1rem 1rem 0.6rem; font: 900 1.2rem/1.3 var(--sans); letter-spacing: -0.01em; }
th, td { padding: 0.75rem 1rem; }
thead th { border-top: var(--block); border-bottom: var(--block); background: var(--yellow); font: 800 0.8125rem/1.3 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; }
tbody tr + tr > * { border-top: 2px solid #111111; }
tbody th { font-weight: 800; }
.steps { counter-reset: step; list-style: none; padding: 0; }
.steps li { position: relative; counter-increment: step; padding: 1rem 0 1rem 3.6rem; }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 0.7rem; display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 2.5px solid var(--edge); border-radius: 50%; background: var(--yellow); color: var(--on-block); font: 900 1.15rem/1 var(--sans); box-shadow: 3px 3px 0 var(--shadow); }
details { max-width: 40rem; margin-top: 1.25rem; padding: 0.9rem 0; border-top: 3px solid var(--rule); }
summary { display: flex; align-items: center; gap: 0.65rem; cursor: pointer; font-weight: 800; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: "+"; display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border: 2px solid var(--edge); border-radius: 0.4rem; background: var(--yellow); color: var(--on-block); font: 900 1rem/1 var(--sans); }
details[open] summary::before { content: "\\2212"; }
details > :last-child { margin-bottom: 0; }
@media (max-width: 48rem) {
  .timeline::before { left: 1.4rem; right: auto; top: 0; bottom: 0; width: 5px; height: auto; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.15rem; }
}
@media (prefers-reduced-motion: reduce) { .pages a { transition: none; } }
@media print { .opening, .figure, .pages a, .quote, .callout, .columns > *, .timeline > li, .flow > li, thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

export const BLOCKS: HouseStyle = {
  id: "blocks",
  name: "Blocks",
  summary: "Solid coloured blocks after the neo-brutalist web: thick black edges, hard shadows, candy fills, pill labels, and links to pages that press in when clicked. Everything sits square.",
  best_for: "Upbeat updates for wide audiences: a launch, a plan everyone should know, the few things people must remember.",
  character: "Loud, friendly, direct. Black edges and hard shadows on warm white, with yellow, pink, mint and sky blocks; in dark the blocks glow on black and the shadows turn light. Gabarito throughout.",
  signature: ["The opening as a yellow block with its meta line in a white pill", "Section labels as coloured pills", "Figures, quotations and pages as coloured blocks with hard shadows", "A plan as blocks on a rail: the current one yellow with a deeper shadow, the planned ones dashed", "A striped band across the top of a caution callout"],
  avoid: ["Tilted or rotated elements: every block, label and line sits square", "Soft shadows, gradients or glass", "Blocks for running text", "Thin weights", "More than four fills on one screen"],
  rules: `# Blocks\n\nA Story built from solid coloured blocks.\n\n${rule([
    "Blocks hold things a reader should notice: the opening, figures, quotations, links to pages, callouts. Running text and lists of like things stay on the ground, ruled.",
    "Every block has a black edge and a hard shadow; never a soft shadow.",
    "Colour a block by its kind, not at random: yellow for the opening and what is current, pink, mint and sky in turn for figures, quotations and pages.",
    "Section labels (data-label) are pills. Keep them to two or three words.",
    "Caution is a yellow block with a striped band; say the status in words.",
    "Nothing is tilted or rotated: blocks, labels and lines stay square to the page.",
  ])}\n`,
  stylesheet: CSS,
};
