import { Glyph, type GlyphName } from "../ui/glyph.tsx";

/** The WhatBuild journey in the order the panel tells it, with what each stage holds. */
const JOURNEY: { id: string; label: string; icon: GlyphName; about: string }[] = [
  { id: "idea", label: "Idea", icon: "lightbulb", about: "The outcomes you want and the concept you’re testing." },
  { id: "evidence", label: "Evidence", icon: "library", about: "Interviews, calls and documents, searchable in one place." },
  { id: "synthesis", label: "Synthesis", icon: "blend", about: "Insights, assumptions and decisions, each citing its evidence, for your team to review." },
  { id: "story", label: "Story", icon: "book-open", about: "Pages for stakeholders, written by your agent, ready to export." },
];

/** The journey beside an intro: on the overview, and on the public site. Styled in overview.css. */
export function Journey() {
  return (
    <aside className="overview-loop" aria-labelledby="overview-loop-title">
      <h2 id="overview-loop-title" className="overview-loop-title">
        The WhatBuild journey
      </h2>
      <ol className="overview-loop-steps">
        {JOURNEY.map((step) => (
          <li key={step.id} className="overview-loop-step">
            <span className="overview-loop-node">
              <Glyph name={step.icon} />
            </span>
            <span className="overview-loop-name">{step.label}</span>
            <span className="overview-loop-about">{step.about}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
