import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ListedSource } from "../../lib/types.ts";
import type { CanvasPage } from "../../routes/mockup-canvas.tsx";
import type { StoryNode } from "../../routes/story-model.ts";

/**
 * What the tutorial shows on each page, as fixed content that ships with the web app. One object per
 * page, drawn through the components that draw a product's own content, while the product's own is
 * hidden. None of it is in any product, the server never sees it, and no agent can reach it.
 */

/** Who the examples were written by, wherever a screen names an author. */
export const TUTORIAL_ACTOR = { account_id: "tutorial", display_name: "Tutorial", surface: null, client: null } as const;

/** A step in a drawn front: a pictogram in a ringed node, its name and a line. */
export interface FrontStep {
  icon: LucideIcon;
  name: string;
  line: string;
  /** Painful today, or new with the product. */
  tone?: "pain" | "new";
}

/** The product concept's front, drawn: the promise, the line under it, today and with the product, and whom it is for. */
export interface ConceptFront {
  pitch: { before: string; marked: string; after: string };
  lede: string;
  today: { heading: string; steps: FrontStep[] };
  after: { heading: string; steps: FrontStep[] };
  who: { icon: LucideIcon; name: string; line: string }[];
}

/** An outcome's front, drawn: where a number stands and where success puts it, and the way there. */
export interface OutcomeFront {
  caption: string;
  today: { label: string; value: string };
  success: { label: string; value: string; share: number };
  steps: FrontStep[];
}

export interface IdeaContent {
  concept: { title: string; text: string; front: ConceptFront };
  outcomes: { id: string; title: string; text: string; front: OutcomeFront }[];
}

export interface EvidenceContent {
  /** The sources, as the list of sources gives them. */
  sources: ListedSource[];
  /** The source whose preview the tutorial opens, and the page of it, counting from 0. */
  preview: { source: string; page: number };
}

/** A page of the example canvas: its place on the board and what it draws, a page linking to another by `data-page-link`. */
export interface ExplorationPage extends CanvasPage {
  notes: string;
  draw: () => ReactNode;
}

export interface ExplorationContent {
  mockup: { id: string; title: string; summary: string; brief: string; version: number; columns: number; publishedAt: string };
  pages: ExplorationPage[];
}

export interface StoryContent {
  /** The Story's tree, as the panel shows it. */
  tree: StoryNode[];
  /** The page shown. */
  page: { id: string; title: string; summary: string; version: number; publishedAt: string; notes: string };
  /** The Story style, as the panel names it. */
  style: { name: string; line: string };
  /** The page itself, in its Story style: drawn, since a Story page's frame is served only from its product. */
  draw: () => ReactNode;
}

/** The agent stage: a request typed to an agent, its work in beats, and its last word. */
export interface AgentScript {
  agent: string;
  connected: string;
  placeholder: string;
  prompt: string;
  beats: { place: "idea" | "evidence" | "exploration" | "story"; say: string; tool: string; act: string; item: AgentItem }[];
  done: string;
  /** Under each page on the stage: the MCP tools that write it. */
  tools: Record<"idea" | "evidence" | "exploration" | "story", string>;
  note: string;
}

/** What a beat adds to the small WhatBuild on the stage. */
export type AgentItem =
  | { kind: "source"; title: string; tags: string[] }
  | { kind: "outcome"; title: string; today: string; success: string }
  | { kind: "mockup"; title: string; meta: string }
  | { kind: "story"; kicker: string; title: string; text: string };

export interface TutorialContent {
  idea: IdeaContent;
  evidence: EvidenceContent;
  exploration: ExplorationContent;
  story: StoryContent;
  agents: AgentScript;
}
