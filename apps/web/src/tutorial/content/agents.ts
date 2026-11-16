import type { AgentScript } from "./types.ts";

/**
 * The agent stage: a request typed to an agent in the person's own chat, and the agent's work in four
 * beats, each a call to one of WhatBuild's MCP tools that fills in one page of a small WhatBuild.
 * Played back, never a real agent. `{product}` is the person's product's name.
 */
export const AGENTS: AgentScript = {
  agent: "Your agent",
  connected: "WhatBuild connected",
  placeholder: "Ask your agent…",
  prompt: "Add my notes from this morning’s front-desk call to {product}, draft an outcome from them, mock up the check-in screen, and write Priya a Story page.",
  beats: [
    { place: "evidence", say: "Adding the call notes as a source.", tool: "sources_write", act: "create", item: { kind: "source", title: "Front-desk call notes, 14 Nov", tags: ["call", "front desk"] } },
    { place: "idea", say: "Drafting an outcome from what the front desk said.", tool: "outcomes_write", act: "create", item: { kind: "outcome", title: "Check in without the clipboard", today: "6 min", success: "under 1 min" } },
    { place: "exploration", say: "Mocking up the check-in screen, two directions.", tool: "mockups_write", act: "publish", item: { kind: "mockup", title: "Check-in: kiosk or phone", meta: "2 pages · version 1" } },
    {
      place: "story",
      say: "Writing a Story page for Priya.",
      tool: "story_write",
      act: "create",
      item: { kind: "story", kicker: "{product}", title: "The wait starts at the clipboard", text: "Four calls agree: patients queue to fill in a form the clinic already holds." },
    },
  ],
  done: "Done. A source, an outcome, a mockup and a Story page are in WhatBuild.",
  tools: {
    idea: "products_write · outcomes_write",
    evidence: "sources_write · attachments_write",
    exploration: "mockups_write",
    story: "story_write",
  },
  note: "Agents never see the tutorial examples.",
};
