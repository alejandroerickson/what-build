import { Glyph } from "../ui/index.tsx";

/** What marks each of the tutorial's examples, wherever it shows: a signpost and a word, in the attention hue. */
export function TutorialBadge() {
  return (
    <span className="tut-badge">
      <Glyph name="signpost" size="sm" />
      Tutorial
    </span>
  );
}

/** The line above the examples on every page while the tutorial runs, in place of the example organization's banner. */
export function TutorialLine() {
  return (
    <p className="canvas-banner example-line tut-examples-line">
      <Glyph name="signpost" size="sm" />
      <span>
        <b>Tutorial examples.</b> They disappear when you close the tutorial. Agents never see them.
      </span>
    </p>
  );
}
