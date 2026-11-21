/**
 * Typefaces WhatBuild carries for Story and mockup pages. A page can make no network request, so a
 * face it uses must travel inside it. Rather than store a font in every page (and hand it to every
 * agent that reads one), the server embeds a face when it shows a page whose CSS names the family in
 * quotes: the stored page stays small, and a house style, a team's own stylesheet or a mockup page
 * can use any of these as if it were installed. A page that names none of them is shown exactly as
 * stored.
 *
 * Each file is the Latin subset of the family's variable font, under the SIL Open Font License
 * (story-fonts/README.md). Glyphs outside the subset fall back to the next face in the stack.
 */

import { readFileSync } from "node:fs";

export interface StoryFont {
  family: string;
  /** In story-fonts/, beside this module. The server's build copies the folder beside its bundle. */
  file: string;
  /** The weight axis the variable file covers. */
  weight: string;
  /** The width axis, for a file that has one. */
  stretch?: string;
}

export const STORY_FONTS: StoryFont[] = [
  { family: "Archivo", file: "archivo.woff2", weight: "100 900", stretch: "62% 125%" },
  { family: "Bricolage Grotesque", file: "bricolage-grotesque.woff2", weight: "200 800" },
  { family: "Figtree", file: "figtree.woff2", weight: "300 900" },
  { family: "Gabarito", file: "gabarito.woff2", weight: "400 900" },
  { family: "Jost", file: "jost.woff2", weight: "100 900" },
  { family: "Libre Franklin", file: "libre-franklin.woff2", weight: "100 900" },
  { family: "Onest", file: "onest.woff2", weight: "100 900" },
  { family: "Public Sans", file: "public-sans.woff2", weight: "100 900" },
  { family: "Red Hat Display", file: "red-hat-display.woff2", weight: "300 900" },
  { family: "Red Hat Text", file: "red-hat-text.woff2", weight: "300 700" },
  { family: "Signika", file: "signika.woff2", weight: "300 700" },
];

/**
 * The app's own typeface, which Idea cards carry. A mockup page gets it as it gets the Story's
 * faces: a team's design system often uses it, and embedded it was most of each page's weight. A
 * Story page never does, since the Story never takes WhatBuild's look.
 */
export const INTER: StoryFont = { family: "Inter", file: "inter.woff2", weight: "100 900" };

/** The faces a mockup page gets when it names one: the Story's, and Inter. */
export const MOCKUP_FONTS: StoryFont[] = [...STORY_FONTS, INTER];

/** What the Latin subset covers, so other text falls through to the next face rather than to a missing glyph. */
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

const faces = new Map<string, string>();

function fontFace(f: StoryFont): string {
  let face = faces.get(f.family);
  if (!face) {
    const data = readFileSync(new URL(`./story-fonts/${f.file}`, import.meta.url)).toString("base64");
    face = `@font-face { font-family: "${f.family}"; src: url(data:font/woff2;base64,${data}) format("woff2"); font-weight: ${f.weight};${f.stretch ? ` font-stretch: ${f.stretch};` : ""} font-style: normal; font-display: swap; unicode-range: ${LATIN}; }`;
    faces.set(f.family, face);
  }
  return face;
}

/** The families of a set (the Story's unless another is given) a page names in quotes, as CSS or a style attribute writes them: "Signika" or 'Signika'. */
export function storyFontsNamed(html: string, fonts: StoryFont[] = STORY_FONTS): StoryFont[] {
  return fonts.filter((f) => html.includes(`"${f.family}"`) || html.includes(`'${f.family}'`));
}

/** @font-face rules for each of these faces, once each, or "" for none. */
export function fontFacesOf(fonts: StoryFont[]): string {
  return [...new Set(fonts)].map(fontFace).join("\n");
}

/** @font-face rules for every carried family the page names, or "" when it names none. */
export function storyFontFaces(html: string, fonts: StoryFont[] = STORY_FONTS): string {
  return fontFacesOf(storyFontsNamed(html, fonts));
}

/**
 * A stored page as it is shown: the faces it names, in a <style> of their own at the start of its
 * <head>, so the page's own rules still come after them. The stored HTML is never changed. A
 * mockup page passes MOCKUP_FONTS.
 */
export function withStoryFonts(html: string, fonts: StoryFont[] = STORY_FONTS): string {
  const css = storyFontFaces(html, fonts);
  if (!css) return html;
  const block = `<style>\n${css}\n</style>`;
  const head = /<head(?=[\s>])[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + block + html.slice(head.index + head[0].length);
  // No <head>: a <style> before the first content still lands in the one the parser makes.
  const lead = /^(?:﻿)?(?:\s+|<!doctype[^>]*>|<!--[\s\S]*?-->|<html(?=[\s>])[^>]*>)*/i.exec(html)![0];
  return lead + block + html.slice(lead.length);
}
