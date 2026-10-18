/**
 * House styles for Story pages: complete, named design systems an agent can adopt for a product
 * when the team has no design system of its own. None of them is WhatBuild's app look. A Story is
 * the team's document, often read outside the team, so it should look like theirs.
 *
 * Every house style styles the same small semantic vocabulary (VOCABULARY), so content moves
 * between styles unchanged, and each adds signature moves of its own. The vocabulary is a floor,
 * not a ceiling: agents are expected to compose beyond it within a style's character.
 *
 * A page can make no network request, so a style's type is either a system font stack or a face
 * WhatBuild carries (story-fonts.ts), which the server embeds when it shows the page. Each style
 * carries a light and a dark scheme and follows the app's theme through THEME_ATTRIBUTE on <html>.
 * The styles live in house-styles/, one per file.
 */

import { HOUSE_STYLES } from "./house-styles/index.ts";
import { BASE, faces, schemes, type HouseStyle } from "./house-styles/kit.ts";

export { HOUSE_STYLES };
export type { HouseStyle } from "./house-styles/kit.ts";

/** A generated title page carries no typeface of its own: a system serif. */
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, serif';

/** The stylesheet of a generated title page in a product with no Story style: plain and readable, in no one's look. */
export const PLAIN_STYLESHEET = `${schemes(
  { "--paper": "#ffffff", "--ink": "#1a1a1a", "--muted": "#555555", "--focus": "#1a1a1a" },
  { "--paper": "#161616", "--ink": "#e9e9e9", "--muted": "#b0b0b0", "--focus": "#e9e9e9" },
)}${faces({ text: SERIF })}${BASE}
body { margin: 0; background: var(--paper); color: var(--ink); font: 1.125rem/1.6 var(--text); }
.page { max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem; }
h1 { margin: 0 0 1rem; font-size: clamp(2rem, 5vw, 2.75rem); line-height: 1.1; text-wrap: balance; }
.lead { margin: 0; font-size: 1.25rem; color: var(--muted); }
`;

export const HOUSE_STYLE_IDS = HOUSE_STYLES.map((s) => s.id) as [HouseStyle["id"], ...HouseStyle["id"][]];

export function houseStyle(id: string): HouseStyle | undefined {
  return HOUSE_STYLES.find((s) => s.id === id);
}

/** The shared vocabulary every house style styles. */
export const VOCABULARY = [
  { element: `<main class="page">`, role: "The page container." },
  { element: `<header class="opening">`, role: "Opening: .kicker, h1 (the conclusion), .lead (why it matters), .meta (date, status)." },
  { element: "<section> with an h2", role: "One job per section. h3 for subheads." },
  { element: `<figure class="quote"><blockquote>…</blockquote><figcaption>…</figcaption></figure>`, role: "A quotation set apart from the text, with an optional caption under it." },
  { element: `<aside class="note">`, role: "A side note: a limit, a definition, or what the page rests on." },
  { element: `<aside class="callout" data-tone="caution">`, role: "Something that changes how the page should be read. Say its status in words." },
  { element: `<span class="status" data-state="evidence|caution|open">`, role: "A state label; the text always names the state." },
  { element: `<div class="figures"><p class="figure"><strong>23</strong> what was counted</p></div>`, role: "Real numbers with what they count." },
  { element: `<div class="columns"><article>…</article></div>`, role: "Comparable alternatives side by side." },
  { element: `<div class="table-wrap" role="region" aria-label="…" tabindex="0"><table>…</table></div>`, role: "Every table, so it scrolls inside itself on a phone." },
  { element: `<ol class="steps">`, role: "Ordered next steps with a real order." },
  { element: `<section class="wide">`, role: "A section whose content needs the page's full width: a timeline, a matrix, a line per item. In a style with a label column, prose stays in the text column and the blocks run full width." },
  { element: `<h2 data-label="…">`, role: "A short label set above or beside a section's heading, when it carries something the heading does not: a date, a release, a stage." },
  { element: `<ol class="timeline"><li><time datetime="2026-11">November 2026</time><strong>What is delivered</strong><p>…</p></li></ol>`, role: "Dated milestones in order: a release plan, a roadmap, the stages of a study. Two to four. Mark a milestone already reached with data-state=\"done\", and the one the team is working towards with aria-current=\"step\"." },
  { element: `<ul class="lines"><li><strong>Name</strong><span>What it means for the reader.</span><span class="tag">Group</span></li></ul>`, role: "One line per item, in aligned columns: features, risks, requirements. The last element (a .tag or a .status) is optional." },
  { element: `<dl class="facts"><dt>In scope</dt><dd>…</dd></dl>`, role: "Labelled facts about one thing: scope, what it serves, how it is measured." },
  { element: `<nav class="pages" aria-label="…"><ul><li><a href="…"><strong>Page title</strong><span>What the page holds.</span></a></li></ul></nav>`, role: "Links to other Story pages, each with a line on what it holds: the pages beneath a landing page, or where to read next." },
  { element: "<details><summary>", role: "Optional method detail; never hide a consequential caveat." },
  { element: "<mark>", role: "The words that matter inside a quotation or a sentence. A few words, once or twice a page." },
  { element: `<div class="quotes"><figure class="quote">…</figure><figure class="quote">…</figure></div>`, role: "Several quotations side by side: many voices on one theme." },
  { element: `<ol class="flow"><li><strong>Step</strong><span>What happens in it.</span></li></ol>`, role: "A process or a journey in order, three to six steps, drawn with arrows between them. A step may end with a .tag." },
  { element: `<figure class="diagram"><svg viewBox="…" role="img" aria-labelledby="…"><title id="…">…</title>…</svg><figcaption>…</figcaption></figure>`, role: "A flowchart or a structure drawn as inline SVG. Give shapes class node (node key for the one that matters), lines class edge with an arrowhead marker whose path is class head, and text class label (label small, label on-key). The style colours them and sets their type; on a phone the diagram scrolls inside itself." },
  { element: `<figure class="shot" data-device="phone|desktop"><div class="screen"><img src="data:…" alt="…"><span class="pin" style="--x: 40%; --y: 20%">1</span></div><figcaption><p>…</p><ol class="pins"><li>…</li></ol></figcaption></figure>`, role: "A mockup or a part of one, framed as a screen, with numbered pins placed by percentage and explained in order in ol.pins. The image or SVG inside keeps the mockup's own look." },
  { element: `<span class="tally" style="--n: 14; --of: 23" role="img" aria-label="14 of 23"></span>`, role: "A count drawn as marks, n filled of the whole, beside the number written out. Up to about 40." },
];

/** The sample product's crew message, as a mockup snippet for the specimen: its own look, not the style's. */
const SPECIMEN_PHONE = `<svg viewBox="0 0 320 600" role="img" aria-labelledby="shot-title" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
<title id="shot-title">The message Crew B receives for the week of 16 November: three jobs with their times, addresses and gate codes, and a button to confirm the week.</title>
<rect width="320" height="600" fill="#f6f5f1"/>
<text x="22" y="27" font-size="12" font-weight="600" fill="#1c2321">8:02</text>
<rect y="42" width="320" height="78" fill="#1f3d34"/>
<text x="22" y="71" font-size="11" font-weight="600" letter-spacing="1" fill="#b9d3c5">CREWBOARD</text>
<text x="22" y="99" font-size="19" font-weight="700" fill="#ffffff">Crew B · week of 16 Nov</text>
<text x="22" y="152" font-size="11" font-weight="700" letter-spacing="0.8" fill="#5b6461">MONDAY 16</text>
<rect x="16" y="162" width="288" height="86" rx="10" fill="#ffffff" stroke="#e2e0d8"/>
<text x="32" y="189" font-size="15" font-weight="700" fill="#1c2321">8:00 · Alder Street 14</text>
<text x="32" y="211" font-size="13" fill="#5b6461">Hedges and lawn, 2 h</text>
<text x="32" y="233" font-size="13" font-weight="700" fill="#1f3d34">Gate code 2291</text>
<rect x="16" y="258" width="288" height="64" rx="10" fill="#ffffff" stroke="#e2e0d8"/>
<text x="32" y="285" font-size="15" font-weight="700" fill="#1c2321">11:30 · Fernhill Park</text>
<text x="32" y="307" font-size="13" fill="#5b6461">North gate, mowing, 3 h</text>
<text x="22" y="356" font-size="11" font-weight="700" letter-spacing="0.8" fill="#5b6461">TUESDAY 17</text>
<rect x="16" y="366" width="288" height="86" rx="10" fill="#ffffff" stroke="#e2e0d8"/>
<text x="32" y="393" font-size="15" font-weight="700" fill="#1c2321">9:00 · Harbor Road 3</text>
<text x="32" y="415" font-size="13" fill="#5b6461">New client, first visit</text>
<text x="32" y="437" font-size="13" font-weight="700" fill="#1f3d34">Gate code 0418</text>
<rect x="16" y="522" width="288" height="52" rx="26" fill="#1f3d34"/>
<text x="160" y="553" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle">Confirm my week</text>
</svg>`;

/** A flowchart in the shared diagram classes, which every style colours and sets in its own type. */
const SPECIMEN_DIAGRAM = `<svg viewBox="-6 -6 772 274" role="img" aria-labelledby="dg-title">
<title id="dg-title">When a crew lead replies: a confirmed week is locked; a flagged change goes to the office, which sends an updated message.</title>
<defs><marker id="dg-head" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path class="head" d="M0 0L10 5L0 10z"/></marker></defs>
<path class="edge" d="M150 120H200" marker-end="url(#dg-head)"/>
<path class="edge" d="M260 76V46H388" marker-end="url(#dg-head)"/>
<path class="edge" d="M260 164V194H388" marker-end="url(#dg-head)"/>
<path class="edge" d="M560 46H598" marker-end="url(#dg-head)"/>
<path class="edge" d="M560 194H598" marker-end="url(#dg-head)"/>
<path class="edge" d="M680 222V250H75V150" marker-end="url(#dg-head)"/>
<rect class="node" x="0" y="92" width="150" height="56" rx="6"/>
<text class="label" x="75" y="125" text-anchor="middle">Message sent</text>
<path class="node" d="M260 76L318 120L260 164L202 120Z"/>
<text class="label" x="260" y="125" text-anchor="middle">Reply</text>
<rect class="node" x="390" y="18" width="170" height="56" rx="6"/>
<text class="label" x="475" y="51" text-anchor="middle">Week confirmed</text>
<rect class="node" x="600" y="18" width="160" height="56" rx="6"/>
<text class="label" x="680" y="51" text-anchor="middle">Crew’s week locked</text>
<rect class="node key" x="390" y="166" width="170" height="56" rx="6"/>
<text class="label on-key" x="475" y="199" text-anchor="middle">Change flagged</text>
<rect class="node" x="600" y="166" width="160" height="56" rx="6"/>
<text class="label" x="680" y="199" text-anchor="middle">Office updates it</text>
<text class="label small" x="272" y="36">confirms</text>
<text class="label small" x="272" y="214">flags a change</text>
<text class="label small" x="306" y="242">an updated message goes out</text>
</svg>`;

/**
 * A synthetic specimen page for previews: the front page of the sample product's release plan, in
 * the shared vocabulary. It holds what a stakeholder Story holds (a plan, the pages beneath it, a
 * flow, a diagram, a mockup, the evidence, a decision) so a style shows how it carries each.
 */
export function specimenBody(): string {
  return `<main class="page">
<header class="opening">
<h1>Three releases take the typing out of a crew’s week</h1>
<p class="lead">Crew leads lose an afternoon building next week’s plan, but the mistakes that reach clients come later, when the plan is typed out to each crew by hand. From November to March, Crewboard removes that step first.</p>
<p class="meta">Release plan · Updated 12 October 2026 · A proposal: the months are the team’s plan, not a commitment</p>
</header>
<section aria-labelledby="glance">
<h2 id="glance">Most crew leads plan once a week, and send it by hand</h2>
<div class="figures">
<p class="figure"><strong>19 of 23</strong> crew leads in the survey plan the week in one sitting</p>
<p class="figure"><strong>2.5 h</strong> median time a crew lead spends planning a week</p>
<p class="figure"><strong>1 a week</strong> wrong address reaching a crew, as one crew lead estimates it</p>
</div>
<aside class="note">From two interviews, notes from an owner call and a survey 23 of 41 crew leads answered. Every person and company in this sample is invented.</aside>
</section>
<section class="wide" aria-labelledby="plan">
<h2 id="plan" data-label="Release plan">Each release removes one step where mistakes enter</h2>
<p>Every release goes to two pilot crews first. A step moves only when the pilots say the one before it works.</p>
<ol class="timeline">
<li data-state="done"><time datetime="2026-09">September 2026</time><strong>Discovery round</strong><p>Two interviews, an owner call and a survey of crew leads.</p></li>
<li aria-current="step"><time datetime="2026-11">November 2026</time><strong>One message per crew</strong><p>Each crew lead gets their week, generated from the plan.</p></li>
<li><time datetime="2027-01">January 2027</time><strong>Confirm and flag</strong><p>Crew leads confirm the week or flag a change for the office.</p></li>
<li><time datetime="2027-03">March 2027</time><strong>Late jobs from a phone</strong><p>A late booking placed in minutes, with what it moves shown.</p></li>
</ol>
<ul class="lines">
<li><strong>Message from the plan</strong><span>No one types a crew’s week out by hand again.</span><span class="tag">Release 1</span></li>
<li><strong>Confirm and flag</strong><span>The office knows by Sunday which weeks still need a change.</span><span class="tag">Release 2</span></li>
<li><strong>Late jobs from a phone</strong><span>A late booking no longer means rebuilding the week.</span><span class="tag">Release 3</span></li>
<li><strong>Planning grid</strong><span>Waits until we know whether crew leads plan by the job or by the day.</span><span class="status" data-state="open">Not scheduled</span></li>
</ul>
</section>
<section aria-labelledby="epics">
<h2 id="epics" data-label="Epics">Each release has a page of its own</h2>
<p>What it delivers, the evidence behind it, and what would change it.</p>
<nav class="pages" aria-label="The releases, a page each"><ul>
<li><a href="#flow"><strong>Message from the plan</strong><span>What a crew lead receives, and how it is built from the plan.</span><span class="tag">Release 1 · November</span></a></li>
<li><a href="#reply"><strong>Confirm and flag</strong><span>What happens when a crew lead replies, and who acts on it.</span><span class="tag">Release 2 · January</span></a></li>
<li><a href="#heard"><strong>Late jobs from a phone</strong><span>Placing a late booking without rebuilding the week.</span><span class="tag">Release 3 · March</span></a></li>
</ul></nav>
</section>
<section aria-labelledby="flow">
<h2 id="flow" data-label="Release 1">The plan reaches each crew without being typed again</h2>
<p>The Friday planning stays as it is. What changes is everything after it.</p>
<ol class="flow">
<li><strong>Plan the week</strong><span>Friday afternoon, in Crewboard.</span></li>
<li><strong>Messages are built</strong><span>One per crew, from the plan itself.</span></li>
<li><strong>Crew lead reads it</strong><span>Jobs, times, addresses and gate codes.</span></li>
<li><strong>Confirm or flag</strong><span>A reply the office can act on.</span><span class="tag">Release 2</span></li>
</ol>
<figure class="shot" data-device="phone">
<div class="screen">${SPECIMEN_PHONE}<span class="pin" style="--x: 88%; --y: 14%">1</span><span class="pin" style="--x: 66%; --y: 38.5%">2</span><span class="pin" style="--x: 88%; --y: 91.5%">3</span></div>
<figcaption><p>Mockup: Crew message, version 3</p>
<ol class="pins">
<li><strong>One crew, one message.</strong> An owner asked for exactly this instead of a group thread everyone scrolls.</li>
<li><strong>Gate codes travel with the job.</strong> A wrong gate code is one of the mistakes a crew lead named.</li>
<li><strong>Confirming is one tap.</strong> It arrives in Release 2; until then the button is hidden.</li>
</ol></figcaption>
</figure>
</section>
<section aria-labelledby="reply">
<h2 id="reply" data-label="Release 2">A flagged change goes to the office, not to a group chat</h2>
<figure class="diagram">${SPECIMEN_DIAGRAM}<figcaption>What happens to a reply. A proposal: the office’s side has not been tested with anyone yet.</figcaption></figure>
</section>
<section aria-labelledby="heard">
<h2 id="heard" data-label="Evidence">Crew leads call the hand-off, not the planning, the painful part</h2>
<div class="quotes">
<figure class="quote"><blockquote><p>The texts are the worst part honestly. Every crew lead gets a message with their jobs and addresses, and <mark>I type those by hand</mark>.</p></blockquote><figcaption>Crew lead, landscaping · interview</figcaption></figure>
<figure class="quote"><blockquote><p><mark>Sending everybody their day</mark> is what takes forever.</p></blockquote><figcaption>Open comment · planning survey, spring round</figcaption></figure>
<figure class="quote"><blockquote><p>I added a column that says CONFIRMED but <mark>half the time nobody fills it in</mark>.</p></blockquote><figcaption>Crew lead, landscaping · second interview</figcaption></figure>
</div>
<p><span class="tally" style="--n: 14; --of: 23" role="img" aria-label="14 of 23"></span> <strong>14 of 23</strong> crew leads in the survey plan in a spreadsheet, 5 on paper and 4 in scheduling software; three of those four still keep a spreadsheet “for the real plan”.</p>
</section>
<section aria-labelledby="first">
<h2 id="first">What ships first, and what waits for evidence</h2>
<div class="columns">
<article><h3>In Release 1</h3><p>A message per crew, generated from the plan and sent to the two pilot crews. <span class="status" data-state="evidence">Decided</span></p></article>
<article><h3>Waiting for evidence</h3><p>The planning grid. One crew lead plans by the day and one owner by days and people, so we do not yet know the shape it needs. <span class="status" data-state="open">Not yet tested</span></p></article>
</div>
<div class="table-wrap" role="region" aria-label="What each release changes" tabindex="0"><table><caption>What each release changes</caption><thead><tr><th scope="col">Release</th><th scope="col">For crew leads</th><th scope="col">For the office</th><th scope="col">Evidence</th></tr></thead><tbody>
<tr><th scope="row">1 · November</th><td>The week arrives as one message</td><td>Nothing to type on Friday evening</td><td><span class="status" data-state="evidence">Two interviews</span></td></tr>
<tr><th scope="row">2 · January</th><td>Confirm or flag in one tap</td><td>Sees which weeks still need a change</td><td><span class="status" data-state="caution">One interview</span></td></tr>
<tr><th scope="row">3 · March</th><td>Place a late job from a phone</td><td>Sees what a late job moves</td><td><span class="status" data-state="open">Not yet tested</span></td></tr>
</tbody></table></div>
<aside class="callout" data-tone="caution"><p><strong>Assumption, unconfirmed.</strong> Crew leads think in jobs rather than days. If most plan by the day, the message needs a day-first shape, and Release 1 changes with it.</p></aside>
</section>
<section aria-labelledby="next">
<h2 id="next">Before Release 1 ships, two questions get answers</h2>
<dl class="facts">
<dt>In scope</dt><dd>The message each crew receives, and how it is built from the plan.</dd>
<dt>Out of scope</dt><dd>The planning grid itself, until the jobs-or-days question is settled.</dd>
<dt>Measured by</dt><dd>A week with no job missed or double-booked, across both pilot crews.</dd>
</dl>
<ol class="steps">
<li><strong>Prototype the message</strong> from a real week’s plan, and read it through with both pilot crews.</li>
<li><strong>Interview two more owners</strong> of cleaning crews about whether they plan by the job or by the day.</li>
</ol>
<details><summary>How we know this</summary><p>Counts come from the survey export; the once-a-week mistake rate is one crew lead’s estimate, not a measurement.</p></details>
</section>
</main>`;
}

/** A complete page: a stylesheet around a body. */
export function pageDocument(title: string, stylesheet: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</title>
<style>
${stylesheet}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function houseSpecimen(style: HouseStyle): string {
  return pageDocument(`${style.name}: a Story page specimen`, style.stylesheet, specimenBody());
}

/** The page the app previews a product's Story style on: its own specimen, or the sample page in its stylesheet. */
export function styleSpecimen(s: { name: string; stylesheet: string; specimen_html: string | null }): string {
  return s.specimen_html ?? pageDocument(`${s.name}: a Story page specimen`, s.stylesheet, specimenBody());
}
