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
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 10px 0 7px"
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

One floating panel carries the product's whole story, Idea, Evidence, Synthesis and Story in that order, and the content takes the rest of the canvas. Studio is a tool-maker's workspace: a light grey canvas (near-black in dark), white panels with 12px corners floating 10px in from the window edge, hairline rules, and a soft two-layer shadow. There is no top bar, no persistent rail beside the panel, and no app-level tab strip. One screen shows at a time, links are real links, and the browser owns tabs.

The system is dense and quiet. The UI runs at 12px in Inter; text people actually read (passages, quotes, Markdown) steps up to 13 to 13.5px. Hierarchy comes from weight (600) and grey steps rather than size, and nothing in the app is larger than 20px. Indigo is the only chromatic voice in the chrome, reserved for selection, focus, primary commits and pointing at evidence. Status always pairs a small shaped mark with a word.

The panel can hide (a button or Ctrl/Cmd+\). The canvas widens in a single 200ms motion and a floating pill with the mark, product and section takes its place. Item screens (a Story, a source) add a 272px inspector floating on the right. The shipped Story export is a separate reading surface: it borrows the app's colours, radii and UI face through a derived token set and pairs them with a serif reading face of its own.

**Key Characteristics:**
- A 264px floating left panel and 272px floating inspector around one scrolling canvas (content max 900px).
- White-on-grey tonal layering; the shadow's 0.5px ring stands in for a panel border.
- Inter at 11 to 15px for the UI, 20px as the ceiling; 600 is the heading weight.
- 24px and 28px controls; radius steps 4, 6, 8, 12.
- Indigo for selection, focus, primary commits and evidence only.
- Lucide icons at 12 or 14px with a 1.75 stroke, through one glyph map.
- Light and dark are both first-class and resolved before first paint.

## Colors

A neutral grey studio with a single indigo accent and three status hues; every value lives in the token file, in a light and a dark set.

### Primary
- **Studio Indigo** (accent; accent-dark in dark): primary commit buttons, the focus ring (2px solid, 1px offset), the text caret, drop indicators in the Story tree, and the base of every accent tint.
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
**The Earned Accent Rule.** Indigo means "selected, focused, commit, or evidence". It never decorates, never fills a header, and never marks a category. A view carries at most one accent-filled button, usually the commit in a form or dialog or the first-creation action in an empty state. A populated sheet header's create action stays a default button.

**The Mark And Word Rule.** Status is a 7px mark followed by a word, both in the status colour. The mark's shape carries the state on its own: a filled dot for positive, a ring for attention, a small diamond for negative, a spinning open arc for progress and a faint ring for neutral. Colour is never the only signal.

**The Two Schemes Rule.** Every colour token has a light and a dark value, and colour-mixed tokens are re-derived inside each theme scope. A new colour lands in both sets or it doesn't land.

## Typography

**UI Font:** Inter Variable (falling back to Inter, then system-ui)
**Mono Font:** the system monospace stack (ui-monospace, SF Mono, Menlo), used for codes, token prefixes and commands
**Story reading face (export only):** a serif system stack (ui-serif, Charter, Georgia). It lives in the Story's own page tokens and never appears in the app.

**Character:** One humanist sans at small, exact sizes, in the manner of a design tool rather than a website. There is no display type. Titles earn their place with weight 600 and slight negative tracking.

### Hierarchy
- **Headline** (600, 20px, 1.25, -0.01em): the h1 of an item screen, such as an insight or a source.
- **Lead** (400, 15px, 1.55): a single summary paragraph above prose.
- **Title** (600, 14px, 1.25): the sheet title, which is the h1 of a list screen, followed by its count in faint 400.
- **Subtitle** (600, 12.5px): product name, inspector title, h3.
- **Prose** (400, 13.5px, 1.62, max 68ch): long-form Markdown.
- **Reading** (400, 13px, 1.55): passages, quotes and empty-state text people read.
- **Body** (400 or 500, 12px, 1.4): the UI itself, including rows, buttons, menus and forms. Row titles and buttons take 500.
- **Meta** (400, 11.5px): secondary lines, chips, hints, errors, group headings.
- **Label** (500, 11px): counts, panel section labels, captions, keyboard hints.

### Named Rules
**The Twenty Pixel Ceiling Rule.** Nothing in the app exceeds 20px. When something needs more emphasis, raise its weight or darken its grey.

**The Read Up Rule.** Chrome stays at 12px. Anything a person reads as content (passages, quotes, prose) steps up to 13 to 13.5px with a looser line height and a 68ch measure.

## Layout

The stage is fixed to the viewport. The left panel floats at a 10px inset (264px wide, full height), and the canvas is the one page scroller behind it, padded 28px top, 40px sides and 80px bottom, plus the panel's width on the left. Content is centred at a maximum of 900px. On item screens the inspector floats at the right inset (272px), and the canvas adds its width to the right padding while it is docked.

The panel stacks, top to bottom: brand row (W mark, wordmark, hide button), product switcher, the four ordered sections with counts, quiet Agents and Settings links, a context slot the route fills (Story tree, source filters) that scrolls independently, and the account at the foot. Hairlines separate each block.

Screens are built from sheets. A sheet head (min 52px) holds the title and count, filters or segmented control, and actions at the right. Rows below are inset by an 18px sheet gutter (14px on phones) and divided by hairlines. Stacked sheets and callouts sit 16px apart. Spacing follows a 2px-based scale; 6, 8, 10, 12 and 14px do most of the work.

Responsive behaviour:
- **1100px and below:** the inspector overlays the canvas with the lifted shadow and slides out when closed. The canvas keeps a 24px right gutter.
- **760px and below:** the panel becomes a flush overlay drawer (min(320px, 86vw)) with square corners over a dimmed scrim. The inspector goes flush on the right. Sheets run edge to edge with square corners, and the canvas pads 56px top, 12px sides and 60px bottom.

### Named Rules
**The One Scroller Rule.** The canvas scrolls the page. Only the panel's context slot, the inspector body, menus and dialogs scroll on their own.

**The Float Inset Rule.** Floating surfaces sit exactly 10px from the window edge. On phones they go flush, never partially inset.

## Elevation & Depth

Depth is tonal layering plus two shadows. White surfaces lift off the grey canvas. Each shadow has a hard 0.5px ring built in, so panels and sheets need no border. Dark mode deepens the drop and turns the ring faintly white. Inside a surface, all separation is by 1px hairlines.

### Shadow Vocabulary
- **Resting** (`--shadow`: `0 2px 5px rgb(0 0 0 / 0.08), 0 0 0 0.5px rgb(0 0 0 / 0.12)`): panels, sheets, the pill, callouts, and the current segmented item.
- **Lifted** (`--shadow-2`: `0 10px 28px rgb(0 0 0 / 0.16), 0 0 0 0.5px rgb(0 0 0 / 0.14)`): menus, dialogs, toasts, the skip link, and panels or inspectors once they overlay content at narrow widths.
- **Paper** (`--shadow-paper`: `0 0 0 1px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.06)`): the preview frame for an uploaded original, which draws as light paper in both themes.

### Named Rules
**The Two Heights Rule.** A surface either rests in the layout or lifts above it. Use no other shadow values, and use no offset or coloured shadows.

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
- **Inspector group:** padded 12px by 14px, 11.5px semibold title with a faint count, key-value rows on a 64px key column.

### Inputs / Fields
- **Input:** 28px, 6px corners, Line Strong border on panel fill; the border darkens to Muted on hover. Focus sets an accent border plus the 2px accent ring. Invalid fields turn the border and ring red, with an 11.5px error line and alert glyph below. Readonly fields are borderless on Hover fill.
- **Find field:** a fill-only search on Hover (Hover Strong on hover) with a faint leading search glyph, used for the panel find, tree filter and in-sheet search. On focus it turns panel white with the accent ring.
- **Labels:** muted 500 above the control. Hints are faint 11.5px, capped at the 68ch measure.

### Navigation
- **Panel nav:** 28px rows with 6px corners, a 14px faint glyph, a 500-weight label and a faint count pushed right. The current section fills with Selection Wash and switches glyph, label and count to Selection Ink. Quiet links (Agents, Settings) are 26px, 11.5px, muted, and carry 12px glyphs.
- **Crumbs:** 24px muted segments with 4px corners, separated by a faint slash.
- **Segmented control:** a Hover-filled track with a 2px pad. The current item is a white 4px tile with the resting shadow and a Line 2 ring. It serves both in-sheet filters and item sub-views.
- **Phone:** the same panel becomes the drawer, opened from the floating pill.

### Menus, Dialogs, Toasts
- **Menu:** popover fill, 8px corners, 6px pad, hairline border (Line 2 in dark), lifted shadow. It enters in 120ms with a 2px drop and leaves in 100ms.
- **Dialog:** 520px max, 12px corners, lifted shadow, a head, a body and a right-aligned foot above a hairline. It enters in 160ms.
- **Toast:** a 40px popover row with an 8px radius, hairline border and lifted shadow, holding a tone icon, text, an optional action and a close button.

### The Floating Pill (signature)
When the panel hides, a 32px pill takes its place at the top-left inset: panel fill, 8px corners, resting shadow, W mark, product name in 500 and the section in faint 400. It slides in over 200ms while the canvas widens on the same 200ms ease.

### The W Mark
A rounded square filled with ink, with a W stroked in the panel colour (2.6 stroke, round caps and joins) beside the "WhatBuild" wordmark in 13px semibold. The mark inverts automatically with the theme.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, radius, shadow, duration and layer from the token file. Screen stylesheets compose tokens and add layout only.
- **Do** keep controls at 24px or 28px, and reserve 32px for the floating pill.
- **Do** draw icons through the glyph map: lucide at 12px or 14px, 1.75 stroke, faint or muted at rest.
- **Do** pair every status with its shaped 7px mark and a word.
- **Do** animate with the one ease (`cubic-bezier(0.2, 0.8, 0.2, 1)`) at 120ms for small state changes, 160ms for toasts and dialogs, and 200ms for panels, the inspector and the canvas. Honour reduced motion.
- **Do** show focus with the 2px accent outline at 1px offset. Rows inside sheets inset it (-2px).
- **Do** update the Story page's derived tokens and bump their version whenever a shared colour, radius or font token changes. The drift test enforces this.

### Don't:
- **Don't** add a top bar, a second rail, an app-level tab strip or extra drawers beside the panel. On phones the panel itself is the drawer.
- **Don't** set app type above 20px, and don't add a display face to the app.
- **Don't** use the accent for decoration, category colour, large fills or more than one filled button in a view.
- **Don't** use shadows outside the resting, lifted and paper set, including hard offset, coloured or glow shadows.
- **Don't** add small uppercase labels above titles. Section labels are 11px sentence case in faint 500.
- **Don't** use text characters or emoji as icons. Every icon is a lucide glyph.
- **Don't** signal state with colour alone.
