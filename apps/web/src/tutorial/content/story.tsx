import { EXPLORATION } from "./exploration.tsx";
import type { StoryContent } from "./types.ts";

/*
 * The Story: one page, and under it the canvas promoted from Exploration with its three pages. The
 * page is drawn in its own Story style (`.tut-story-page` in tutorial.css), never the app's look, as a
 * Story page always is.
 */

const ROOT = "tutorial-story-1";
const CANVAS = "tutorial-story-canvas";

function WhereDiscoveryStands() {
  return (
    <article className="tut-story-page">
      <p className="tut-story-kicker">Crewboard · Where discovery stands</p>
      <h1>The costly part of planning is sending the plan, not making it</h1>
      <p className="tut-story-lead">
        Crew leads spend a Friday afternoon building next week. The mistakes that reach customers happen afterwards, when the plan is typed out to each crew.
      </p>
      <p className="tut-story-meta">Tutorial discovery · Working interpretation</p>
      <hr />
      <h2>What we heard</h2>
      <p>
        Planning is a weekly ritual of two to three hours, in a spreadsheet or on paper. The errors crews feel, a wrong address or a double booking, enter when the plan is copied into
        messages by hand.
      </p>
    </article>
  );
}

export const STORY: StoryContent = {
  tree: [
    {
      page_id: ROOT,
      title: "Where Crewboard’s discovery stands",
      description: "",
      kind: "story_page",
      children: [
        {
          page_id: CANVAS,
          title: "Planning the week, whole canvas",
          description: "",
          kind: "canvas",
          children: EXPLORATION.pages.map((p) => ({ page_id: `tutorial-story-${p.page_id}`, title: p.title, description: "", kind: "mockup_page" as const, children: [] })),
        },
      ],
    },
  ],
  page: {
    id: ROOT,
    title: "Where Crewboard’s discovery stands",
    summary: "The one-screen summary of where Crewboard’s discovery stands.",
    version: 1,
    publishedAt: "2026-09-04T09:00:00.000Z",
    notes: [
      "### Purpose",
      "",
      "The one-screen summary of where Crewboard’s discovery stands, for the owner and two advisors. Keep it to a single screen.",
      "",
      "### On this Story",
      "",
      "The canvas **Planning the week**, whole, at version 2.",
    ].join("\n"),
  },
  style: { name: "Clear", line: "A house style" },
  draw: () => <WhereDiscoveryStands />,
};
