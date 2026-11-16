import { ArrowRight } from "lucide-react";
import type { ConceptFront, FrontStep, OutcomeFront } from "./content/types.ts";

/*
 * The tutorial's Idea card fronts, drawn by the app in the card kit's manner: a picture, not chrome.
 * An agent's front is shown in a sandboxed frame from its product; these ship with the app and are
 * never in a product, so they are drawn in the card itself (`.tut-front` in tutorial.css).
 */

function Steps({ steps, hue }: { steps: FrontStep[]; hue?: boolean }) {
  return (
    <ol className="tut-flow" data-hue={hue ? "" : undefined}>
      {steps.map((s) => {
        const Icon = s.icon;
        return (
          <li key={s.name} className="tut-node" data-tone={s.tone}>
            <span className="tut-node-dot">
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <b>{s.name}</b>
            <span>{s.line}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ConceptPicture({ front }: { front: ConceptFront }) {
  return (
    <div className="tut-front">
      <p className="tut-pitch">
        {front.pitch.before}
        <mark>{front.pitch.marked}</mark>
        {front.pitch.after}
      </p>
      <p className="tut-lede">{front.lede}</p>
      <div className="tut-shift">
        <div className="tut-shift-side tut-shift-today">
          <h3>{front.today.heading}</h3>
          <Steps steps={front.today.steps} />
        </div>
        <span className="tut-shift-arrow" aria-hidden="true">
          <ArrowRight size={18} strokeWidth={1.9} />
        </span>
        <div className="tut-shift-side tut-shift-after">
          <h3>{front.after.heading}</h3>
          <Steps steps={front.after.steps} hue />
        </div>
      </div>
      <ul className="tut-who">
        {front.who.map((w) => {
          const Icon = w.icon;
          return (
            <li key={w.name}>
              <span className="tut-who-dot">
                <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <span>
                <b>{w.name}</b>
                {w.line}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function OutcomePicture({ front }: { front: OutcomeFront }) {
  return (
    <div className="tut-front">
      <figure className="tut-measure">
        <figcaption>{front.caption}</figcaption>
        <div className="tut-measure-row">
          <span>{front.today.label}</span>
          <i className="tut-bar-today" />
          <b>{front.today.value}</b>
        </div>
        <div className="tut-measure-row is-goal">
          <span>{front.success.label}</span>
          <i className="tut-bar-goal" style={{ width: `${Math.round(front.success.share * 100)}%` }} />
          <b>{front.success.value}</b>
        </div>
      </figure>
      <Steps steps={front.steps} hue />
    </div>
  );
}
