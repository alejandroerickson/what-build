/**
 * The tutorial's stops: one line, in order, across the four pages. Each lights one thing on its page
 * and names it with its own name, as the app labels it, and at most one short line. Back and the
 * primary button are the only ways to move; a stop that ends its page goes to the next page.
 *
 * What a stop lights is named here (`target`) and found on the screen by the layer (layer.tsx), so a
 * stop's words and order can change without touching the mechanics.
 */

/** The four pages of a product, in the order the tutorial walks them. */
export type Place = "idea" | "evidence" | "exploration" | "story";

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
  place: Place;
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
  /** The last stop: Finish, and Connect an agent. */
  last?: boolean;
}

export const STOPS: readonly Stop[] = [
  { id: "nav", place: "idea", title: "Main navigation", line: ["Four stages of product discovery."], target: "nav", side: "right" },
  { id: "idea", place: "idea", title: "Idea", line: ["Your product’s elevator pitch."], target: "nav-idea", side: "right" },
  { id: "concept", place: "idea", title: "Product concept", line: ["The value proposition."], target: "concept", side: "bottom" },
  { id: "more-info-button", place: "idea", title: "More info", line: ["Each card has text behind its picture."], target: "more-info-button", side: "bottom", aim: "more-info-button" },
  {
    id: "more-info",
    place: "idea",
    title: "More info",
    line: ["The same concept in words, for agents to read."],
    target: "more-info",
    side: "bottom",
    opens: "more-info",
    presses: "more-info-button",
    aim: "more-info-button",
  },
  { id: "outcomes", place: "idea", title: "Outcomes", line: ["What the product’s users should be able to achieve."], target: "outcome", side: "top" },
  { id: "evidence", place: "evidence", title: "Evidence", line: ["Research, calls and documents, kept mainly for agents to read."], target: "nav-evidence", side: "right" },
  { id: "sources", place: "evidence", title: "Sources", line: ["Select a source to preview it."], target: "source-row", side: "left" },
  {
    id: "preview",
    place: "evidence",
    title: "Preview",
    line: ["What’s visual in a source: whiteboard photos, slides, recordings."],
    target: "preview",
    side: "left",
    opens: "preview",
    presses: "source-row",
  },
  { id: "exploration", place: "exploration", title: "Exploration", line: ["Mockups of what you could build."], target: "nav-exploration", side: "right" },
  {
    id: "canvas",
    place: "exploration",
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
  { id: "toolbar", place: "exploration", title: "Toolbar", line: ["The same commands, and their keys."], target: "toolbar", side: "top", diagram: true },
  {
    id: "view",
    place: "exploration",
    title: "View",
    line: [{ b: "Clickable prototype" }, " lets you click through the pages. ", { b: "Canvas" }, " unfolds them, so you can move around all of it."],
    target: "view",
    side: "left",
    live: true,
  },
  { id: "download", place: "exploration", title: "Download as ZIP", line: ["To open offline, or hand to a coding agent."], target: "download", side: "left" },
  { id: "promote", place: "exploration", title: "Promote canvas to Story", line: ["Puts this canvas on the Story."], target: "promote", side: "left" },
  { id: "story", place: "story", title: "Story", line: ["What stakeholders read."], target: "nav-story", side: "right" },
  { id: "story-pages", place: "story", title: "Story pages", line: ["Pages an agent writes, and canvases promoted from Exploration."], target: "story-pages", side: "right" },
  { id: "pdf", place: "story", title: "Export to PDF", line: ["For readers outside WhatBuild."], target: "pdf", side: "left" },
  {
    id: "agents",
    place: "story",
    title: "Agents",
    line: ["Everything you can edit here, your agent can edit through MCP. Ask it in your own chat or coding tool, and the work shows up here."],
    stage: true,
  },
  { id: "connect", place: "story", title: "Connect an agent", line: ["It takes about a minute."], target: "seat", side: "right", last: true },
];

/** Each page's name and glyph, as the panel shows them. */
export const PLACES: Record<Place, { label: string; icon: "lightbulb" | "library" | "blend" | "book-open"; path: string }> = {
  idea: { label: "Idea", icon: "lightbulb", path: "idea" },
  evidence: { label: "Evidence", icon: "library", path: "evidence" },
  exploration: { label: "Exploration", icon: "blend", path: "exploration/mockups" },
  story: { label: "Story", icon: "book-open", path: "story" },
};

/**
 * The stops a person walks. The last lights the panel's "No agent connected" seat, which is there
 * only while they have no agent connected: with one connected, the tutorial ends on the agent stage.
 */
export function stopsFor(hasAgent: boolean): readonly Stop[] {
  return hasAgent ? STOPS.filter((s) => !s.last) : STOPS;
}

/** The page a stop's next stop is on, when it is another: its button goes there. */
export function nextPlace(stops: readonly Stop[], n: number): Place | null {
  const here = stops[n];
  const next = stops[n + 1];
  return here && next && next.place !== here.place ? next.place : null;
}

/** A line's words alone, for announcing a stop. */
export function lineText(line: Line): string {
  return line.map((part) => (typeof part === "string" ? part : "kbd" in part ? part.kbd : part.b)).join("");
}
