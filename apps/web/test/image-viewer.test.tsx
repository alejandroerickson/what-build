import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampOffset, clampScale, fitScale, ImageViewer } from "../src/routes/image-viewer.tsx";

const images = ["a.jpg", "b.jpg", "c.jpg"].map((path) => ({ path, url: `/file?path=${path}` }));
const html = (current: string, list = images) => renderToStaticMarkup(<ImageViewer images={list} current={current} onSelect={() => {}} downloadUrl="/file?download=1" />);

describe("image viewer geometry", () => {
  it("keeps the scale between 5% and 800%", () => {
    expect(clampScale(0.001)).toBe(0.05);
    expect(clampScale(20)).toBe(8);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it("fits a large image inside the stage and never enlarges a small one", () => {
    expect(fitScale({ width: 4000, height: 3000 }, { width: 800, height: 600 })).toBe(0.2);
    expect(fitScale({ width: 4000, height: 1000 }, { width: 800, height: 600 })).toBe(0.2);
    expect(fitScale({ width: 200, height: 100 }, { width: 800, height: 600 })).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(1);
  });

  it("stops panning at the image's edges and centres an axis that fits", () => {
    const natural = { width: 2000, height: 500 };
    const stage = { width: 800, height: 600 };
    expect(clampOffset({ x: 5000, y: 40 }, natural, stage, 1)).toEqual({ x: 600, y: 0 });
    expect(clampOffset({ x: -5000, y: -40 }, natural, stage, 1)).toEqual({ x: -600, y: 0 });
    expect(clampOffset({ x: 100, y: 100 }, natural, stage, 0.25)).toEqual({ x: 0, y: 0 });
  });
});

describe("image viewer", () => {
  it("shows where the image sits among the source's images, with a thumbnail for each", () => {
    const out = html("b.jpg");
    expect(out).toContain("2 of 3");
    expect(out.match(/class="image-viewer-thumb[ "]/g)).toHaveLength(3);
    expect(out).toContain('aria-current="true" aria-label="b.jpg"');
    expect(out).toContain('src="/file?path=b.jpg"');
  });

  it("can't step before the first image or past the last", () => {
    expect(html("a.jpg")).toMatch(/aria-label="Previous image"[^>]*disabled/);
    expect(html("c.jpg")).toMatch(/aria-label="Next image"[^>]*disabled/);
  });

  it("shows a single image without stepping controls or a strip", () => {
    const out = html("a.jpg", images.slice(0, 1));
    expect(out).not.toContain("Previous image");
    expect(out).not.toContain("image-viewer-strip");
  });
});
