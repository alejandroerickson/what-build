/** The furthest one wheel event moves the canvas's zoom, as the logarithm of its factor: about 10%. */
const MAX_STEP = 0.1;

/**
 * What one wheel event over the mockup canvas multiplies the zoom by. A pinch arrives as Ctrl with
 * small steps, and follows the fingers. A mouse wheel arrives with a large step for each notch, and
 * with Ctrl looks just like a pinch, so no event goes further than `MAX_STEP`, whatever it reports.
 */
export function wheelZoomFactor(dy: number, line: boolean, pinch: boolean): number {
  const step = -dy * (line ? 0.03 : pinch ? 0.01 : 0.0015);
  return Math.exp(Math.min(MAX_STEP, Math.max(-MAX_STEP, step)));
}
