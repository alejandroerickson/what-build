import { useId } from "react";
import { ButtonLink, Glyph } from "../ui/index.tsx";

/**
 * The empty seat: while the person has no agent connected, Connect an agent's row in the panel
 * widens into this card, in the row's own place, for everyone, until an agent is connected. It says
 * in a line what an agent does here, and carries Connect an agent as the panel's one accent button.
 * Nothing dismisses it: an agent does, by being connected. The dashed face breathes once every six
 * seconds (still under reduced motion), and the words carry the state, never the colour alone.
 */
export function AgentSeat({ to }: { to: string }) {
  const id = useId();
  return (
    <div className="agent-seat" role="group" aria-labelledby={id} data-agent-seat="">
      <div className="agent-seat-head">
        <span className="agent-face agent-seat-face" aria-hidden="true">
          <Glyph name="bot" size="sm" />
        </span>
        <h2 id={id} className="agent-seat-title">
          No agent connected
        </h2>
      </div>
      <p className="agent-seat-text">An agent reads your sources, drafts assumptions, builds mockups and writes the Story. Without one, you&rsquo;re seeing less than half of WhatBuild.</p>
      <ButtonLink to={to} variant="primary" size="sm" icon="bot">
        Connect an agent
      </ButtonLink>
    </div>
  );
}
