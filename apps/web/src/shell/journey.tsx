import { Glyph, type GlyphName } from "../ui/glyph.tsx";

/** The four stages in the order the panel lists them, with what a team does in each. */
const JOURNEY: { id: string; label: string; icon: GlyphName; about: string }[] = [
  { id: "idea", label: "Idea", icon: "lightbulb", about: "Say who it’s for and the outcomes you want." },
  { id: "evidence", label: "Evidence", icon: "library", about: "Gather user research, team discussions and documents." },
  { id: "exploration", label: "Exploration", icon: "blend", about: "Mock up directions and review the assumptions behind them." },
  { id: "story", label: "Story", icon: "book-open", about: "Show stakeholders what to build, and why." },
];

/** The journey beside an intro: on the overview, and on the public site. Styled in overview.css. */
export function Journey() {
  return (
    <aside className="overview-loop" aria-labelledby="overview-loop-title">
      <h2 id="overview-loop-title" className="overview-loop-title">
        From idea to story
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
