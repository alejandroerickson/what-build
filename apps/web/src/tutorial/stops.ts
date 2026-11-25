import type { TutorialPart } from "../lib/session.tsx";

/**
 * The tutorials and their stops. A short welcome (the main navigation and an agent at work), then one
 * for each of a product's four pages, which starts by itself the first time the person opens that
 * page and stays on it. Each stop lights one thing and names it with its own name, as the app labels
 * it, and at most one short line. Back and the primary button are the only ways to move. While the
 * person has no agent connected, every tutorial ends on the "No agent connected" seat.
 *
 * What a stop lights is named here (`target`) and found on the screen by the layer (layer.tsx), so a
 * stop's words and order can change without touching the mechanics.
 */

/** The four pages of a product. */
export type Place = "idea" | "evidence" | "exploration" | "story";

/** The tutorials: the welcome, then one for each page. */
export type Part = TutorialPart;

/** What a stop lights, found on the screen by the layer. */
export type Target =
  | "nav"
  | "nav-idea"
  | "nav-evidence"
  | "nav-exploration"
  | "nav-story"
  | "concept"
  | "more-info-button"
  | "more-info"
  | "outcome"
  | "source-row"
  | "preview"
  | "canvas"
  | "toolbar"
  | "view"
  | "download"
  | "promote"
  | "story-pages"
  | "pdf"
  | "seat";

/** A stop's line: words, a key in a key cap (which turns green once pressed), or a few words in bold. */
export type Line = readonly (string | { kbd: string } | { b: string })[];

export interface Stop {
  id: string;
  title: string;
  line: Line;
  /** What is lit; the agent stage lights nothing, and takes most of the screen. */
  target?: Target;
  /** Where the bubble goes, beside what is lit. */
  side?: "top" | "bottom" | "left" | "right";
  /** What the tutorial opens on the page for this stop, and closes on leaving it. */
  opens?: "more-info" | "preview";
  /**
   * What was pressed to open it, at the stop before: arriving from there with Next, it is seen being
   * pressed, lit alone, before what it opens unfolds and is lit.
   */
  presses?: Target;
  /** What the bubble's beak points at, when not the middle of what is lit. */
  aim?: Target;
  /** The thing in the light works, to be tried; at every other stop it is only shown. */
  live?: boolean;
  /** The canvas's keys work at this stop, Focus (F) among them, and each key cap in the line turns green once used. */
  keys?: boolean;
  /** The lit thing's controls are labelled, each with its key, as a diagram in the tutorial's layer. */
  diagram?: boolean;
  /** Most of the screen: an agent at work, played back. */
  stage?: boolean;
  /** The last stop, while the person has no agent connected: Finish, and Connect an agent. */
  last?: boolean;
}

/** The seat that ends every tutorial while the person has no agent connected. */
export const CONNECT: Stop = { id: "connect", title: "Connect an agent", line: ["It takes about a minute."], target: "seat", side: "right", last: true };

/** Each tutorial's stops, in order; the welcome's on whatever page the person is on, each page's on that page. */
export const TUTORIALS: Record<Part, readonly Stop[]> = {
  welcome: [
    { id: "nav", title: "Main navigation", line: ["Four stages of product engineering."], target: "nav", side: "right" },
    {
      id: "agents",
      title: "Agents",
      line: ["Everything you can edit here, your agent can edit through MCP. Ask it in your own chat or coding tool, and the work shows up here."],
      stage: true,
    },
  ],
  idea: [
    { id: "idea", title: "Idea", line: ["Your product’s elevator pitch."], target: "nav-idea", side: "right" },
    { id: "concept", title: "Product concept", line: ["The value proposition."], target: "concept", side: "bottom" },
    { id: "more-info-button", title: "More info", line: ["Each card has text behind its picture."], target: "more-info-button", side: "bottom", aim: "more-info-button" },
    {
      id: "more-info",
      title: "More info",
      line: ["The same concept in words, for agents to read."],
      target: "more-info",
      side: "bottom",
      opens: "more-info",
      presses: "more-info-button",
      aim: "more-info-button",
    },
    { id: "outcomes", title: "Outcomes", line: ["What the product’s users should be able to achieve."], target: "outcome", side: "top" },
  ],
  evidence: [
    { id: "evidence", title: "Evidence", line: ["Research, calls and documents, kept mainly for agents to read."], target: "nav-evidence", side: "right" },
    { id: "sources", title: "Sources", line: ["Select a source to preview it."], target: "source-row", side: "left" },
    {
      id: "preview",
      title: "Preview",
      line: ["What’s visual in a source: whiteboard photos, slides, recordings."],
      target: "preview",
      side: "left",
      opens: "preview",
      presses: "source-row",
    },
  ],
  exploration: [
    { id: "exploration", title: "Exploration", line: ["Mockups of what you could build."], target: "nav-exploration", side: "right" },
    {
      id: "canvas",
      title: "Canvas",
      line: [
        "Try it: ", { kbd: "1" }, " the whole canvas, ", { kbd: "2" }, " one page, ", { kbd: "3" }, " full width. ",
        { kbd: "V" }, " clicks inside a page, ", { kbd: "H" }, " moves the canvas. ", { kbd: "F" }, " hides the panels.",
      ],
      target: "canvas",
      side: "left",
      live: true,
      keys: true,
    },
    { id: "toolbar", title: "Toolbar", line: ["The same commands, and their keys."], target: "toolbar", side: "top", diagram: true },
    {
      id: "view",
      title: "View",
      line: [{ b: "Clickable prototype" }, " lets you click through the pages. ", { b: "Canvas" }, " unfolds them, so you can move around all of it."],
      target: "view",
      side: "left",
      live: true,
    },
    { id: "download", title: "Download as ZIP", line: ["To open offline, or hand to a coding agent."], target: "download", side: "left" },
    { id: "promote", title: "Promote canvas to Story", line: ["Puts this canvas on the Story."], target: "promote", side: "left" },
  ],
  story: [
    { id: "story", title: "Story", line: ["What stakeholders read."], target: "nav-story", side: "right" },
    { id: "story-pages", title: "Story pages", line: ["Pages an agent writes, and canvases promoted from Exploration."], target: "story-pages", side: "right" },
    { id: "pdf", title: "Export to PDF", line: ["For readers outside WhatBuild."], target: "pdf", side: "left" },
  ],
};

/** The tutorials in their order: the welcome, then the pages as the navigation lists them. */
export const PARTS: readonly Part[] = ["welcome", "idea", "evidence", "exploration", "story"];

/** Every stop of every tutorial, the seat once: what is checked against the screens. */
export const ALL_STOPS: readonly Stop[] = [...PARTS.flatMap((p) => TUTORIALS[p]), CONNECT];

/** A tutorial's stops for this person: ending on the empty agent seat, which shows only while they have no agent connected. */
export function stopsFor(part: Part, hasAgent: boolean): readonly Stop[] {
  return hasAgent ? TUTORIALS[part] : [...TUTORIALS[part], CONNECT];
}

/** Each page's name and glyph, as the panel shows them. */
export const PLACES: Record<Place, { label: string; icon: "lightbulb" | "library" | "blend" | "book-open"; path: string }> = {
  idea: { label: "Idea", icon: "lightbulb", path: "idea" },
  evidence: { label: "Evidence", icon: "library", path: "evidence" },
  exploration: { label: "Exploration", icon: "blend", path: "exploration/mockups" },
  story: { label: "Story", icon: "book-open", path: "story" },
};

/** A tutorial's name, as the account menu says it: "Take the Evidence tutorial". */
export function partLabel(part: Part): string {
  return part === "welcome" ? "WhatBuild" : PLACES[part].label;
}

/** A line's words alone, for announcing a stop. */
export function lineText(line: Line): string {
  return line.map((part) => (typeof part === "string" ? part : "kbd" in part ? part.kbd : part.b)).join("");
}
