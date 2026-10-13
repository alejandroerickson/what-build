import { BASE, faces, rule, schemes, type HouseStyle } from "./kit.ts";

/**
 * Wayfinding: a Story set like a transit system's signs. The opening is a station sign, section
 * labels hang from a heavy rule like platform tabs, a plan is a route with stops, and the pages
 * beneath are direction signs with a line bullet each. Signika, a face drawn for signage,
 * throughout.
 */
const CSS = `${schemes(
  {
    "--paper": "#ffffff", "--ink": "#15181c", "--muted": "#4e5660", "--rule": "#d5dae0", "--tint": "#eef1f4",
    "--band": "#15181c", "--on-band": "#ffffff", "--on-band-soft": "#c3cad2", "--sign": "#15181c", "--on-sign": "#ffffff", "--on-sign-soft": "#b9c1ca",
    "--l1": "#00843d", "--l2": "#f2a900", "--l3": "#0067c6", "--l4": "#da291c", "--on-l1": "#ffffff", "--on-l2": "#15181c", "--on-l3": "#ffffff", "--on-l4": "#ffffff",
    "--caution-sign": "#ffd200", "--on-caution-sign": "#15181c", "--accent": "#0067c6", "--on-accent": "#ffffff",
    "--focus": "#0067c6", "--select": "#ffd200", "--on-select": "#15181c", "--ok": "#00843d", "--caution": "#c46a00", "--open": "#4e5660", "--mark": "rgba(255, 210, 0, 0.55)",
  },
  {
    "--paper": "#0e1114", "--ink": "#eef1f4", "--muted": "#a3acb6", "--rule": "#2b323a", "--tint": "#181d22",
    "--band": "#ffd200", "--on-band": "#0e1114", "--on-band-soft": "#3f3712", "--sign": "#1c2229", "--on-sign": "#eef1f4", "--on-sign-soft": "#a3acb6",
    "--l1": "#2fbf71", "--l2": "#ffb81c", "--l3": "#4c9dff", "--l4": "#ff5a4f", "--on-l1": "#0e1114", "--on-l2": "#0e1114", "--on-l3": "#0e1114", "--on-l4": "#0e1114",
    "--caution-sign": "#ffd200", "--on-caution-sign": "#0e1114", "--accent": "#6cb1ff", "--on-accent": "#0e1114",
    "--focus": "#ffd200", "--select": "#ffd200", "--on-select": "#0e1114", "--ok": "#2fbf71", "--caution": "#ffb347", "--open": "#a3acb6", "--mark": "rgba(255, 210, 0, 0.3)",
  },
)}${faces({ sans: '"Signika", "Segoe UI", "Helvetica Neue", Arial, sans-serif' })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
.page { max-width: 78rem; margin: 0 auto; padding: clamp(0.75rem, 2.5vw, 2.25rem) clamp(1rem, 4vw, 3rem) 5rem; }
.opening { position: relative; display: grid; gap: 1.1rem; margin: 0 0 3.75rem; padding: clamp(1.75rem, 4.5vw, 3.5rem) clamp(1.25rem, 4vw, 3.25rem) clamp(2.5rem, 5.5vw, 4rem); border-radius: 0.6rem; background: var(--band); color: var(--on-band); }
.opening::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 0.65rem; border-radius: 0 0 0.6rem 0.6rem; background: linear-gradient(90deg, var(--l1) 0 25%, var(--l2) 0 50%, var(--l3) 0 75%, var(--l4) 0); }
.opening > * { margin: 0; }
.opening a { color: inherit; }
.kicker { display: inline-flex; align-items: center; gap: 0.6rem; font: 700 0.875rem/1.2 var(--sans); letter-spacing: 0.06em; text-transform: uppercase; }
.kicker::before { content: ""; width: 0.9rem; height: 0.9rem; border-radius: 50%; background: var(--l1); }
h1 { max-width: 21ch; font: 700 clamp(2.3rem, 5.4vw, 4.6rem)/1.02 var(--sans); letter-spacing: -0.03em; }
.lead { max-width: 46rem; font-size: clamp(1.1rem, 1.8vw, 1.3rem); line-height: 1.5; color: var(--on-band-soft); }
.opening .meta { padding-top: 1rem; border-top: 1px solid color-mix(in srgb, var(--on-band) 22%, transparent); font-size: 0.875rem; font-weight: 600; color: var(--on-band-soft); }
section { margin-top: 4.25rem; }
section > h2 { margin: 0 0 1.25rem; padding-top: 0.85rem; border-top: 6px solid var(--ink); font: 700 clamp(1.6rem, 2.9vw, 2.3rem)/1.12 var(--sans); letter-spacing: -0.02em; }
h2[data-label]::before { content: attr(data-label); display: table; margin: -0.85rem 0 0.9rem; padding: 0.42rem 0.75rem 0.32rem; border-radius: 0 0 0.35rem 0.35rem; background: var(--ink); color: var(--paper); font: 700 0.8125rem/1 var(--sans); letter-spacing: 0.07em; text-transform: uppercase; }
h3 { margin: 1.75rem 0 0.5rem; font: 700 1.2rem/1.25 var(--sans); letter-spacing: -0.01em; }
p, ul, ol { max-width: 42rem; margin: 0 0 1em; }
section > ul:not([class]), section > ol:not([class]) { padding-left: 1.25rem; }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 2px; text-underline-offset: 0.22em; }
a:hover { color: var(--accent); }
mark { background: var(--mark); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem; margin: 1.75rem 0 1.5rem; }
.figure { margin: 0; padding: 1.15rem 1.3rem 1.3rem; border-radius: 0.6rem; background: var(--tint); font-size: 0.9375rem; line-height: 1.4; color: var(--muted); }
.figure strong { display: block; margin-bottom: 0.6rem; font: 700 clamp(2.4rem, 4.8vw, 3.5rem)/1 var(--sans); letter-spacing: -0.035em; color: var(--ink); font-variant-numeric: lining-nums; }
.note { position: relative; max-width: 42rem; margin: 1.5rem 0; padding: 0.2rem 0 0 2.75rem; font-size: 0.9375rem; color: var(--muted); }
.note::before { content: "i"; position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 1.85rem; height: 1.85rem; border-radius: 50%; background: var(--l3); color: var(--on-l3); font: 700 1.05rem/1 var(--sans); }
.callout { position: relative; max-width: 46rem; margin: 2rem 0; padding: 1.2rem 1.4rem 1.2rem 4rem; border-radius: 0.6rem; background: var(--sign); color: var(--on-sign); }
.callout::before { content: "i"; position: absolute; left: 1.2rem; top: 1.15rem; display: grid; place-items: center; width: 1.85rem; height: 1.85rem; border-radius: 50%; background: var(--on-sign); color: var(--sign); font: 700 1.05rem/1 var(--sans); }
.callout[data-tone="caution"] { background: var(--caution-sign); color: var(--on-caution-sign); }
.callout[data-tone="caution"]::before { content: "!"; width: 2.1rem; height: 1.85rem; padding-top: 0.5rem; border-radius: 0; clip-path: polygon(50% 0, 100% 100%, 0 100%); background: var(--on-caution-sign); color: var(--caution-sign); font-size: 1rem; }
.callout a { color: inherit; text-decoration-color: currentColor; }
.callout > :last-child { margin-bottom: 0; }
.status { display: inline-flex; align-items: center; gap: 0.4em; padding: 0.38em 0.65em 0.3em 0.5em; border-radius: 999px; background: var(--tint); color: var(--ink); font: 700 0.75rem/1 var(--sans); letter-spacing: 0.04em; text-transform: uppercase; vertical-align: 0.12em; }
.status::before { content: ""; flex: none; width: 0.72em; height: 0.72em; margin-top: -0.12em; border-radius: 50%; background: var(--ok); }
.status[data-state="caution"]::before { border-radius: 0; background: var(--caution); clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.status[data-state="open"]::before { background: transparent; box-shadow: inset 0 0 0 2px var(--open); }
.tag { display: inline-block; padding: 0.34em 0.55em 0.24em; border-radius: 0.3rem; background: var(--ink); color: var(--paper); font: 700 0.75rem/1.1 var(--sans); letter-spacing: 0.03em; }
.timeline { margin: 2.25rem 0 2.75rem; }
.timeline > li { position: relative; padding: 4.4rem 1.5rem 0 0; }
.timeline > li::before { content: ""; position: absolute; left: 0.8rem; right: -0.8rem; top: 2.55rem; height: 0.5rem; background: var(--l1); }
.timeline > li[aria-current]::before, .timeline > li[aria-current] ~ li::before { background: repeating-linear-gradient(90deg, var(--l1) 0 1rem, transparent 0 1.6rem); }
.timeline > li:last-child::before { display: none; }
.timeline > li::after { content: ""; position: absolute; left: 0; top: 2rem; width: 1.6rem; height: 1.6rem; border-radius: 50%; background: var(--paper); box-shadow: inset 0 0 0 0.38rem var(--l1); }
.timeline > li[data-state="done"]::after { background: var(--l1); box-shadow: inset 0 0 0 0.38rem var(--l1), inset 0 0 0 0.62rem var(--paper); }
.timeline > li[aria-current]::after { left: -0.3rem; top: 1.7rem; width: 2.2rem; height: 2.2rem; background: var(--ink); box-shadow: 0 0 0 0.3rem var(--paper), 0 0 0 0.6rem var(--l1); }
.timeline time { position: absolute; left: 0; top: 0; font: 700 0.8125rem/1.2 var(--sans); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.timeline > li[aria-current] time { padding: 0.32em 0.5em 0.22em; margin-top: -0.32em; border-radius: 0.3rem; background: var(--ink); color: var(--paper); }
.timeline strong { margin-bottom: 0.35rem; font: 700 1.2rem/1.2 var(--sans); letter-spacing: -0.01em; }
.timeline p { font-size: 0.9375rem; line-height: 1.45; color: var(--muted); }
.lines { margin: 1.5rem 0 2rem; border-top: 3px solid var(--ink); font-size: 0.9375rem; line-height: 1.45; }
.lines > li { padding: 0.85rem 0; border-bottom: 1px solid var(--rule); }
.lines strong { font-weight: 700; font-size: 1.0625rem; }
.facts { margin: 1.5rem 0 2rem; border-top: 6px solid var(--ink); }
.facts dt, .facts dd { padding: 0.85rem 0; border-bottom: 1px solid var(--rule); }
.facts dt { font: 700 0.8125rem/1.9 var(--sans); letter-spacing: 0.05em; text-transform: uppercase; }
.pages { margin: 1.5rem 0 1rem; }
.pages ul { gap: 1rem; counter-reset: line; }
.pages li { counter-increment: line; }
.pages a { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); align-content: start; column-gap: 1rem; row-gap: 0.35rem; padding: 1.15rem 3.75rem 1.3rem 1.15rem; border-radius: 0.6rem; background: var(--sign); color: var(--on-sign); transition: background 0.2s; }
.pages a::before { content: counter(line); grid-row: 1 / span 3; display: grid; place-items: center; width: 2.35rem; height: 2.35rem; border-radius: 50%; background: var(--l1); color: var(--on-l1); font: 700 1.15rem/1 var(--sans); }
.pages li:nth-child(4n+2) a::before { background: var(--l2); color: var(--on-l2); }
.pages li:nth-child(4n+3) a::before { background: var(--l3); color: var(--on-l3); }
.pages li:nth-child(4n+4) a::before { background: var(--l4); color: var(--on-l4); }
.pages a::after { content: ""; position: absolute; right: 1.15rem; top: 1.45rem; width: 1.6rem; height: 1.6rem; background: currentColor; -webkit-mask: var(--arrow) center / contain no-repeat; mask: var(--arrow) center / contain no-repeat; transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.pages a:hover::after { transform: translateX(0.3rem); }
.pages a strong { grid-column: 2; margin-top: 0.3rem; font: 700 1.25rem/1.15 var(--sans); letter-spacing: -0.01em; }
.pages a span { grid-column: 2; font-size: 0.9375rem; line-height: 1.45; color: var(--on-sign-soft); }
.pages a .tag { justify-self: start; margin-top: 0.5rem; background: color-mix(in srgb, var(--on-sign) 16%, transparent); color: var(--on-sign); }
.flow { gap: 2.9rem; margin: 2rem 0 2.5rem; }
.flow > li { padding: 3.6rem 1.1rem 1.2rem; border-radius: 0.6rem; background: var(--tint); font-size: 0.9375rem; line-height: 1.45; }
.flow > li::after { content: counter(flow); position: absolute; left: 1.1rem; top: 1rem; display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border-radius: 50%; background: var(--ink); color: var(--paper); font: 700 0.9375rem/1 var(--sans); }
.flow > li + li::before { top: 1.45rem; left: -2.45rem; width: 2rem; height: 1.25rem; background: var(--ink); }
.flow strong { margin-bottom: 0.3rem; font: 700 1.0625rem/1.25 var(--sans); }
.flow > li > span:not(.tag):not(.status) { color: var(--muted); }
.flow .tag { margin-top: 0.75rem; }
.diagram { padding: 1.5rem 0 0.5rem; }
.diagram svg { color: var(--ink); }
.diagram .node { fill: var(--paper); stroke: var(--ink); stroke-width: 2.5; }
.diagram rect.node { rx: 10px; }
.diagram .node.key { fill: var(--caution-sign); stroke: var(--ink); }
.diagram .label { fill: var(--ink); font: 700 15px var(--sans); }
.diagram .label.on-key { fill: var(--on-caution-sign); }
.diagram .label.small { fill: var(--muted); font: 600 12.5px var(--sans); }
.diagram .edge { stroke: var(--l1); stroke-width: 3.5; stroke-linejoin: round; }
.diagram .head { fill: var(--l1); }
.diagram figcaption, .shot figcaption > p:first-child { font-size: 0.875rem; color: var(--muted); }
.shot .screen { padding: 0.55rem; border-radius: 2.3rem; background: var(--sign); box-shadow: 0 0 0 1px var(--rule); }
.shot .screen > svg, .shot .screen > img { border-radius: 1.8rem; }
.pin, .pins > li::before { width: 2rem; height: 2rem; background: var(--caution-sign); color: #15181c; font: 700 0.9375rem/1 var(--sans); box-shadow: 0 0 0 2.5px #15181c; }
.pin { margin: -1rem 0 0 -1rem; }
.pins > li { padding-left: 3rem; font-size: 0.9375rem; }
.pins > li::before { top: -0.1rem; left: 0.15rem; }
.quote { margin: 2rem 0; }
.quote blockquote { margin: 0; font: 700 clamp(1.3rem, 2.4vw, 1.8rem)/1.3 var(--sans); letter-spacing: -0.015em; }
.quote blockquote p { max-width: none; margin: 0; }
.quote figcaption { margin-top: 0.9rem; font-size: 0.8125rem; font-weight: 600; color: var(--muted); }
.quotes .quote { display: flex; flex-direction: column; justify-content: space-between; padding: 1.3rem 1.3rem 1.15rem; border-radius: 0.6rem; background: var(--tint); }
.quotes blockquote { font-size: 1.1875rem; line-height: 1.4; }
.quotes blockquote::before { content: ""; display: block; width: 2.1rem; height: 0.4rem; margin-bottom: 1rem; background: var(--l3); }
.quotes .quote:nth-child(4n+2) blockquote::before { background: var(--l2); }
.quotes .quote:nth-child(4n+3) blockquote::before { background: var(--l4); }
.quotes .quote:nth-child(4n+4) blockquote::before { background: var(--l1); }
.tally { --tally: var(--l3); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.columns > * { padding: 1.25rem 1.4rem 1.35rem; border: 2.5px solid var(--ink); border-radius: 0.6rem; }
.columns h3 { margin-top: 0; }
.columns > * > :last-child { margin-bottom: 0; }
table { font-size: 0.9375rem; line-height: 1.45; }
caption { padding-bottom: 0.7rem; font: 700 1.125rem/1.3 var(--sans); }
th, td { padding: 0.75rem 0.9rem; }
thead th { background: var(--ink); color: var(--paper); font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
thead th:first-child { border-radius: 0.4rem 0 0 0.4rem; }
thead th:last-child { border-radius: 0 0.4rem 0.4rem 0; }
tbody th, tbody td { border-bottom: 1px solid var(--rule); }
tbody th { font-weight: 700; }
.steps { counter-reset: step; list-style: none; padding: 0; }
.steps li { position: relative; counter-increment: step; padding: 0.95rem 0 0.95rem 3.3rem; border-top: 1px solid var(--rule); }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 0.8rem; display: grid; place-items: center; width: 2.1rem; height: 2.1rem; border-radius: 50%; background: var(--ink); color: var(--paper); font: 700 1rem/1 var(--sans); }
details { max-width: 42rem; margin-top: 1.5rem; padding: 0.9rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
summary { display: flex; align-items: center; gap: 0.7rem; cursor: pointer; font-weight: 700; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; width: 0.55rem; height: 0.55rem; margin: 0 0.15rem; border-right: 3px solid currentColor; border-bottom: 3px solid currentColor; transform: rotate(-45deg); transition: transform 0.2s; }
details[open] summary::before { transform: rotate(45deg); }
details > :last-child { margin-bottom: 0; }
@media (max-width: 48rem) {
  .opening { border-radius: 0.5rem; }
  .timeline { padding-left: 0.4rem; }
  .timeline > li { padding: 0 0 1.75rem 3.1rem; }
  .timeline > li::before { left: 0.55rem; right: auto; top: 1.6rem; bottom: -0.2rem; width: 0.5rem; height: auto; }
  .timeline > li[aria-current]::before, .timeline > li[aria-current] ~ li::before { background: repeating-linear-gradient(180deg, var(--l1) 0 0.8rem, transparent 0 1.3rem); }
  .timeline > li::after { top: 0; }
  .timeline > li[aria-current]::after { top: -0.3rem; }
  .timeline time { position: static; display: inline-block; margin-bottom: 0.45rem; }
  .timeline > li[aria-current] time { margin-top: 0; }
  .facts dt { padding-bottom: 0; border-bottom: 0; }
  .facts dd { padding-top: 0.2rem; }
}
@media (prefers-reduced-motion: reduce) { .pages a::after, summary::before { transition: none; } }
`;

export const WAYFINDING: HouseStyle = {
  id: "wayfinding",
  name: "Wayfinding",
  summary: "A transit system's signs: a station-sign opening, section labels hanging from a heavy rule, a plan drawn as a route with stops, and pages as direction signs.",
  best_for: "Release plans and roadmaps for people outside the team: where we are, what comes next, and which page to read for each part.",
  character: "Clear, direct, civic. White and sign-black in light, sign-yellow on night black in dark, with four line colours that each mean one route. Signika, a face drawn for signs, throughout.",
  signature: ["The opening as a station sign, with the line colours along its foot", "A section label as a tab hanging from a six-pixel rule", "A timeline drawn as a route: stops passed, the current stop ringed, the line dashed where it is still planned", "Pages beneath as direction signs, each with a numbered line bullet and an arrow", "Statuses as a mark and a word: a dot, a triangle or a ring"],
  avoid: ["Line colours used for decoration rather than to tell routes apart", "Long paragraphs on a sign panel", "Thin type: signs are set in bold weights", "More than four routes on one page"],
  rules: `# Wayfinding\n\nA Story set like a transit system's signs.\n\n${rule([
    "The opening is the station sign: the conclusion as h1, a lead and a meta line. Keep h1 under about twelve words.",
    "Sections are headed by a statement under a heavy rule; a data-label hangs from the rule as a tab. Label every section of a page or none.",
    "A plan is a timeline: mark the milestone reached with data-state=\"done\" and the one being worked towards with aria-current=\"step\"; the route is dashed from there on.",
    "Pages beneath a page are direction signs (nav.pages); each gets a line bullet in order, so keep their order the same wherever they are linked.",
    "The four line colours tell routes apart and do nothing else. Blue is for links and notes, sign-yellow for caution.",
    "Body text stays on the white or night ground; only short labels, the opening and direction signs sit on panels.",
  ])}\n`,
  stylesheet: CSS,
};
