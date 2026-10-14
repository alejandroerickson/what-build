---
name: WhatBuild
description: Studio, a quiet floating-panel workspace for product discovery evidence.
colors:
  canvas: "#f0f0f0"
  panel: "#ffffff"
  popover: "#ffffff"
  hover: "#f2f2f2"
  hover-strong: "#e6e6e6"
  select: "#ecebfd"
  select-text: "#3a33b8"
  line: "#e6e6e6"
  line-2: "#d5d5d5"
  line-strong: "#8a8a8a"
  text: "#1e1e1e"
  muted: "#555555"
  faint: "#666666"
  accent: "#5a53e8"
  accent-hover: "#4a43d6"
  accent-text: "#ffffff"
  ok: "#0f7440"
  warn: "#9a5b00"
  bad: "#c4321f"
  bad-hover: "#a92a19"
  bad-text: "#ffffff"
  skeleton: "#ebebeb"
  avatar-bg: "#e3d9c8"
  avatar-text: "#3a2b10"
  canvas-dark: "#1b1b1b"
  panel-dark: "#2a2a2a"
  popover-dark: "#323232"
  hover-dark: "#353535"
  hover-strong-dark: "#414141"
  select-dark: "#34325a"
  select-text-dark: "#c9c6ff"
  line-dark: "#383838"
  line-2-dark: "#474747"
  line-strong-dark: "#858585"
  text-dark: "#ededed"
  muted-dark: "#bdbdbd"
  faint-dark: "#adadad"
  accent-dark: "#8b85ff"
  accent-hover-dark: "#a09bff"
  accent-text-dark: "#15142b"
  ok-dark: "#62d394"
  warn-dark: "#f0b95e"
  bad-dark: "#ff8b7e"
  bad-hover-dark: "#ffa398"
  bad-text-dark: "#2a0d09"
  avatar-bg-dark: "#5a4a30"
  avatar-text-dark: "#f3e6cc"
typography:
  display:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  brand:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  lead:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  title:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.25
  subtitle:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.25
  prose:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.62
  reading:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  meta:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "999px"
spacing:
  s-0: "2px"
  s-1: "4px"
  s-1h: "6px"
  s-2: "8px"
  s-2h: "10px"
  s-3: "12px"
  s-3h: "14px"
  s-4: "16px"
  s-5: "20px"
  s-6: "24px"
  s-7: "28px"
  s-10: "40px"
  s-12: "48px"
  s-14: "56px"
  s-20: "80px"
  sheet-px: "18px"
  float-inset: "10px"
components:
  button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-active:
    backgroundColor: "{colors.hover-strong}"
  button-sm:
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "24px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    height: "28px"
  button-danger:
    backgroundColor: "{colors.bad}"
    textColor: "{colors.bad-text}"
    rounded: "{rounded.sm}"
    height: "28px"
  button-danger-hover:
    backgroundColor: "{colors.bad-hover}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    size: "28px"
  icon-button-sm:
    rounded: "{rounded.xs}"
    size: "24px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "28px"
  find-field:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 8px 0 26px"
    height: "28px"
  chip:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
    typography: "{typography.meta}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
    height: "24px"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 5px"
    height: "18px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "28px"
  nav-item-current:
    backgroundColor: "{colors.select}"
    textColor: "{colors.select-text}"
  segmented:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.sm}"
    padding: "2px"
  segmented-item-current:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.xs}"
    padding: "0 10px"
    height: "24px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    width: "264px"
  inspector:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    width: "272px"
  sheet:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
  list-row:
    textColor: "{colors.text}"
    padding: "11px 18px"
  menu:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px"
  show-pill:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    width: "58px"
    height: "32px"
  dialog:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    width: "520px"
  toast:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  callout:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  avatar:
    backgroundColor: "{colors.avatar-bg}"
    textColor: "{colors.avatar-text}"
    rounded: "{rounded.full}"
    size: "22px"
---

# Design System: WhatBuild

## Overview

**Creative North Star: "The Studio"**

One floating panel carries the product's whole story, Idea, Evidence, Exploration and Story in that order, and the content takes the rest of the canvas. Studio is a tool-maker's workspace: a light grey canvas (near-black in dark), white panels with 12px corners floating 10px in from the window edge, hairline rules, and a soft two-layer shadow. There is no top bar, no persistent rail beside the panel, and no app-level tab strip. One screen shows at a time, links are real links, and the browser owns tabs.

The system is dense and quiet. The UI runs at 12px in Inter; text people actually read (passages, quotes, Markdown) steps up to 13 to 13.5px. Hierarchy comes from weight (600) and grey steps rather than size, and nothing in the app is larger than 20px except the overview's intro. Indigo is the only chromatic voice in the chrome, reserved for selection, focus, primary commits and pointing at evidence. Status always pairs a small shaped mark with a word.

The panel can hide (a button or Ctrl/Cmd+\). The canvas widens in a single 200ms motion and a small floating pill with the mark takes its place. Item screens (a Story page, a mockup, a source) add a 272px inspector floating on the right, which hides and returns the same way: a button in its head or Shift+Ctrl/Cmd+\, and a square at the top-right inset in its place. A Story page is not part of Studio: it follows the product's own Story style (the company's design system or a house style) inside a sandboxed frame. Neither is a mockup's page, which carries its own look in the same kind of frame. On the Story and on a mockup (on a phone too), focus mode (F) hides both panels so the app falls away around the work; a Story page keeps its measure rather than widening, and Esc or F brings the panels back.

**Key Characteristics:**
- A 264px floating left panel and 272px floating inspector around one scrolling canvas (content max 900px; a mockup's canvas takes the full width).
- White-on-grey tonal layering; the shadow's 0.5px ring stands in for a panel border.
- Inter at 11 to 15px for the UI, 20px as the ceiling outside the overview's intro; 600 is the heading weight.
- 24px and 28px controls; radius steps 4, 6, 8, 12.
- Indigo for selection, focus, primary commits and evidence only.
- Lucide icons at 12 or 14px with a 1.75 stroke, through one glyph map.
- Light and dark are both first-class and resolved before first paint.

## Colors

A neutral grey studio with a single indigo accent and three status hues; every value lives in the token file, in a light and a dark set.

### Primary
- **Studio Indigo** (accent; accent-dark in dark): primary commit buttons, the focus ring (2px solid, 1px offset), the text caret, and the base of every accent tint.
- **Indigo Pressed** (accent-hover): hover on primary buttons. It darkens in light and lightens in dark.
- **Selection Wash** (select) with **Selection Ink** (select-text): the current nav item, text selection, and the colour of evidence tokens in prose. Evidence tokens and search highlights are accent mixed at 7 to 22% into transparent, not separate hues.

### Tertiary (status)
- **Evidence Green** (ok): positive status, reviewed, success toasts.
- **Caution Amber** (warn): attention status, such as unreviewed or changed since review.
- **Refusal Red** (bad, with bad-hover and bad-text): negative status, destructive buttons, field errors and invalid borders.

### Neutral
- **Canvas Grey** (canvas): the stage behind everything; nothing sits directly on it except floating surfaces.
- **Panel White** (panel) and **Popover** (popover): panels, sheets, dialogs and inputs; menus and toasts. In dark, popovers sit one step lighter than panels.
- **Hover** and **Hover Strong**: the hover fill for rows, nav and ghost controls, and the pressed fill. Hover also fills the search field, chips, segmented tracks and inset callouts.
- **Hairline** (line): every divider inside a surface. **Line 2** is the border on default buttons, tags and dark-mode menus. **Line Strong** is the input border and the underline colour on text links.
- **Ink** (text), **Muted** (muted) and **Faint** (faint): three text steps. Faint carries counts, meta lines, icons at rest and placeholders.
- **Avatar Sand** (avatar-bg with avatar-text): the one warm neutral, used only behind people's initials.

### Named Rules
**The Earned Accent Rule.** Indigo means "selected, focused, commit, or evidence". It never decorates, never fills a header, and never marks a category. A view carries at most one accent-filled button, usually the commit in a form or dialog, or Connect an agent in a first-use list. A sheet header's create action stays a default button, empty or not.

**The Mark And Word Rule.** Status is a 7px mark followed by a word, both in the status colour. The mark's shape carries the state on its own: a filled dot for positive, a ring for attention, a small diamond for negative, a spinning open arc for progress and a faint ring for neutral. Colour is never the only signal.

**The Two Schemes Rule.** Every colour token has a light and a dark value, and colour-mixed tokens are re-derived inside each theme scope. A new colour lands in both sets or it doesn't land.

## Typography

**UI Font:** Inter Variable (falling back to Inter, then system-ui)
**Mono Font:** the system monospace stack (ui-monospace, SF Mono, Menlo), used for codes, token prefixes and commands
**Story pages** carry their own type from their Story style; no Story face appears in the app.

**Character:** One humanist sans at small, exact sizes, in the manner of a design tool rather than a website. There is no display face, and one display line: the overview's question, in the same Inter. Titles earn their place with weight 600 and slight negative tracking.

### Hierarchy
- **Display** (600, 48px, 1.05, -0.035em; 36px on a narrow canvas): the overview's question, "What to build?", and nowhere else.
- **Brand** (600, 28px, 1, -0.02em; 22px on a narrow canvas): the overview's wordmark beside a 34px W mark, its page h1.
- **Headline** (600, 20px, 1.25, -0.01em): the h1 of an item screen, such as an assumption or a source.
- **Lead** (400, 15px, 1.55): a single summary paragraph above prose.
- **Title** (600, 14px, 1.25): the sheet title, which is the h1 of a list screen, followed by its count in faint 400.
- **Subtitle** (600, 12.5px): product name, inspector title, h3, panel section headings (in ink, so they stand above the filters and lists under them).
- **Prose** (400, 13.5px, 1.62, max 68ch): long-form Markdown.
- **Reading** (400, 13px, 1.55): passages, quotes and empty-state text people read.
- **Body** (400 or 500, 12px, 1.4): the UI itself, including rows, buttons, menus and forms. Row titles and buttons take 500.
- **Meta** (400, 11.5px): secondary lines, chips, hints, errors, group headings.
- **Label** (500, 11px): counts, captions, keyboard hints.

### Named Rules
**The Twenty Pixel Ceiling Rule.** Nothing in the app exceeds 20px. When something needs more emphasis, raise its weight or darken its grey. The one exception is the overview's intro (Brand and Display above, tokens `--fs-brand`, `--fs-display` and their `-sm` narrow sizes, `--tracking-brand`, `--tracking-display`), the page people share as a screenshot of WhatBuild; no other screen earns it ([decision](okf/decisions/the-overview-is-the-front-door.md)).

**The Read Up Rule.** Chrome stays at 12px. Anything a person reads as content (passages, quotes, prose) steps up to 13 to 13.5px with a looser line height and a 68ch measure.

## Layout

The stage is fixed to the viewport. The left panel floats at a 10px inset (264px wide, full height), and the canvas is the one page scroller behind it, padded 28px top, 40px sides and 80px bottom, plus the panel's width on the left. Content is centred at a maximum of 900px, except a mockup's canvas, which fills the width between the panels. On item screens the inspector floats at the right inset (272px), and the canvas adds its width to the right padding while it is docked. While either panel is hidden, the canvas keeps clear of the pill or square that brings it back at the side, never by moving down: the content keeps its height whichever panels are showing, and in focus mode. The panel's brand row and the inspector's head are both 48px, so their hairlines share a line.

The panel stacks, top to bottom: brand row (W mark, wordmark, hide button), product switcher, the four ordered sections with counts, quiet links to Connect an agent, Activity and Settings, a context slot the route fills (Story tree, Evidence's filters, Exploration's mockups and its three lists with their filters) that scrolls independently, and the account at the foot. Hairlines separate each block. Outside a product the same panel lists the person's products under each organization's name (12.5px semibold, like the product switcher's name) over a faint "Products" label, with a hairline between organizations, then a quiet link to Connect an agent; long names truncate with an ellipsis rather than widening the panel; it is identical on each of those screens, so it never depends on where the person came from. The panel changes only on entering or leaving a product. The account menu holds the person's email, each organization with their role and its Members (leaving out an organization where they read only the Story), the theme, Settings, Submit feedback (a dialog that shows, beside the message, what is sent and what is not) and Sign out, and last the release the instance runs: a faint tag or commit glyph, "Release v0.3.1" (or "Commit" and the short hash in mono), the build day on a faint second line, and an external-link glyph, linking to the source.

Screens are built from sheets. A sheet head (min 52px) holds the title and count, filters or segmented control, and actions at the right. Rows below are inset by an 18px sheet gutter (14px on phones) and divided by hairlines. Stacked sheets and callouts sit 16px apart. Spacing follows a 2px-based scale; 6, 8, 10, 12 and 14px do most of the work.

Responsive behaviour:
- **1100px and below:** the inspector starts hidden, and hides again whenever the window crosses 1100px. Shown, it still docks beside the canvas; it never overlays content. The canvas gutters tighten to 24px.
- **760px and below:** the panel becomes a flush overlay drawer (min(320px, 86vw)) with square corners over a dimmed scrim. The inspector becomes the same kind of drawer, flush on the right; only one drawer is open at a time. Sheets run edge to edge with square corners, and the canvas pads 56px top, 12px sides and 60px bottom.

### Named Rules
**The One Scroller Rule.** The canvas scrolls the page. Only the panel's context slot, the inspector body, menus and dialogs scroll on their own.

**The Float Inset Rule.** Floating surfaces sit exactly 10px from the window edge. On phones they go flush, never partially inset.

## Elevation & Depth

Depth is tonal layering plus two shadows. White surfaces lift off the grey canvas. Each shadow has a hard 0.5px ring built in, so panels and sheets need no border. Dark mode deepens the drop and turns the ring faintly white. Inside a surface, all separation is by 1px hairlines.

### Shadow Vocabulary
- **Resting** (`--shadow`: `0 2px 5px rgb(0 0 0 / 0.08), 0 0 0 0.5px rgb(0 0 0 / 0.12)`): panels, sheets, the pill, callouts, and the current segmented item.
- **Lifted** (`--shadow-2`: `0 10px 28px rgb(0 0 0 / 0.16), 0 0 0 0.5px rgb(0 0 0 / 0.14)`): menus, dialogs, toasts, the skip link, and the panel or inspector once it becomes a phone drawer.
- **Flash** (`--shadow-flash`: `0 0 0 1px rgb(255 255 255 / 0.9), 0 0 0 7px rgb(255 255 255 / 0.45), 0 0 90px 28px rgb(255 255 255 / 0.6)`): the search palette alone, for a moment, when it has been left untouched for three seconds; it fades back to Lifted.
- **Paper** (`--shadow-paper`: `0 0 0 1px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.06)`): the preview frame for an uploaded original, which draws as light paper in both themes.

### Named Rules
**The Two Heights Rule.** A surface either rests in the layout or lifts above it. Use no other shadow values, and use no offset or coloured shadows. The one exception is the search palette's passing flash.

## Shapes

Corners nest by size: 12px for panels, sheets, the inspector, dialogs and empty blocks; 8px for popovers, menus, toasts, the pill and callouts; 6px for controls (buttons, inputs, nav items, icon buttons, inset callouts); 4px for inline tokens (chips, tags, segmented items, crumbs, small icon buttons, evidence links). Circles are reserved for avatars and status dots. An agent's face is a 6px-rounded square with a hairline border, so agents read differently from people at a glance. On phones, the panel, inspector and sheets drop their radius to 0 as they go flush.

## Components

### Buttons
Compact and calm. Default buttons read as white tiles with a hairline, not as filled blocks.
- **Shape:** 6px corners; 28px tall (24px small), 10px (8px) horizontal padding, weight 500, 6px gap to a leading glyph.
- **Default:** panel fill, Line 2 border, ink text, muted glyph. Hover fills with Hover, pressed with Hover Strong.
- **Primary:** accent fill and border, accent-text label; hover moves to accent-hover. Busy buttons show a spinning loader and a present-tense label ("Saving…").
- **Quiet:** transparent with muted text that darkens on hover. **Danger:** bad fill for destructive confirmations only.
- **Icon button:** 28px (or 24px with 4px corners) transparent square with a muted glyph that takes Hover fill and ink on hover or while its menu is open.
- **Transitions:** background, border and colour over 120ms on the shared ease.

### Chips and Tags
- **Chip:** 24px, 4px corners, Hover fill, 11.5px text with a faint leading glyph. Link chips darken to Hover Strong on hover.
- **Tag:** 18px outlined label (Line 2 hairline, muted 11px text) for a quiet attribute.
- **Evidence link:** an inline accent-tinted token (7% accent, 13% on hover) in selection ink with tabular numerals, such as a passage address in prose.

### Cards / Containers
- **Sheet:** panel fill, 12px corners, resting shadow, content clipped. A hairline separates the head from the rows.
- **List row:** a three-column grid (48px id, title and sub, right-aligned end meta) padded 11px by the sheet gutter, with a hairline between rows and Hover fill when it is a link.
- **Callout:** an 8px floating note with a resting shadow and a 16px icon column tinted by tone. The inset variant uses Hover fill with no shadow.
- **First-use state:** an empty list inside its sheet, padded 20px by the sheet gutter: a 13px medium title ("No assumptions yet"), muted text at the 68ch measure, then "Connect an agent and ask it:" over the request in a 6px Hover-filled well at 13px ink, with Connect an agent (primary, until an agent is connected) and Copy below it ([decision](okf/decisions/empty-lists-lead-with-the-agent.md)).
- **Inspector group:** padded 12px by 14px, 11.5px semibold title with a faint count, key-value rows on a 64px key column.

### Inputs / Fields
- **Input:** 28px, 6px corners, Line Strong border on panel fill; the border darkens to Muted on hover. Focus sets an accent border plus the 2px accent ring. Invalid fields turn the border and ring red, with an 11.5px error line and alert glyph below. Readonly fields are borderless on Hover fill.
- **Find field:** a fill-only search on Hover (Hover Strong on hover) with a faint leading search glyph, used for the Search screen, the tree filter and in-sheet search. On focus it turns panel white with the accent ring.
- **Labels:** muted 500 above the control. Hints are faint 11.5px, capped at the 68ch measure.

### Navigation
- **Panel nav:** 28px rows with 6px corners, a 14px faint glyph, a 500-weight label and a faint count pushed right. The current section fills with Selection Wash and switches glyph, label and count to Selection Ink. Quiet links (Connect an agent, Activity, Settings) are 26px, 11.5px, muted, and carry 12px glyphs.
- **Crumbs:** 24px muted segments with 4px corners, separated by a faint slash.
- **Segmented control:** a Hover-filled track with a 2px pad. The current item is a white 4px tile with the resting shadow and a Line 2 ring. It serves in-sheet sort orders and item sub-views. A list is filtered from the panel, never from its sheet head: panel filters are 26px links in a labelled section, marked current with the selection wash, and carry either a check or, where they have counts, the count in the nav's place.
- **Phone:** the same panel becomes the drawer, opened from the floating pill.

### Menus, Dialogs, Toasts
- **Menu:** popover fill, 8px corners, 6px pad, hairline border (Line 2 in dark), lifted shadow. It enters in 120ms with a 2px drop and leaves in 100ms. An item may carry a second line, a faint 11px detail under its text; the item grows to fit it.
- **Dialog:** 520px max, 12px corners, lifted shadow, a head, a body and a right-aligned foot above a hairline. It enters in 160ms.
- **Search palette:** opened from the panel's Search field (a Hover-filled 28px button under the product switch reading "Search <product>", with its shortcut in a small key cap), ⌘K / Ctrl+K, or `/`. A 640px popover-fill surface with 12px corners and the lifted shadow, set 12vh from the top over a scrim at 60%. It springs into place over 560ms (a 3px overshoot and a small settle; it simply appears with reduced motion), and if nothing is typed or clicked for three seconds it flashes white once and fades back to Lifted over 1.8s. A 48px field row at 14px holds the search glyph (a spinner while a newer answer loads), the input, and, once something is typed, an **All N results** default button with its key cap. Empty, it is the field alone, or the field with "Recent searches" and Clear above clock-glyph rows. Results are 8px-cornered rows with a 14px faint glyph, a medium title with matched words marked, faint meta at the right and a muted two-line excerpt; the selected row takes the selection wash. There is no footer and no Esc key cap.
- **Toast:** a 40px popover row with an 8px radius, hairline border and lifted shadow, holding a tone icon, text, an optional action and a close button.
- **Cookie notice:** a 344px popover note at the bottom-right float inset, with an 8px radius, hairline border and lifted shadow: a faint cookie glyph, 12px muted text with a semibold ink lead-in, then a quiet Cookies link and two default buttons of equal weight, Decline and Accept. It enters 600ms after the screen settles (200ms, 6px rise), never takes focus and blocks nothing; on phones it runs flush along the bottom edge and the page pads clear of it. Its layer (`--z-notice`) sits above the panels and under a drawer's scrim. Not a dialog, and never a primary button.

### The Floating Pill (signature)
When the panel hides, a 32px pill takes its place at the top-left inset: 58px wide whatever the product is called, panel fill, 8px corners, resting shadow, the W mark and the muted panel-left-open glyph. Its accessible name carries the product and the section. It slides in over 200ms while the canvas widens on the same 200ms ease. A hidden inspector leaves its counterpart at the top-right inset: a 32px square in the same fill, corners and shadow, holding the panel-right-open glyph.

### The Mockup Canvas
A mockup opens on a board that fills the canvas's width and the window's height below the crumbs: 12px corners, one tone below the canvas with a faint 24px dot grid, and an inset 0.5px ring instead of a shadow. Each page sits on it white, at its own size, with the paper shadow; the board pans and zooms, and the pages scale with it. Above each page a label stays at screen size whatever the zoom: a 24px row in 12px medium muted type (its number and size faint), with a fit button that shows on hover or when the page is selected. A selected page takes a 2px accent outline that keeps its width at any zoom, and its label the selection wash. A toolbar floats at the bottom centre of the board in popover fill with 8px corners and the resting shadow: 28px tools for Pan and Interact (the checked one in the selection wash, which no hover overrides), zoom out, the zoom level as a menu, zoom in, fit the page, fit the canvas (a grid), the previous and next page, and the list of keys. Where a finger is the pointer, the tools are 44px tall with 20px glyphs on 12px corners, and the zoom buttons and the list of keys give way to make room; hover styles apply only where there is a real hover. Moves glide over 200ms, and not at all with reduced motion. The design notes, the brief and the version are in the inspector, never on the board.

### The W Mark
A rounded square filled with ink, read as one of the app's panels: a hairline title bar across its top (0.9 stroke at a fifth of its height), and below it a W with a middle peak lower than its arms (2.6 stroke, round caps and joins), both in the panel colour. It sits beside the "WhatBuild" wordmark in 13px semibold. The mark is monochrome and inverts automatically with the theme ([decision](okf/decisions/the-mark-is-a-w-in-a-panel-with-a-title-bar.md)).

## Do's and Don'ts

### Do:
- **Do** take every colour, size, radius, shadow, duration and layer from the token file. Screen stylesheets compose tokens and add layout only.
- **Do** keep controls at 24px or 28px, and reserve 32px for the floating pill and its square.
- **Do** draw icons through the glyph map: lucide at 12px or 14px, 1.75 stroke, faint or muted at rest.
- **Do** pair every status with its shaped 7px mark and a word.
- **Do** animate with the one ease (`cubic-bezier(0.2, 0.8, 0.2, 1)`) at 120ms for small state changes, 160ms for toasts and dialogs, and 200ms for panels, the inspector and the canvas. Honour reduced motion.
- **Do** show focus with the 2px accent outline at 1px offset. Rows inside sheets inset it (-2px).
- **Do** keep Story pages out of Studio: the Story guidance and house styles never copy the app's tokens.

### Don't:
- **Don't** add a top bar, a second rail, an app-level tab strip or extra drawers beside the panel. On phones the panel itself is the drawer.
- **Don't** set app type above 20px outside the overview's intro, and don't add a display face to the app: the display step is Inter at 600.
- **Don't** use the accent for decoration, category colour, large fills or more than one filled button in a view.
- **Don't** use shadows outside the resting, lifted and paper set, including hard offset, coloured or glow shadows. The search palette's passing flash is the one exception.
- **Don't** add small uppercase labels above titles. Section labels are 11px sentence case in faint 500; a panel section's heading is Subtitle, in ink.
- **Don't** use text characters or emoji as icons. Every icon is a lucide glyph.
- **Don't** signal state with colour alone.
