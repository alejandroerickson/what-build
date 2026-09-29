/**
 * Story authoring guidance, served by story(action="guidance") so page quality does not depend on
 * an agent's taste. The sandboxed frame cannot inherit the app's stylesheet or load fonts, so the
 * guidance embeds a small resolved token set and recipes built only on it.
 *
 * Every colour, radius and UI font below is copied from the web app's design tokens
 * (apps/web/src/styles/tokens.css): WEB_TOKEN names the web token each guidance token derives from,
 * and a drift test in the server suite fails when the two disagree in either scheme. Change the
 * web tokens first, then update the values here and bump GUIDANCE_VERSION. The reading face stays
 * a serif system stack: it is the Story's own, not the app's.
 */

export const GUIDANCE_VERSION = "1.3.0";

/** The web design token each derived guidance token copies, in both schemes. */
export const WEB_TOKEN: Record<string, string> = {
  "--wb-ink": "--text",
  "--wb-ink-muted": "--muted",
  "--wb-paper": "--panel",
  "--wb-surface": "--canvas",
  "--wb-rule": "--line",
  "--wb-rule-strong": "--line-2",
  "--wb-accent": "--accent",
  "--wb-status-evidence": "--ok",
  "--wb-status-caution": "--warn",
  "--wb-status-open": "--muted",
  "--wb-font-ui": "--font",
  "--wb-font-mono": "--mono",
  "--wb-radius-sm": "--r-xs",
  "--wb-radius": "--r-sm",
  "--wb-radius-lg": "--r-md",
};

/** Light scheme (the default), plus the scheme-independent type, space and shape. */
export const TOKENS: Record<string, string> = {
  "--wb-ink": "#1e1e1e",
  "--wb-ink-muted": "#555555",
  "--wb-paper": "#ffffff",
  "--wb-surface": "#f0f0f0",
  "--wb-rule": "#e6e6e6",
  "--wb-rule-strong": "#d5d5d5",
  "--wb-accent": "#5a53e8",
  "--wb-status-evidence": "#0f7440",
  "--wb-status-caution": "#9a5b00",
  "--wb-status-open": "#555555",
  "--wb-font-body": 'ui-serif, Charter, Georgia, "Times New Roman", serif',
  "--wb-font-ui": '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  "--wb-font-mono": 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  "--wb-step--1": "0.875rem",
  "--wb-step-0": "1.0625rem",
  "--wb-step-h2": "1.125rem",
  "--wb-step-1": "1.25rem",
  "--wb-step-2": "1.5rem",
  "--wb-step-3": "2rem",
  "--wb-space-1": "0.25rem",
  "--wb-space-2": "0.5rem",
  "--wb-space-3": "1rem",
  "--wb-space-4": "1.5rem",
  "--wb-space-5": "2.5rem",
  "--wb-radius-sm": "4px",
  "--wb-radius": "6px",
  "--wb-radius-lg": "8px",
  "--wb-measure": "68ch",
  "--wb-page": "72rem",
};

/** Dark scheme: only the colours change. */
export const TOKENS_DARK: Record<string, string> = {
  "--wb-ink": "#ededed",
  "--wb-ink-muted": "#bdbdbd",
  "--wb-paper": "#2a2a2a",
  "--wb-surface": "#1b1b1b",
  "--wb-rule": "#383838",
  "--wb-rule-strong": "#474747",
  "--wb-accent": "#8b85ff",
  "--wb-status-evidence": "#62d394",
  "--wb-status-caution": "#f0b95e",
  "--wb-status-open": "#bdbdbd",
};

const declarations = (tokens: Record<string, string>, indent: string) =>
  Object.entries(tokens)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join("\n");

/**
 * The attribute the app sets on a Story page's <html> when it shows the page, so the page follows
 * the app's chosen theme rather than only the system's. Without it the page follows the system.
 */
export const THEME_ATTRIBUTE = "data-wb-theme";

export const STYLESHEET = `:root {
  color-scheme: light dark;
${declarations(TOKENS, "  ")}
}
@media (prefers-color-scheme: dark) {
  :root:not([${THEME_ATTRIBUTE}="light"]) {
${declarations(TOKENS_DARK, "    ")}
  }
}
:root[${THEME_ATTRIBUTE}="light"] { color-scheme: light; }
:root[${THEME_ATTRIBUTE}="dark"] {
  color-scheme: dark;
${declarations(TOKENS_DARK, "  ")}
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--wb-paper); color: var(--wb-ink); font: var(--wb-step-0)/1.6 var(--wb-font-body); }
.wb-page { max-width: var(--wb-page); margin: 0 auto; padding: var(--wb-space-5) var(--wb-space-3); }
.wb-prose { max-width: var(--wb-measure); }
.wb-prose > * + * { margin-top: var(--wb-space-3); }
h1, h2, h3 { font-family: var(--wb-font-ui); font-weight: 600; line-height: 1.25; letter-spacing: -0.01em; }
h1 { font-size: var(--wb-step-3); margin: 0 0 var(--wb-space-2); }
h2 { font-size: var(--wb-step-h2); margin: var(--wb-space-5) 0 var(--wb-space-2); }
h3 { font-size: var(--wb-step-0); margin: var(--wb-space-4) 0 var(--wb-space-2); }
a { color: var(--wb-accent); text-decoration-thickness: 1px; text-underline-offset: 0.15em; }
:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: 2px; border-radius: var(--wb-radius-sm); }
code, kbd, samp { font-family: var(--wb-font-mono); font-size: 0.875em; }
.wb-lead { font-size: var(--wb-step-1); color: var(--wb-ink); max-width: var(--wb-measure); }
.wb-meta { font: var(--wb-step--1)/1.4 var(--wb-font-ui); color: var(--wb-ink-muted); }
.wb-stack > * + * { margin-top: var(--wb-space-3); }
.wb-card { border: 1px solid var(--wb-rule); border-radius: var(--wb-radius-lg); padding: var(--wb-space-3); background: var(--wb-paper); }
.wb-callout { border: 1px solid var(--wb-rule); border-radius: var(--wb-radius-lg); padding: var(--wb-space-2) var(--wb-space-3); background: var(--wb-surface); }
.wb-stack > :first-child, .wb-card > :first-child, .wb-callout > :first-child { margin-top: 0; }
.wb-card > :last-child, .wb-callout > :last-child { margin-bottom: 0; }
.wb-callout[data-tone="caution"] { border-color: var(--wb-status-caution); }
.wb-quote { margin: 0; padding-left: var(--wb-space-3); border-left: 2px solid var(--wb-rule-strong); }
.wb-quote blockquote { margin: 0; }
.wb-quote figcaption { font: var(--wb-step--1)/1.4 var(--wb-font-ui); color: var(--wb-ink-muted); margin-top: var(--wb-space-1); }
.wb-status { display: inline-block; font: 500 var(--wb-step--1)/1 var(--wb-font-ui); padding: 0.25em 0.5em; border-radius: var(--wb-radius-sm); border: 1px solid currentColor; white-space: nowrap; }
.wb-status[data-state="evidence"] { color: var(--wb-status-evidence); }
.wb-status[data-state="caution"] { color: var(--wb-status-caution); }
.wb-status[data-state="open"] { color: var(--wb-status-open); }
.wb-metric { font-family: var(--wb-font-ui); }
.wb-metric strong { display: block; font-size: var(--wb-step-2); font-weight: 600; font-variant-numeric: tabular-nums; }
.wb-table-wrap { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; border-radius: var(--wb-radius-sm); }
table { border-collapse: collapse; width: 100%; font: var(--wb-step--1)/1.45 var(--wb-font-ui); font-variant-numeric: tabular-nums; }
caption { text-align: left; font-weight: 600; padding-bottom: var(--wb-space-2); }
th, td { text-align: left; min-width: 6.5rem; padding: var(--wb-space-2); border-bottom: 1px solid var(--wb-rule); vertical-align: top; }
thead th { font-weight: 500; color: var(--wb-ink-muted); border-bottom-color: var(--wb-rule-strong); }
details { border-top: 1px solid var(--wb-rule); padding: var(--wb-space-2) 0; }
summary { cursor: pointer; font-family: var(--wb-font-ui); font-weight: 500; }
.wb-split { display: grid; gap: var(--wb-space-5); grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
.wb-grid { display: grid; gap: var(--wb-space-3); grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
@media (max-width: 48rem) { .wb-split { grid-template-columns: 1fr; } .wb-page { padding: var(--wb-space-4) var(--wb-space-3); } th:first-child, td:first-child { padding-left: 0; } }
`;

export function linkTemplates(base: string, path: string) {
  const p = `${base}/t/${path}`;
  return {
    source: `${p}/evidence/{record_id}`,
    passage: `${p}/evidence/{record_id}?view=passages&seq={seq}`,
    insight: `${p}/synthesis/insights/{insight_id}`,
    outcome: `${p}/idea`,
    assumption: `${p}/synthesis/assumptions/{id}`,
    decision: `${p}/synthesis/decisions/{id}`,
    story_page: `${p}/story/{page_id}`,
  };
}

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

export function components(links: ReturnType<typeof linkTemplates>) {
  const src = links.source.replace("{record_id}", "REPLACE_RECORD_ID");
  const passage = links.passage.replace("{record_id}", "REPLACE_RECORD_ID").replace("{seq}", "REPLACE_SEQ");
  return [
    { id: "opening", name: "Opening", use_when: "Start every page with the conclusion, why it matters, and a metadata line. No hero band and no duplicate navigation.", html: `<header class="wb-stack"><h1>REPLACE: the conclusion in one line</h1><p class="wb-lead">REPLACE: why it matters to this reader, in two sentences.</p><p class="wb-meta">Updated REPLACE_DATE · Working interpretation</p></header>`, adaptation: "State the status in words; a working interpretation must not look like agreement." },
    { id: "evidence_card", name: "Evidence card", use_when: "Group one discrete evidence item in a comparison or an aside. Not every paragraph belongs in a card.", html: `<article class="wb-card wb-stack"><h3>REPLACE: what this evidence shows</h3><p>REPLACE: one or two sentences.</p><p class="wb-meta">${link(src, "Read the source")}</p></article>`, adaptation: "Name the source in the link text." },
    { id: "callout", name: "Callout", use_when: "An assumption, limitation or implication that changes how the page should be read.", html: `<aside class="wb-callout" data-tone="caution"><p><strong>Assumption, unconfirmed.</strong> REPLACE: the premise and what would change it.</p></aside>`, adaptation: "Say the status in words; colour is never the only carrier of meaning." },
    { id: "quote", name: "Quote", use_when: "The source's exact words add evidence. Quote only after reading the passage.", html: `<figure class="wb-quote"><blockquote><p>REPLACE: exact words from the passage.</p></blockquote><figcaption>REPLACE_SPEAKER · REPLACE_SOURCE_DATE · segment REPLACE_SEQ · ${link(passage, "Read in context")}</figcaption></figure>`, adaptation: "Use exact quotations only; never paraphrase inside quotation marks." },
    { id: "status", name: "Status label", use_when: "Label evidence or review state.", html: `<span class="wb-status" data-state="open">Unconfirmed</span>`, adaptation: "States: evidence (supported by cited passages), caution (contested or thin), open (not yet reviewed). The text always explains the state." },
    { id: "metric", name: "Metric", use_when: "A real count, ratio or interval with its denominator, period and source. Omit when no measured value exists.", html: `<p class="wb-metric"><strong>REPLACE_VALUE</strong> REPLACE: what was counted, out of what, over what period · ${link(src, "source")}</p>`, adaptation: "Never invent or estimate a number." },
    { id: "comparison_table", name: "Comparison table", use_when: "The same criteria across alternatives. Always inside .wb-table-wrap, so a wide table scrolls within itself instead of squeezing its columns.", html: `<div class="wb-table-wrap" role="region" aria-label="REPLACE: table name" tabindex="0"><table><caption>REPLACE: what is compared</caption><thead><tr><th scope="col">Option</th><th scope="col">REPLACE_CRITERION</th></tr></thead><tbody><tr><th scope="row">REPLACE_OPTION</th><td>REPLACE</td></tr></tbody></table></div>`, adaptation: "Use a table only when criteria recur across rows. Keep it to three columns where you can: at phone width (about 390px) three fit, and a fourth makes the table scroll. Short cell text; put explanation in prose." },
    { id: "disclosure", name: "Disclosure", use_when: "Optional method or caveat detail. Consequential caveats stay visible.", html: `<details><summary>How we know this</summary><p>REPLACE: method detail.</p></details>`, adaptation: "Never hide something that changes the conclusion." },
    { id: "next_steps", name: "Next steps", use_when: "Ordered actions with a real dependency or order. Omit invented owners or dates.", html: `<ol><li>REPLACE: the next step and what it would tell us.</li></ol>`, adaptation: "An owner or date appears only if the linked material establishes it." },
  ];
}

export function layouts() {
  return [
    { id: "evidence_narrative", name: "Evidence narrative", use_when: "One reading column: what we observed, how we interpret it, what follows.", html: `<main class="wb-page"><article class="wb-prose"><h1>REPLACE</h1><p class="wb-lead">REPLACE</p><h2>What we observed</h2><p>REPLACE</p><h2>How we read it</h2><p>REPLACE</p><h2>What follows</h2><p>REPLACE</p></article></main>` },
    { id: "brief_with_evidence", name: "Brief with evidence", use_when: "A two-thirds account with an 'Evidence and limits' aside that follows in reading order and stacks on narrow screens.", html: `<main class="wb-page wb-split"><article class="wb-prose"><h1>REPLACE</h1><p class="wb-lead">REPLACE</p></article><aside class="wb-stack" aria-labelledby="evidence-heading"><h2 id="evidence-heading">Evidence and limits</h2><p>REPLACE</p></aside></main>` },
    { id: "options_comparison", name: "Options comparison", use_when: "Comparable alternatives as equal cards, a comparison, and a recommendation labelled as a proposal with its uncertainty.", html: `<main class="wb-page wb-stack"><h1>REPLACE</h1><div class="wb-grid"><article class="wb-card"><h2>Option A</h2><p>REPLACE</p></article><article class="wb-card"><h2>Option B</h2><p>REPLACE</p></article></div><aside class="wb-callout"><p><strong>Proposal, not a decision.</strong> REPLACE: the recommendation and its uncertainty.</p></aside></main>` },
    { id: "sequence", name: "Learning plan", use_when: "What we will learn next, in order, with what would change the plan.", html: `<main class="wb-page wb-prose"><h1>REPLACE</h1><ol><li>REPLACE</li></ol><aside class="wb-callout"><p><strong>What would change this plan:</strong> REPLACE</p></aside></main>` },
  ];
}

export const WRITING = {
  purpose: "Help a busy reader understand the direction, the evidence and the next useful action, without turning the page into a report dump.",
  audiences: [
    { audience: "Leadership", need: "The conclusion and the decision it informs.", shape: "Lead with the conclusion; one paragraph of why; the decision and its criteria." },
    { audience: "Product trio", need: "Current understanding and what could change the work.", shape: "Current understanding, the strongest evidence, and only the assumptions that could change the work." },
    { audience: "Delivery partners", need: "What is decided, what is not, and the criteria.", shape: "Name the decision and criteria early; a comparison or sequence only for a real trade-off." },
    { audience: "Mixed or external readers", need: "Enough context to follow.", shape: "Minimal context; define terms on first use." },
  ],
  separate_claim_types: [
    { type: "Observed evidence", instruction: "What a source says, with a link to the passage." },
    { type: "Interpretation", instruction: "What the team makes of it, labelled as interpretation." },
    { type: "Decision or proposal", instruction: "Call it a decision only when it links to a recorded decision; otherwise it is a proposal." },
    { type: "Assumption or unknown", instruction: "Name it as an assumption and say whether it is confirmed." },
  ],
  passes: [
    { pass: "Clarify", checks: ["Choose the audience and the one fact it needs first.", "Give each section one job.", "Use the same terms as the linked insight or register.", "Make every link say what it contains.", "Keep each citation next to its claim."] },
    { pass: "Distill", checks: ["Remove repeated introductions and decorative panels.", "Remove empty forward-looking statements.", "Keep caveats, decision criteria and uncertainty.", "One visual role per section; a table only when criteria recur."] },
    { pass: "Polish", checks: ["Read it in rendered order.", "Check headings, links, table labels and narrow reflow.", "Replace inflated or vague phrasing without adding facts.", "Check every quotation, count, date, owner and decision against the linked material."] },
  ],
  voice: ["Plain, direct sentences.", "The product's vocabulary: outcome, source, insight, assumption, decision, Story.", "Calm: no sales language and no generic optimistic closing.", "Sentence-case headings.", "Link text that makes sense out of context.", "Never colour alone."],
  fact_guardrails: [
    "Never add a person, owner, date, source, quote, count, measurement, customer claim, commitment or decision the linked material does not establish.",
    "Never turn a working interpretation into agreement, or an unconfirmed assumption into a settled one.",
    "When a detail is not established, name the limit or leave it out.",
    "Honour a source's own quoting rules: when an agreement, consent note or the source's metadata limits naming people, attribute by role (\"an operations lead at one customer\") and never name them.",
    "A derived view, digest or analysis is not direct evidence. When a page cites one, say so beside the claim (\"analysis, not evidence\") and cite the underlying passages where you can.",
  ],
  composition: "One H1, informative headings, a short opening; tables and ordered lists only when their semantics apply.",
};

export const CHECKLIST = [
  { check: "Audience and purpose", question: "Does the opening give this reader the one thing they need first?" },
  { check: "Evidence and interpretation", question: "Is every observation linked to a passage, and every interpretation labelled?" },
  { check: "Scope", question: "Does each section do one job, and is everything here needed?" },
  { check: "Editorial pass", question: "Did you clarify, distill and polish?" },
  { check: "Structure and access", question: "One H1, logical headings, labelled tables, links that say where they go, no colour-only meaning?" },
  { check: "Publishing", question: "Did you read the current version, pass its etag, send refs and citations in full when they change, and place the page in the hierarchy (unless your instructions say not to)?" },
];

export function starterHtml(title = "REPLACE: page title") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${STYLESHEET}</style>
</head>
<body>
${layouts()[1]!.html}
</body>
</html>`;
}

export const WORKFLOW = [
  "Read the outcomes, the relevant sources, insights, assumptions and decisions first.",
  "Read the current version of the page and its notes for agents (get_page → agent_notes) before revising it, keep what is useful, and pass its etag.",
  "Cite the exact passages the page rests on in citations (up to 20), and list the objects it draws on in refs. When you pass either list, pass it in full: it replaces the previous one.",
  "On a later version send only what changes: html, refs and citations you omit carry forward from the current version. patch_html fixes a sentence by exact find and replace; from_version restores an earlier version as a new one. Compare html_sha256 to confirm identical HTML.",
  "Use the hierarchy to find related pages; give each page a short lower-case page_id; link related pages inline.",
  "summary describes the page itself and shows in navigation. Keep mechanics — citation ranges, merges to stay within the citation limit, ids — in the notes for agents; the activity log already records each version.",
  "Publishing does not place a page: set_hierarchy does, with its own etag. Place each new page unless your instructions say otherwise; then leave it unplaced and say so.",
  "After publishing, update the page's notes for agents with write_notes: its purpose, what is still to fold in, and structural decisions. publish returns agent_notes_etag; while the notes are empty you may omit the etag.",
  "Archiving a page takes it out of navigation and promotes its sub-pages; restoring returns it unplaced.",
];

export const CONTENT_RULES = [
  "Explain the outcomes, current understanding, choices and next steps.",
  "Write for a busy stakeholder.",
  "Link the sources, insights and the few assumptions or decisions that shape the account.",
  "Separate observed evidence, interpretation and agreement.",
  "Never invent agreement, owners, dates, commitments or measurements.",
  "Leave breadcrumbs and navigation to the reader: the app provides them.",
];

export const DESIGN_RULES = [
  "One H1; logical heading levels.",
  "Spacing, radius and type only from the supplied tokens; the stylesheet already carries the light and dark schemes, so use its variables rather than new colour values.",
  "Restrained surfaces: most content is prose on paper, separated by hairline rules; no shadows, glows or gradients.",
  "Colour only for a labelled status or a necessary data comparison, never as the only carrier of meaning.",
  "Accent colour is for links; do not use status colours for decoration.",
  "Source order is reading order.",
  "No fixed heights or minimum widths: the page reflows in the frame, down to phone width (about 390px).",
  "Wrap every table in .wb-table-wrap so it scrolls inside itself rather than squeezing or widening the page.",
  "Fonts cannot load from a network: use the supplied stacks, which name Inter first for headings and fall back to system faces. Never embed font files.",
];

/**
 * Mark a stored Story page with the viewer's theme for one response: adds the theme attribute to the
 * page's <html> start tag (or opens one after any doctype and leading comments when the page has
 * none). Only "light" and "dark" are ever written. The stored HTML is not changed.
 */
export function withStoryTheme(html: string, theme: "light" | "dark"): string {
  const attr = ` ${THEME_ATTRIBUTE}="${theme}"`;
  const lead = /^(?:\uFEFF)?(?:\s+|<!doctype[^>]*>|<!--[\s\S]*?-->)*/i.exec(html)![0];
  const rest = html.slice(lead.length);
  if (/^<html(?=[\s>/])/i.test(rest)) return `${lead}<html${attr}${rest.slice(5)}`;
  return `${lead}<html${attr}>${rest}`;
}
