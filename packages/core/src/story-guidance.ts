/**
 * Story authoring guidance, served by story(action="guidance"). It gives agents taste, a way to
 * choose a design system, and passes to run on a page. It does not give them WhatBuild's own look:
 * a Story is the team's document, often read outside the team, so it follows the product's Story
 * style (story(action="get_style")): the company's own design system, or a house style
 * (story-styles.ts) adopted for the product.
 *
 * Bump GUIDANCE_VERSION when the guidance changes in a way an agent should notice.
 */

import { STORY_FONTS } from "./story-fonts.ts";
import { HOUSE_STYLES, VOCABULARY, pageDocument, type HouseStyle } from "./story-styles.ts";

export const GUIDANCE_VERSION = "4.0.0";

/** The typefaces the server embeds in a page that names them; no font file is ever sent for these. */
export const CARRIED_TYPEFACES = {
  families: STORY_FONTS.map((f) => f.family),
  how: 'Name the family in quotes in font-family, with fallbacks after it (font-family: "Signika", "Segoe UI", sans-serif). WhatBuild embeds the face when it shows or prints the page; the stored page stays small and you never send a font file for these. Each is the Latin subset of an SIL Open Font License variable font, so any weight in its range works, and Archivo any width from 62% to 125% with font-stretch.',
};

export function linkTemplates(base: string, path: string) {
  const p = `${base}/t/${path}`;
  return {
    source: `${p}/evidence/{record_id}`,
    outcome: `${p}/idea`,
    assumption: `${p}/exploration/assumptions/{id}`,
    mockup: `${p}/exploration/mockups/{mockup_id}`,
    story_page: `${p}/story/{page_id}`,
  };
}

/** A house style as the catalogue lists it: everything but the stylesheet and rules. */
export function catalogue(styles: HouseStyle[] = HOUSE_STYLES) {
  return styles.map(({ id, name, summary, best_for, character, signature, avoid }) => ({ id, name, summary, best_for, character, signature, avoid }));
}

/** How an agent settles which design system a product's Story uses. */
export const STYLE_WORKFLOW = [
  'Call story(action="get_style") before writing or restyling any page. When the product has a Story style, every page follows it: publish with body and WhatBuild puts the stylesheet around it (paste it into <style> yourself only when you send a whole document as html). Follow its rules, and extend it rather than contradict it.',
  "When the product has no Story style, ask the person before the first page: does their company have a design system, brand guide or document template that stakeholder reports should follow?",
  "If it does, build the Story style from it: its colours for light and dark, its fonts (a carried typeface when the design system uses one, otherwise the system fallbacks), its spacing, radii and tone, written as one stylesheet that styles the shared vocabulary. Save it with set_style (name, summary, rules, stylesheet). Read what they share as reference; never copy a font file whose licence you have not seen.",
  'If it does not, offer the house styles below, and tell the person they can preview each in the web app (Story → the Story style section in the details panel). Adopt the one they pick with set_style { house_style }. If they leave it to you, choose by audience using best_for, adopt it, and say which you chose and why.',
  "Never style a Story in WhatBuild's own app look. The Story belongs to the team and is often read by people who have never seen WhatBuild.",
  "When the person asks for a different style later, set_style again, then publish each page with restyle: true: the page content stays, the stylesheet changes.",
  "When a Story needs something the style does not have (a product's own diagram, a matrix), add it to the product's Story style with set_style, so every page shares it. A rule written into one page is lost to the next.",
];

/** What good looks like. Taste is a set of commitments, not a list of components. */
export const TASTE = [
  "Commit to the style's character on every page. A timid page that half-follows a style reads worse than either extreme.",
  "Design for the one thing this reader must take away, then make it the largest, first and most contrasting thing on the page.",
  "Build hierarchy with scale and weight contrast: a few sizes far apart, not many sizes close together.",
  "Compose, don't stack. Use the grid: asymmetric columns, a margin for notes, a full-width band of figures, a single pull quote set large. A page of equal boxes in a column is a list, not a composition.",
  "Let whitespace carry structure. Rules, alignment and space group things better than borders around everything.",
  "Pick one signature move of the style per page and do it well; don't use every recipe on every page.",
  "Typography is most of the design: measure of 60 to 75 characters for running text, generous line height, real quotation marks and dashes, lining numbers in tables and figures.",
  "Colour is scarce and meaningful: one accent, used for the same job everywhere, and never the only carrier of meaning.",
  "Numbers deserve display: when a real count, ratio or interval is the point, set it large with what it counts beneath it.",
  "Vary rhythm across a Story: a narrative page, a comparison page and a short briefing should not share one template.",
  "A list of like things is a line each, in aligned columns, not a card each. Rules between lines do the work that boxes pretend to.",
  "A Story has a front door. Its top page says what the whole Story concludes and links to the pages beneath it, each with a line on what it holds.",
];

/** Reflexes that make a page look machine-made. Check a finished page for each. */
export const ANTI_PATTERNS = [
  "Cards inside cards, or every paragraph in its own box.",
  "A grid of identical cards each with an icon tile above a heading.",
  "Gradient text, glows, drop shadows on everything, glassmorphism.",
  "A coloured stripe down one side of every callout.",
  "Everything centred, including body text and lists.",
  "Grey text on a coloured background, or low-contrast placeholder-grey body text.",
  "Emoji as bullets or section markers.",
  "A generic hero band with a tagline instead of the conclusion.",
  "Topic-label headings ('Overview', 'Background', 'Key findings') where a statement would say what the section shows.",
  "Four or more competing accent colours, or status colours used as decoration.",
  "Invented charts: a chart needs real data from the sources, labelled axes and a stated denominator.",
  "A source reference or a passage link after every claim. The Story explains; the evidence stays in Evidence, where the team and its agents find it by searching. Most readers of a Story cannot open the evidence at all.",
  "Repeating the page title, a breadcrumb or site navigation inside the page: the app provides them.",
  "A kicker that only says where the page sits in the Story. The app shows that; use a kicker when it adds a theme the headline lacks, and leave it out otherwise.",
  "Numbered sections where the order means nothing. Give the section a label that says something (data-label) or let the heading stand.",
  "A feature, a risk or a requirement in a card of its own. Use one line each (ul.lines).",
  "A page that ends on a list of 'read next' links to the whole Story. Link the one or two pages that continue this page's argument.",
];

/** Named passes an agent runs over a draft, in the spirit of design-skill commands. */
export const DESIGN_PASSES = [
  { pass: "critique", when: "After the first full draft.", checks: ["What is the one takeaway, and is it the first and largest thing?", "Would a stakeholder who reads only the headings get the argument?", "Which part looks templated rather than designed for this content?", "Score hierarchy, composition, typography, colour and restraint from 1 to 5; fix the lowest."] },
  { pass: "distill", when: "The page feels long or busy.", checks: ["Cut repeated introductions and restated conclusions.", "Remove boxes that group nothing.", "One visual role per section.", "Keep caveats, criteria and uncertainty."] },
  { pass: "bolder", when: "The page is correct but forgettable.", checks: ["Make the conclusion larger and shorter.", "Promote the strongest quote or number to a signature element.", "Increase contrast between levels of hierarchy.", "Use more of the grid: a margin, a band, an offset."] },
  { pass: "quieter", when: "The page shouts.", checks: ["Remove all but one accent use per section.", "Replace boxes with space and rules.", "Reduce the number of type sizes.", "Drop decoration that carries no meaning."] },
  { pass: "typeset", when: "Before polishing any page.", checks: ["Running text at 60 to 75 characters.", "Headings balanced (text-wrap: balance) and set as statements.", "Real quotation marks, apostrophes and dashes.", "Lining, tabular numbers in tables and figures."] },
  { pass: "layout", when: "The page is a single column of equal blocks.", checks: ["Is there a reason for every column break?", "Do notes sit beside what they explain?", "Does spacing group related things and separate unrelated ones?", "Does reading order match source order?"] },
  { pass: "adapt", when: "Before publishing, on the page's preview.", checks: ["Check at about 390px wide: no horizontal page scroll, tables scroll inside .table-wrap, grids stack in reading order.", "Check in dark as well as light if the style has a dark scheme (?theme=dark on the preview).", "Check the print view: slides and bands become ordinary blocks, and on paper the page is about 680px wide, so its narrow layout applies."] },
  { pass: "polish", when: "Last.", checks: ["Read it in rendered order.", "Check every quotation, count and date against the sources you read, and every link.", "Headings, link text and table labels make sense out of context.", "Focus is visible; no meaning carried by colour alone."] },
];

/**
 * Design tools the agent may already have. Most people will never discover them on their own, so
 * the guidance asks the agent to use them, and to mention them once when they are missing.
 */
export const DESIGN_TOOLS = {
  why: "Pages are better when a design skill reviews them. People rarely know these exist; tell them.",
  use: [
    "If your harness has a design skill installed, use it on every page before publishing: for example Impeccable (impeccable.style) with its critique, distill, bolder, quieter, typeset, layout, adapt and polish commands, or Anthropic's frontend-design skill. Run them on the page's HTML as you would on a web page.",
    'Look at every page before publishing it. Send the publish call to story(action="preview") instead: it makes every check publish makes and gives a grant to GET the exact document publish would store, in the Story style and the page sandbox. Open it with a browser tool, a headless browser or a screenshot tool, sending the grant\'s headers, at desktop width (1280) and about 390px wide, with ?theme=light and ?theme=dark. Fix what you see; don\'t publish blind.',
    "If no design skill is installed, tell the person once, in one sentence, that installing one improves Story pages (Impeccable installs with `npx impeccable install`), then run the DESIGN_PASSES here yourself.",
  ],
};

/** What the sandbox allows, and what every page must do whatever its style. */
export const SANDBOX_RULES = [
  "One self-contained HTML document with inline CSS. Bounded inline JavaScript is allowed but optional; a print or PDF export leaves out anything a script draws.",
  "No network: fonts, images and media must be inline data: URIs. A carried typeface (carried_typefaces) needs no file: name it and WhatBuild embeds it. Otherwise prefer system font stacks; embed a font only if its licence allows embedding (for example the SIL Open Font License), subset it, and keep all embedded fonts under about 150 KB.",
  "No forms, frames, <link>, <base> or remote resources; the page cannot reach the app or navigate it.",
  "Give every link target=\"_blank\" rel=\"noopener noreferrer\". In the app, a plain click on a link to another page of the same Story (links.story_page) shows that page in place, so a reader moves through the Story without collecting tabs; every other link opens in a new tab, and so does any link that would replace the page inside the app.",
  "Support light and dark when the style defines both: the app sets data-wb-theme=\"light\" or \"dark\" on <html>, and without it the page should follow prefers-color-scheme. A style with one scheme sets color-scheme accordingly.",
  "No fixed heights or minimum widths that break reflow: the page must read at about 390px wide. Wrap every table in .table-wrap.",
  "One h1; logical heading levels; source order is reading order; visible focus; contrast at WCAG AA; status and meaning never in colour alone.",
];

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/** Recipes in the shared vocabulary, with the product's own links. Styles give them their look. */
export function components(links: ReturnType<typeof linkTemplates>) {
  return [
    { id: "opening", use_when: "Every page. The conclusion, why it matters, a metadata line.", html: `<header class="opening"><p class="kicker">REPLACE: the section or theme</p><h1>REPLACE: the conclusion in one line</h1><p class="lead">REPLACE: why it matters to this reader, in two sentences.</p><p class="meta">Updated REPLACE_DATE · Working interpretation</p></header>`, adaptation: "State the status in words; a working interpretation must not look like agreement. The kicker is optional: leave it out when it would only repeat where the page sits." },
    { id: "quote", use_when: "A person's own words say it better than a summary would. Quote only words you have read, and only a few on a page.", html: `<figure class="quote"><blockquote><p>REPLACE: their exact words.</p></blockquote><figcaption>REPLACE_SPEAKER · REPLACE: the kind of source and its date</figcaption></figure>`, adaptation: "Exact quotations only; attribute by role where the source limits naming people. No link: the quote is the evidence the reader needs." },
    { id: "note", use_when: "A limit or a definition beside the text it qualifies.", html: `<aside class="note">REPLACE: the limit or definition.</aside>`, adaptation: "Place it just before the paragraph it annotates." },
    { id: "callout", use_when: "An assumption, limitation or implication that changes how the page should be read.", html: `<aside class="callout" data-tone="caution"><p><strong>Assumption, unconfirmed.</strong> REPLACE: the premise and what would change it.</p></aside>`, adaptation: "Say the status in words." },
    { id: "status", use_when: "Label evidence or review state.", html: `<span class="status" data-state="open">Unconfirmed</span>`, adaptation: "evidence (what the sources show), caution (contested or thin), open (not yet reviewed)." },
    { id: "figures", use_when: "Two to four real numbers with what they count and their denominator or period. Omit when no measured value exists.", html: `<div class="figures"><p class="figure"><strong>REPLACE_VALUE</strong> REPLACE: what was counted, out of what</p></div>`, adaptation: "Never invent or estimate a number. Say in words where it comes from when the reader needs to know (\"in the spring survey\")." },
    { id: "columns", use_when: "Comparable alternatives side by side.", html: `<div class="columns"><article><h3>REPLACE: option</h3><p>REPLACE</p></article><article><h3>REPLACE: option</h3><p>REPLACE</p></article></div>`, adaptation: "Give options equal weight; label a recommendation as a proposal." },
    { id: "table", use_when: "The same criteria recur across rows.", html: `<div class="table-wrap" role="region" aria-label="REPLACE: table name" tabindex="0"><table><caption>REPLACE: what is compared</caption><thead><tr><th scope="col">Option</th><th scope="col">REPLACE_CRITERION</th></tr></thead><tbody><tr><th scope="row">REPLACE_OPTION</th><td>REPLACE</td></tr></tbody></table></div>`, adaptation: "Three columns fit a phone; a fourth scrolls. Short cells; explanation in prose." },
    { id: "steps", use_when: "Next steps with a real order.", html: `<ol class="steps"><li>REPLACE: the step and what it would tell us.</li></ol>`, adaptation: "An owner or date only if the sources or the person establish it." },
    { id: "disclosure", use_when: "Optional method detail.", html: `<details><summary>How we know this</summary><p>REPLACE</p></details>`, adaptation: "Never hide something that changes the conclusion." },
    { id: "section_label", use_when: "A section's heading is a statement, and a short label would help a reader scan: a date, a release, a stage, 'Scope', 'Evidence'.", html: `<section aria-labelledby="REPLACE_ID"><h2 id="REPLACE_ID" data-label="REPLACE: two or three words">REPLACE: what this section shows, as a statement</h2><p>REPLACE</p></section>`, adaptation: "The label goes where the style puts it: above the heading, or in place of a section number. Label every section of a page or none." },
    { id: "wide_section", use_when: "A block needs the page's full width: a timeline, a line per item, a matrix, links to pages.", html: `<section class="wide" aria-labelledby="REPLACE_ID"><h2 id="REPLACE_ID">REPLACE</h2><p>REPLACE: one or two sentences.</p><ul class="lines"><li><strong>REPLACE</strong><span>REPLACE</span></li></ul></section>`, adaptation: "Prose in a wide section keeps its measure; only the blocks run wide." },
    { id: "timeline", use_when: "Two to four dated milestones in order: releases, the stages of a study, a roadmap.", html: `<ol class="timeline"><li data-state="done"><time datetime="REPLACE_YYYY-MM">REPLACE: month and year</time><strong>REPLACE: what was reached</strong><p>REPLACE</p></li><li aria-current="step"><time datetime="REPLACE_YYYY-MM">REPLACE</time><strong>REPLACE: what is true once it is reached</strong><p>REPLACE: one sentence on what it holds.</p></li></ol>`, adaptation: "A date only when a person or a source gave it. Say once on the page whether the dates are a plan, a proposal or a commitment. data-state=\"done\" marks a milestone reached and aria-current=\"step\" the one being worked towards; styles draw the rest as still planned." },
    { id: "lines", use_when: "A list of like things the reader compares down the page: features, risks, requirements, assumptions.", html: `<ul class="lines"><li><strong>REPLACE: its name</strong><span>REPLACE: what it means for the reader, in one line.</span><span class="tag">REPLACE: its group</span></li></ul>`, adaptation: "One line each: if an item needs a paragraph it belongs in prose or on its own page. The last element is optional, and may be a .status instead of a .tag. Write a feature as what a user can do once it ships." },
    { id: "facts", use_when: "Labelled facts about one thing: what is in scope and out of it, what it serves, how it will be measured.", html: `<dl class="facts"><dt>In scope</dt><dd>REPLACE</dd><dt>Out of scope</dt><dd>REPLACE</dd><dt>Measured by</dt><dd>REPLACE: the measure, with its source.</dd></dl>`, adaptation: "Three to five rows. Short labels; the value may hold a link." },
    { id: "evidence_wall", use_when: "Several short exact quotations on one theme, side by side.", html: `<div class="quotes"><figure class="quote"><blockquote><p>REPLACE: exact words, with <mark>the few that matter</mark> marked.</p></blockquote><figcaption>REPLACE_SPEAKER</figcaption></figure><figure class="quote"><blockquote><p>REPLACE</p></blockquote><figcaption>REPLACE</figcaption></figure></div>`, adaptation: "Two to four quotations. Mark a few words in each, never a whole sentence." },
    { id: "tally", use_when: "A count of people or things out of a whole, where seeing the share matters: 14 of 23 respondents.", html: `<p><span class="tally" style="--n: REPLACE_N; --of: REPLACE_TOTAL" role="img" aria-label="REPLACE_N of REPLACE_TOTAL"></span> <strong>REPLACE_N of REPLACE_TOTAL</strong> REPLACE: who or what was counted</p>`, adaptation: "Write the number out beside the marks. Up to about 40 in the whole; above that, use figures." },
    { id: "flow", use_when: "A process or a journey in order: how a week reaches a crew, what happens after sign-up.", html: `<ol class="flow"><li><strong>REPLACE: step</strong><span>REPLACE: what happens in it.</span></li><li><strong>REPLACE</strong><span>REPLACE</span><span class="tag">REPLACE: when it arrives</span></li></ol>`, adaptation: "Three to six steps with short names. A branch or a loop needs a diagram instead." },
    { id: "diagram", use_when: "A flowchart with branches or loops, or a structure: what connects to what.", html: `<figure class="diagram"><svg viewBox="-6 -6 520 132" role="img" aria-labelledby="REPLACE_ID"><title id="REPLACE_ID">REPLACE: what the diagram shows, in a sentence.</title><defs><marker id="REPLACE_ID-head" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path class="head" d="M0 0L10 5L0 10z"/></marker></defs><rect class="node" x="0" y="32" width="150" height="56" rx="6"/><text class="label" x="75" y="65" text-anchor="middle">REPLACE</text><path class="edge" d="M150 60H208" marker-end="url(#REPLACE_ID-head)"/><rect class="node key" x="210" y="32" width="150" height="56" rx="6"/><text class="label on-key" x="285" y="65" text-anchor="middle">REPLACE</text></svg><figcaption>REPLACE: what to notice, and whether it is a proposal.</figcaption></figure>`, adaptation: "Shapes are class node (node key for the one that matters), lines class edge, text class label (label small for annotations, label on-key on a key node). Leave room in boxes: styles set labels in their own type. Give each marker a unique id." },
    { id: "mockup_snippet", use_when: "Showing a screen, or part of one, and pointing at what matters in it.", html: `<figure class="shot" data-device="phone"><div class="screen"><img src="data:image/png;base64,REPLACE" alt="REPLACE: what the screen shows"><span class="pin" style="--x: 50%; --y: 20%">1</span></div><figcaption><p>Mockup: REPLACE_TITLE, version REPLACE_N · ${link(links.mockup.replace("{mockup_id}", "REPLACE_MOCKUP_ID"), "Open the mockup")}</p><ol class="pins"><li><strong>REPLACE.</strong> REPLACE: why it matters.</li></ol></figcaption></figure>`, adaptation: "data-device is phone or desktop. Place pins by percentage of the screen; explain them in the same order in ol.pins. An inline SVG may stand in for the image. The screen keeps the mockup's own look." },
    { id: "pages", use_when: "A page that leads to others: the Story's front page, a page with pages beneath it.", html: `<nav class="pages" aria-label="REPLACE: what these pages are"><ul><li>${link(links.story_page.replace("{page_id}", "REPLACE_PAGE_ID"), "<strong>REPLACE: a short name for the page</strong><span>REPLACE: what the page holds, in one line.</span>")}</li></ul></nav>`, adaptation: "Link the pages beneath this one, or the one or two that continue its argument, not the whole Story." },
  ];
}

/** Ways to compose a page. Pick by content, and vary them across a Story. */
export const COMPOSITIONS = [
  { id: "narrative", use_when: "Where things stand, told in order: observed, interpreted, what follows.", shape: "Opening; two or three sections whose headings are statements; one pull quote; notes beside the claims they qualify." },
  { id: "brief_with_margin", use_when: "A dense account whose limits and definitions must stay visible.", shape: "Running text in a narrow measure with notes in a wide margin: a two-column grid." },
  { id: "decision", use_when: "Options and criteria for a choice.", shape: "Opening states the choice; columns for the options; a table of criteria; a caution callout for what is not known; the recommendation labelled as a proposal." },
  { id: "numbers_first", use_when: "The point is a measured change or a count.", shape: "Opening; a band of figures directly under it; one section explaining each figure's source and limit." },
  { id: "briefing", use_when: "A short readout for a meeting.", shape: "Title slide, then one slide per statement, each proving its heading with one piece of evidence." },
  { id: "evidence_wall", use_when: "Showing breadth: many voices on one theme.", shape: "A heading that states the pattern, then div.quotes with the key words of each marked, a tally for how many said it out of how many asked, then what the pattern does and does not show." },
  { id: "front_page", use_when: "The top page of a Story with pages beneath it: what a stakeholder reads first, and sometimes only.", shape: "Opening with the Story's conclusion; two or three figures; the plan at a glance (a timeline marking where the team is, and a line per release); links to the pages beneath, each with a line and its release; what changes for people (a flow, a mockup snippet with pins); the evidence in short quotes; what ships first and what waits; the status of it all, said once." },
  { id: "plan", use_when: "What will be delivered, and when: a release plan, a roadmap, a study plan.", shape: "Opening states the plan in one line; a section per milestone, labelled with its date, holding one line per item; what each milestone lets the team measure; the open questions that could move a date." },
  { id: "scope", use_when: "One epic, theme or workstream: what it covers and what it is for.", shape: "Opening states the outcome for the user; the scope as labelled facts (in, out, serves, measured by); the journey it changes (a flow, or a diagram when it branches); the screen it adds (a mockup snippet with pins); what each milestone delivers, a line each; the strongest evidence; what could change it." },
];

export const WRITING = {
  purpose: "Help a busy reader understand the direction, the evidence and the next useful action, without turning the page into a report dump.",
  audiences: [
    { audience: "Leadership", need: "The conclusion and the decision it informs.", shape: "Lead with the conclusion; one paragraph of why; the decision and its criteria." },
    { audience: "Product trio", need: "Current understanding and what could change the work.", shape: "Current understanding, the strongest evidence, and only the assumptions that could change the work." },
    { audience: "Delivery partners", need: "What is decided, what is not, and the criteria.", shape: "Name the decision and criteria early; a comparison or sequence only for a real trade-off." },
    { audience: "Mixed or external readers", need: "Enough context to follow.", shape: "Minimal context; define terms on first use." },
  ],
  separate_claim_types: [
    { type: "Observed evidence", instruction: "What the sources show, in your words or a short exact quote, said in words to come from them (\"in three of four interviews\")." },
    { type: "Interpretation", instruction: "What the team makes of it, labelled as interpretation." },
    { type: "Decision or proposal", instruction: "Call it a decision only when the sources or the person record it as one; otherwise it is a proposal." },
    { type: "Assumption or unknown", instruction: "Name it as an assumption and say whether it is confirmed." },
  ],
  passes: [
    { pass: "Clarify", checks: ["Choose the audience and the one fact it needs first.", "Give each section one job.", "Use the same terms as the sources and assumptions.", "Make every link say what it contains."] },
    { pass: "Distill", checks: ["Remove repeated introductions and decorative panels.", "Remove empty forward-looking statements.", "Keep caveats, decision criteria and uncertainty."] },
    { pass: "Polish", checks: ["Replace inflated or vague phrasing without adding facts.", "Check every quotation, count, date, owner and decision against the sources you read."] },
  ],
  voice: ["Plain, direct sentences.", "The product's vocabulary: outcome, source, passage, assumption, mockup, Story.", "Calm: no sales language and no generic optimistic closing.", "Sentence-case headings, written as statements where a section makes a point.", "Link text that makes sense out of context."],
  fact_guardrails: [
    "Never add a person, owner, date, source, quote, count, measurement, customer claim, commitment or decision the sources you read do not establish. Read before you write: search the product for what bears on the page.",
    "Never turn a working interpretation into agreement, or an unconfirmed assumption into a settled one.",
    "When a detail is not established, name the limit or leave it out.",
    "Honour a source's own quoting rules: when an agreement, consent note or the source's metadata limits naming people, attribute by role (\"an operations lead at one customer\") and never name them.",
    "A derived view, digest or analysis is not direct evidence. When a page rests on one, say so beside the claim (\"analysis, not evidence\").",
    "A plan is the team's, not the sources'. When a person gives you dates or an order of delivery, use them, say on the page that they are a plan or a proposal, and record in the page's notes who set them and when.",
    "A Story is often read outside the team. Before the first page, look for an agreement or consent note among the sources that limits naming an organisation, its people or its figures, and follow it on every page.",
  ],
};

export const CHECKLIST = [
  { check: "Style", question: "Does the page follow the product's Story style (published with body, or with the stylesheet pasted in), and not WhatBuild's app look?" },
  { check: "Audience and purpose", question: "Does the opening give this reader the one thing they need first?" },
  { check: "Evidence and interpretation", question: "Is every observation true to the sources, every interpretation labelled, and the page free of source references a reader does not need?" },
  { check: "Design passes", question: "Did you run critique, typeset, layout, adapt and polish (with a design skill if you have one), and look at the page's preview at desktop and phone width, in light and dark?" },
  { check: "Anti-patterns", question: "Is the page free of every item in anti_patterns?" },
  { check: "Structure and access", question: "One h1, logical headings, labelled tables, links that say where they go, AA contrast, no colour-only meaning, readable at 390px?" },
  { check: "Publishing", question: "Did you read the current version, pass its etag, and place the page in the hierarchy (unless your instructions say not to)?" },
];

export const WORKFLOW = [
  "Read the outcomes, the relevant sources, assumptions and mockups first.",
  "Settle the Story style (style_workflow) before the first page, and read it before every page.",
  "Read the current version of the page and its notes for agents (get_page → agent_notes) before revising it, keep what is useful, and pass its etag.",
  "On a later version send only what changes: the title, summary and html you omit carry forward from the current version. patch_html fixes a sentence by exact find and replace; from_version restores an earlier version as a new one. Compare html_sha256 to confirm identical HTML.",
  "Publish with body: only the markup inside <body>. WhatBuild wraps it in a document with the product's Story style, so you never send the stylesheet and every page carries the same one. Send html only for a whole document of your own.",
  'Preview before you publish: send the same call to story(action="preview"). It refuses what publish would refuse, publishes nothing, and returns a grant to GET the exact page publish would store. Look at it at desktop and phone width, in light and dark, then send the same params to publish.',
  "Use the hierarchy to find related pages; give each page a short lower-case page_id; link related pages inline, and link the pages beneath a page from it (nav.pages).",
  "summary describes the page itself and shows in navigation. Keep mechanics — which sources a page rests on, ids, what is still to fold in — in the notes for agents; the activity log already records each version.",
  "Publishing does not place a page: set_hierarchy does, with its own etag. Place each new page unless your instructions say otherwise; then leave it unplaced and say so.",
  "After publishing, update the page's notes for agents with write_notes: its purpose, what is still to fold in, and choices about its structure. publish returns agent_notes_etag; while the notes are empty you may omit the etag.",
  "Archiving a page takes it out of navigation and promotes its sub-pages; restoring returns it unplaced.",
];

export const CONTENT_RULES = [
  "Explain the outcomes, current understanding, choices and next steps.",
  "Write for a busy stakeholder.",
  "Name the few assumptions that shape the account, and say whether each is confirmed.",
  "Explain in your own words. Quote a source only where its exact words matter, and leave source and passage links out: the evidence stays in Evidence.",
  "Separate observed evidence, interpretation and agreement.",
  "Never invent agreement, owners, dates, commitments or measurements.",
  "Leave breadcrumbs and navigation to the reader: the app provides them.",
];

export { VOCABULARY };

/** A starter page in a given stylesheet: the opening and one section, ready to replace. */
export function starterHtml(stylesheet: string, title = "REPLACE: page title") {
  return pageDocument(
    title,
    stylesheet,
    `<main class="page">
<header class="opening"><h1>REPLACE: the conclusion in one line</h1><p class="lead">REPLACE: why it matters to this reader.</p><p class="meta">Updated REPLACE_DATE · Working interpretation</p></header>
<section aria-labelledby="s1"><h2 id="s1">REPLACE: what this section shows, as a statement</h2><p>REPLACE</p></section>
</main>`,
  );
}
