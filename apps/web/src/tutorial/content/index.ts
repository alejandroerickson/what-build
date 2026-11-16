import { AGENTS } from "./agents.ts";
import { EVIDENCE } from "./evidence.ts";
import { EXPLORATION } from "./exploration.tsx";
import { IDEA } from "./idea.ts";
import { STORY } from "./story.tsx";
import type { TutorialContent } from "./types.ts";

/** Everything the tutorial shows, page by page: edit these to change what it shows, never the mechanics. */
export const TUTORIAL: TutorialContent = { idea: IDEA, evidence: EVIDENCE, exploration: EXPLORATION, story: STORY, agents: AGENTS };

export { TUTORIAL_ACTOR } from "./types.ts";
export type * from "./types.ts";
