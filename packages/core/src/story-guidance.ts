/**
 * Story authoring guidance, served by story(action="guidance") so page quality does not depend on
 * an agent's taste. The sandboxed frame cannot inherit the app's stylesheet, so the guidance embeds
 * a small resolved token set and recipes built only on it.
 *
 * PROVISIONAL: these values are a deliberately neutral placeholder until WhatBuild's design system
 * is chosen. When it is, TOKENS below must be derived from it and a drift test must compare them.
 */

export const GUIDANCE_VERSION = "0.1.0-provisional";

export const TOKENS: Record<string, string> = {
  "--wb-ink": "#1c1b19",
  "--wb-ink-muted": "#5d5a53",
  "--wb-paper": "#fbfaf7",
  "--wb-surface": "#f2f0ea",
  "--wb-rule": "#dcd8ce",
  "--wb-accent": "#2f5d50",
  "--wb-status-evidence": "#2f5d50",
  "--wb-status-caution": "#8a5a00",
  "--wb-status-open": "#5d5a53",
  "--wb-font-body": "ui-serif, Georgia, 'Times New Roman', serif",
  "--wb-font-ui": "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  "--wb-font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
  "--wb-step--1": "0.875rem",
  "--wb-step-0": "1.0625rem",
  "--wb-step-1": "1.3rem",
  "--wb-step-2": "1.7rem",
  "--wb-step-3": "2.2rem",
  "--wb-space-1": "0.25rem",
  "--wb-space-2": "0.5rem",
  "--wb-space-3": "1rem",
  "--wb-space-4": "1.5rem",
  "--wb-space-5": "2.5rem",
  "--wb-radius": "6px",
  "--wb-measure": "68ch",
  "--wb-page": "72rem",
};

const tokenCss = Object.entries(TOKENS)
  .map(([k, v]) => `  ${k}: ${v};`)
  .join("\n");

export const STYLESHEET = `:root {
${tokenCss}
}
@media (prefers-color-scheme: dark) {
  :root { --wb-ink: #ecebe6; --wb-ink-muted: #b5b1a7; --wb-paper: #171614; --wb-surface: #22211e; --wb-rule: #3a3833; --wb-accent: #8cc2b0; --wb-status-evidence: #8cc2b0; --wb-status-caution: #e3b45c; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--wb-paper); color: var(--wb-ink); font: var(--wb-step-0)/1.6 var(--wb-font-body); }
.wb-page { max-width: var(--wb-page); margin: 0 auto; padding: var(--wb-space-5) var(--wb-space-3); }
.wb-prose { max-width: var(--wb-measure); }
.wb-prose > * + * { margin-top: var(--wb-space-3); }
h1, h2, h3 { font-family: var(--wb-font-ui); line-height: 1.2; letter-spacing: -0.01em; }
h1 { font-size: var(--wb-step-3); margin: 0 0 var(--wb-space-2); }
h2 { font-size: var(--wb-step-2); margin: var(--wb-space-5) 0 var(--wb-space-2); }
h3 { font-size: var(--wb-step-1); margin: var(--wb-space-4) 0 var(--wb-space-2); }
a { color: var(--wb-accent); text-underline-offset: 0.15em; }
.wb-lead { font-size: var(--wb-step-1); color: var(--wb-ink); max-width: var(--wb-measure); }
.wb-meta { font: var(--wb-step--1)/1.4 var(--wb-font-ui); color: var(--wb-ink-muted); }
.wb-stack > * + * { margin-top: var(--wb-space-3); }
.wb-card { border: 1px solid var(--wb-rule); border-radius: var(--wb-radius); padding: var(--wb-space-3); background: var(--wb-paper); }
.wb-callout { border-left: 3px solid var(--wb-rule); padding: var(--wb-space-2) var(--wb-space-3); background: var(--wb-surface); }
.wb-callout[data-tone="caution"] { border-left-color: var(--wb-status-caution); }
.wb-quote { margin: 0; padding-left: var(--wb-space-3); border-left: 2px solid var(--wb-rule); }
.wb-quote blockquote { margin: 0; }
.wb-quote figcaption { font: var(--wb-step--1)/1.4 var(--wb-font-ui); color: var(--wb-ink-muted); margin-top: var(--wb-space-1); }
.wb-status { display: inline-block; font: 600 var(--wb-step--1)/1 var(--wb-font-ui); padding: 0.2em 0.5em; border-radius: 999px; border: 1px solid currentColor; }
.wb-status[data-state="evidence"] { color: var(--wb-status-evidence); }
.wb-status[data-state="caution"] { color: var(--wb-status-caution); }
.wb-status[data-state="open"] { color: var(--wb-status-open); }
.wb-metric { font-family: var(--wb-font-ui); }
.wb-metric strong { display: block; font-size: var(--wb-step-2); }
.wb-table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font: var(--wb-step--1)/1.45 var(--wb-font-ui); }
caption { text-align: left; font-weight: 600; padding-bottom: var(--wb-space-2); }
th, td { text-align: left; padding: var(--wb-space-2); border-bottom: 1px solid var(--wb-rule); vertical-align: top; }
details { border-top: 1px solid var(--wb-rule); padding: var(--wb-space-2) 0; }
summary { cursor: pointer; font-family: var(--wb-font-ui); }
.wb-split { display: grid; gap: var(--wb-space-5); grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
.wb-grid { display: grid; gap: var(--wb-space-3); grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
@media (max-width: 48rem) { .wb-split { grid-template-columns: 1fr; } .wb-page { padding: var(--wb-space-4) var(--wb-space-3); } }
`;

export function linkTemplates(base: string, path: string) {
  const p = `${base}/t/${path}`;
  return {
    source: `${p}/sources/{record_id}`,
    passage: `${p}/sources/{record_id}?tab=passages&seq={seq}`,
    insight: `${p}/insights/{insight_id}`,
    objective: `${p}/objectives`,
    assumption: `${p}/insights/assumptions/{id}`,
    decision: `${p}/insights/decisions/{id}`,
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
    { id: "comparison_table", name: "Comparison table", use_when: "The same criteria across alternatives.", html: `<div class="wb-table-wrap" role="region" aria-label="REPLACE: table name" tabindex="0"><table><caption>REPLACE: what is compared</caption><thead><tr><th scope="col">Option</th><th scope="col">REPLACE_CRITERION</th></tr></thead><tbody><tr><th scope="row">REPLACE_OPTION</th><td>REPLACE</td></tr></tbody></table></div>`, adaptation: "Use a table only when criteria recur across rows." },
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
  voice: ["Plain, direct sentences.", "The product's vocabulary: objective, source, insight, assumption, decision, Story.", "Calm: no sales language and no generic optimistic closing.", "Sentence-case headings.", "Link text that makes sense out of context.", "Never colour alone."],
  fact_guardrails: [
    "Never add a person, owner, date, source, quote, count, measurement, customer claim, commitment or decision the linked material does not establish.",
    "Never turn a working interpretation into agreement, or an unconfirmed assumption into a settled one.",
    "When a detail is not established, name the limit or leave it out.",
  ],
  composition: "One H1, informative headings, a short opening; tables and ordered lists only when their semantics apply.",
};

export const CHECKLIST = [
  { check: "Audience and purpose", question: "Does the opening give this reader the one thing they need first?" },
  { check: "Evidence and interpretation", question: "Is every observation linked to a passage, and every interpretation labelled?" },
  { check: "Scope", question: "Does each section do one job, and is everything here needed?" },
  { check: "Editorial pass", question: "Did you clarify, distill and polish?" },
  { check: "Structure and access", question: "One H1, logical headings, labelled tables, links that say where they go, no colour-only meaning?" },
  { check: "Publishing", question: "Did you read the current version, pass its etag, include refs, and place the page in the hierarchy?" },
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
  "Read the objectives, the relevant sources, insights, assumptions and decisions first.",
  "Read the current version of the page before revising it, keep what is useful, and pass its etag.",
  "Use the hierarchy to find related pages; give each page a short lower-case page_id; link related pages inline.",
  "Publish with a short note saying what changed. Publishing does not place a page: set_hierarchy does, with its own etag.",
  "Archiving a page takes it out of navigation and promotes its sub-pages; restoring returns it unplaced.",
];

export const CONTENT_RULES = [
  "Explain the objectives, current understanding, choices and next steps.",
  "Write for a busy stakeholder.",
  "Link the sources, insights and the few assumptions or decisions that shape the account.",
  "Separate observed evidence, interpretation and agreement.",
  "Never invent agreement, owners, dates, commitments or measurements.",
  "Leave breadcrumbs and navigation to the reader: the app provides them.",
];

export const DESIGN_RULES = [
  "One H1; logical heading levels.",
  "Spacing, radius and type only from the supplied tokens.",
  "Restrained surfaces: most content is prose on paper.",
  "Colour only for a labelled status or a necessary data comparison, never as the only carrier of meaning.",
  "Accent colour is for links; do not use status colours for decoration.",
  "Source order is reading order.",
  "No fixed heights or minimum widths: the page reflows in the frame.",
  "Fonts cannot load from a network; use the supplied system stacks.",
];
