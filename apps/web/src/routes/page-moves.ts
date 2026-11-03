/**
 * What a page in a frame may do to move the person between pages. A page's script can post the same
 * messages a click does, as often as it likes, and the app cannot see a click inside a frame. So it
 * goes by the browser's word that a person did something a moment ago, which lasts a few seconds, and
 * by the time since the last move. Without the first a page's request moves nothing, so a script
 * cannot flip pages by itself or spend the person's calls. With it, a script gets a few moves and a
 * few steps of the browser's Back for each thing a person does, so it cannot trap them.
 */

/** The shortest time between two moves a page asks for. */
export const PAGE_MOVE_GAP_MS = 250;
/** The shortest time between two steps a page can add to the browser's Back. */
export const BACK_STEP_GAP_MS = 1000;

/** The browser's word that a person did something a moment ago. */
export const personActed = () => navigator.userActivation?.isActive ?? true;

function atMostEvery(gap: number, now: () => number) {
  let last = -Infinity;
  return () => {
    if (!personActed()) return false;
    const at = now();
    if (at - last < gap) return false;
    last = at;
    return true;
  };
}

/** Whether a page's request to move may go ahead; if so, it counts as the last one. */
export const pageMoves = (now: () => number = Date.now) => atMostEvery(PAGE_MOVE_GAP_MS, now);

/** Whether a move should be a step the browser's Back returns from. One that is not still moves, replacing the address. */
export const backSteps = (now: () => number = Date.now) => atMostEvery(BACK_STEP_GAP_MS, now);
