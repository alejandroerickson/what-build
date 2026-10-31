import { describe, expect, it } from "vitest";
import { wheelZoomFactor } from "../src/routes/mockup-wheel-zoom.ts";

describe("wheelZoomFactor", () => {
  const TEN_PERCENT = Math.exp(0.1);

  it("moves about 10% for a notch of a mouse wheel, with ⌘ or with Ctrl", () => {
    expect(wheelZoomFactor(-100, false, false)).toBeCloseTo(TEN_PERCENT);
    expect(wheelZoomFactor(-100, false, true)).toBeCloseTo(TEN_PERCENT);
    expect(wheelZoomFactor(100, false, false)).toBeCloseTo(1 / TEN_PERCENT);
    expect(wheelZoomFactor(100, false, true)).toBeCloseTo(1 / TEN_PERCENT);
  });

  it("moves a little less for a notch that counts in lines", () => {
    expect(wheelZoomFactor(-3, true, false)).toBeCloseTo(Math.exp(0.09));
    expect(wheelZoomFactor(-3, true, true)).toBeCloseTo(Math.exp(0.09));
  });

  it("goes no further for a wheel that reports a very large step", () => {
    expect(wheelZoomFactor(-1000, false, true)).toBeCloseTo(TEN_PERCENT);
    expect(wheelZoomFactor(1000, false, false)).toBeCloseTo(1 / TEN_PERCENT);
    expect(wheelZoomFactor(-100, true, false)).toBeCloseTo(TEN_PERCENT);
  });

  it("follows the fingers in a pinch", () => {
    expect(wheelZoomFactor(-3, false, true)).toBeCloseTo(Math.exp(0.03));
    expect(wheelZoomFactor(3, false, true)).toBeCloseTo(Math.exp(-0.03));
  });

  it("goes in small steps with a two-finger scroll", () => {
    expect(wheelZoomFactor(-10, false, false)).toBeCloseTo(Math.exp(0.015));
  });

  it("leaves the zoom alone when the wheel reports no step", () => {
    expect(wheelZoomFactor(0, false, false)).toBe(1);
  });
});
