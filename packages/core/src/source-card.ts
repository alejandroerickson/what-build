/**
 * A source's card: a picture of the source that people recognise it by. It heads the source in the
 * Evidence preview and on its page, and it is the source's thumbnail in the list when the source
 * carries no picture of its own (an image, a deck's slide, a PDF's page, a video's frame). Its text
 * beside it is the source's summary, which agents and search read.
 *
 * A card is the same kind of HTML as an Idea card's front (the markup inside the card, held to
 * IDEA_CARD_RULES at write and served in the card kit's document, in its sandbox), drawn on a board
 * of one fixed size, which the app scales to fit: a few centimetres in the list, most of the
 * preview's width beside it. So it is drawn to be told apart at a glance from its neighbours, not to
 * be read.
 */

import { CARD_HTML_MAX } from "./html-rules.ts";
import { CARD_ICON_NAMES, frontWords, loose, styling } from "./idea-card.ts";

/** The board a source's card is drawn on: 4:3, the shape of every face in the Evidence list. */
export const SOURCE_CARD_FRAME = { width: 640, height: 480, thumb_width: 64 } as const;

/** About how many words a source's card holds before it reads as text rather than a picture. */
const SOURCE_CARD_WORDS = 24;

/**
 * Advice on a source's card that was written or previewed: what the guidance asks that WhatBuild can
 * check, and the card misses. It never refuses a write.
 */
export function adviseSourceCard(card: { front: string; title?: string; summary?: string | null }): string[] {
  const { front } = card;
  if (!front.trim()) return [];
  const advice: string[] = [];
  const words = frontWords(front).length;
  if (words > SOURCE_CARD_WORDS * 1.5)
    advice.push(`The card has ${words} words. At the size of a thumbnail words are grey lines, and the summary already says them: keep to about ${SOURCE_CARD_WORDS}, in a few large labels, and let the shapes carry it.`);
  if (card.title && loose(card.title).length >= 12 && loose(frontWords(front).join(" ")).includes(loose(card.title)))
    advice.push("The card repeats the source's title, which every list and preview shows beside it. Use the room for the picture.");
  if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i.test(styling(front)))
    advice.push("The card sets fixed colours, which do not follow the reader's light or dark theme. Use data-hue and the kit's variables (var(--hue-ink), var(--hue-fill), var(--hue-line), var(--hue-solid), var(--muted)).");
  if (!/<svg|<style|\sstyle\s*=|class\s*=\s*["'][^"']*wb-(?:flow|shift|measure|spectrum|loop|timeline|compare|who|zone|chips)/i.test(front))
    advice.push("The card has no drawing: no SVG, no style of its own and no kit part, so in the list it reads as a few lines of text. Draw the one thing that sets this source apart.");
  if (card.summary === null)
    advice.push('The source has no text summary. Write one too (derived_write(action="write_note", note_kind="summary")): agents, search and anyone using a screen reader read it, and the preview shows it under the card.');
  return advice;
}

/**
 * Cards drawn on the board, which the guidance shows whole: each a different shape, as a product's
 * sources should be. They are checked like any card, so an example never teaches what a write would
 * refuse or advise against. Their content is sample content.
 */
export const SOURCE_CARD_EXAMPLES = {
  // An interview whose news is one collision: two crews on one slot.
  clash: `<style>
.clash{display:grid;grid-template-columns:1fr 1.25fr;gap:28px;height:100%;align-items:center}
.clash .day{display:grid;grid-template-rows:repeat(5,1fr);gap:8px;height:100%}
.clash .day i{border-radius:10px;background:var(--wash);box-shadow:inset 0 0 0 2px var(--line-2)}
.clash .day i.hit{position:relative;background:var(--hue-fill);box-shadow:inset 0 0 0 3px var(--hue-solid)}
.clash .day i.hit::after{content:"";position:absolute;inset:10px -18px -14px 18px;border-radius:10px;background:var(--hue-solid);opacity:.85}
.clash b{display:block;font-size:150px;line-height:.9;font-weight:700;letter-spacing:-.05em;color:var(--hue-solid)}
.clash span{display:block;margin-top:14px;font-size:30px;font-weight:600;line-height:1.1}
</style>
<div class="clash" data-hue="rose">
  <div class="day" aria-hidden="true"><i></i><i></i><i class="hit"></i><i></i><i></i></div>
  <div><b>×2</b><span>One crew, booked twice</span></div>
</div>`,
  // A survey whose news is a share: most of the dots are one colour.
  share: `<style>
.share{display:flex;flex-direction:column;justify-content:space-between;height:100%}
.share ol{display:grid;grid-template-columns:repeat(8,1fr);gap:14px;margin:0;padding:0;list-style:none}
.share li{aspect-ratio:1;border-radius:50%;background:var(--line-2)}
.share li.yes{background:var(--hue-solid)}
.share p{font-size:40px;font-weight:600;line-height:1.05;letter-spacing:-.02em;max-width:none}
.share p b{color:var(--hue-ink)}
</style>
<div class="share" data-hue="teal">
  <ol aria-hidden="true">
    <li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li>
    <li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li><li class="yes"></li>
    <li class="yes"></li><li></li><li></li><li></li><li></li><li></li><li></li>
  </ol>
  <p><b>17 of 23</b> plan on paper</p>
</div>`,
  // A call whose news is one thing said: the words, large, on a field of the hue.
  voice: `<style>
.voice{display:grid;align-content:center;height:calc(100% + 2 * var(--pad));margin:calc(-1 * var(--pad));padding:48px;background:var(--hue-fill);color:var(--hue-ink)}
.voice q{display:block;font-size:52px;font-weight:700;line-height:1.02;letter-spacing:-.03em;quotes:"\\201C" "\\201D"}
.voice q::before{display:block;height:70px;font-size:150px;line-height:1;color:var(--hue-solid)}
.voice q::after{content:none}
</style>
<div class="voice" data-hue="amber"><q>Slow answers lose me jobs</q></div>`,
} as const;

/** How to draw a source's card, as derived_read(action="card_guidance") gives it. */
export const SOURCE_CARD_GUIDANCE = `# Drawing a source's card

A source's **card** is a picture of it that people recognise it by. It heads the source in the Evidence preview and on its page, and it is the source's thumbnail in the list whenever the source carries no picture of its own (a photo, a deck's slide, a PDF's page or a video's frame wins, since that is the thing itself). Its words beside it are the source's **summary**, the text agents, search and screen readers read, which the preview shows under the card.

Write both: the summary with \`derived_write(action="write_note", note_kind="summary")\`, the card with \`note_kind="card"\`. Each has its own etag. A source that has a summary and no card reads in the list as a small page of grey lines, like every other source with text; a card is what lets someone find it again by looking.

## What a card is for

Someone glances down the Evidence list, or squints at it, and knows which source is which before reading any title: the one with the two crews on one slot, the one that is mostly teal dots, the one with the big quote. A card is a **memory hook**, not a summary drawn as boxes. It shows the one thing this source says that no other source in the product says, as a shape the eye keeps.

It is drawn on a board of ${SOURCE_CARD_FRAME.width} × ${SOURCE_CARD_FRAME.height} pixels (4:3) and scaled to fit: about ${SOURCE_CARD_FRAME.thumb_width}px wide in the list, a tenth of its size, and most of the preview's width beside it, larger than drawn. So draw it to work at a tenth: what is left at that size is the outline, the big shapes, one or two colours, and perhaps one huge number or word. Everything smaller is a grey smudge there, and only a bonus in the preview.

## How to draw one

1. **Read the source first,** its derived text and its summary, and list the other sources in the product (\`sources_read(action="list", include_summary=true)\`), with the cards they have. A card is only memorable against its neighbours.
2. **Say in a few words the one thing that sets this source apart.** Not its kind (an interview, a survey): every source is one. Its finding, its number, its moment, its voice. "One crew booked twice." "17 of 23 still plan on paper." "Slow answers lose him jobs."
3. **Find the shape that carries it, and think of three before you draw one.** A share is a field of dots, most of them one colour. A collision is two blocks on one slot. A drop is a line falling off a cliff. A wait is a long bar beside a short one. A voice is its words, huge. A place is a map with one pin. A before and after is grey against colour. A list of complaints is a stack, one of them red. Pick the one that would still say it with its words covered.
4. **Make it unlike the product's other cards.** Different shape, different layout, a different hue where you can (teal, amber, rose, green, sky, indigo, slate). Two sources that say the same kind of thing may share a shape; then vary the hue and the composition. If your card would sit in the list beside another that looks alike, redraw it.
5. **Fill the board.** Shapes that run to its edges, a field of colour, one dominant element. A small drawing in the middle of white space vanishes at a tenth of its size.
6. **Few words, very large:** a number, or a label of two to six words, at 30 to 150 pixels. No sentences, no paragraphs, no list of findings: the summary holds those. Never repeat the title, which is always shown beside the card.
7. **Look at it before you write it.** \`derived_read(action="card_preview")\` makes every check a write makes and gives a short-lived link to the card as the app shows it. Open it at ${SOURCE_CARD_FRAME.width} × ${SOURCE_CARD_FRAME.height}, light and dark, and look at it again shrunk to ${SOURCE_CARD_FRAME.thumb_width}px wide (a screenshot scaled down will do). If at that size it is a grey rectangle, or looks like its neighbours, draw it again. If you cannot see it at all, say so rather than say you checked it.
8. **Send it,** and fix what any \`card_advice\` in the response names with another write.

## Three drawn cards

Read these for how a card is told apart, then draw your own: copying one makes the list as alike as text would. Their content is sample content.

**A collision** (an interview where a client was booked twice): the day as slots, one of them hit twice, and the count, huge.
\`\`\`html
${SOURCE_CARD_EXAMPLES.clash}
\`\`\`

**A share** (a survey): one dot for each answer, those that said yes in the hue. The shape is the finding.
\`\`\`html
${SOURCE_CARD_EXAMPLES.share}
\`\`\`

**A voice** (a call): the one thing said, in the speaker's words, on a field of colour that fills the board. Unattributed: no name, which the source holds.
\`\`\`html
${SOURCE_CARD_EXAMPLES.voice}
\`\`\`

## What a card is made of

The same as an Idea card's front, in the same kit: only the markup inside the card, which WhatBuild wraps in a document with the kit's type, greys and diagram palette, in the reader's light or dark theme, in a sandbox. Up to ${CARD_HTML_MAX.toLocaleString("en-US")} characters.

- The board is the card: \`.wb-card\` is exactly ${SOURCE_CARD_FRAME.width} × ${SOURCE_CARD_FRAME.height}, with \`var(--pad)\` (22px) of padding, and nothing outside it shows. Give your outermost element \`height:100%\` to use all of it, or a margin of \`calc(-1 * var(--pad))\` with \`height:calc(100% + 2 * var(--pad))\` to bleed to the edges.
- Colour from the kit's variables, which follow the theme: \`var(--bg)\`, \`--ink\`, \`--muted\`, \`--faint\`, \`--line\`, \`--line-2\`, \`--wash\`; \`--hue-fill\`, \`--hue-ink\`, \`--hue-line\`, \`--hue-solid\` for the hue \`data-hue\` sets; \`--<hue>-solid\` and so on for one by name. Fixed colours break in the dark theme.
- HTML and CSS draw well: grids of marks, bars, blocks, gradients. Inline SVG for lines and curves, with \`aria-hidden="true"\` when the words beside it say what it shows. The kit's parts (the Idea card guidance, \`outcomes_read(action="card_guidance")\`, lists them) work here too, though they are drawn to be read, not glanced at.
- No scripts, event handlers, links, forms, or anything loaded from elsewhere (images and fonts only as \`data:\` URIs). Pictograms with \`data-icon\` (the names \`card_guidance\` lists). A refusal (\`invalid_card\`) lists every problem at once.

## Taste

- **One idea, one shape, one hue,** with slate or grey for the rest. Rose for what hurts, sparingly.
- **True to the source.** A number on the card is one the source gives; a quote is words it holds. Draw the finding, never a claim of your own.
- **No decoration:** no pictogram for the kind of source (a microphone for an interview, a clipboard for a survey), no frame, no heading, no date, no logo. Those make every card alike.
- **Different from its neighbours,** above everything else here.
`;

/** What derived_read(action="card_guidance") gives with the guidance. */
export function sourceCardGuidance() {
  return { guidance: SOURCE_CARD_GUIDANCE, icons: [...CARD_ICON_NAMES], frame: SOURCE_CARD_FRAME, max_chars: CARD_HTML_MAX };
}
