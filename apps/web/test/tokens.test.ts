import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../src/styles/tokens.css"), "utf8");

// A search mark (`--highlight`, the background of every <mark>) has to stand out from the surface
// under it in both themes, while the text on it, muted text included, stays readable (4.5:1).

/** The custom properties a rule sets, by its selector's first line. */
function block(selectorStart: string): Record<string, string> {
  const at = css.indexOf(selectorStart);
  if (at < 0) throw new Error(`No block ${selectorStart}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const props: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+):\s*([^;]+);/g)) props[m[1]!] = m[2]!.trim();
  return props;
}

const light = block(":root,\n.theme-light {");
const dark = block(':root[data-theme="dark"],\n.theme-dark {');

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

/** A colour as the theme gives it: a hex, a var() of the theme, or a mix of one into transparent, as an rgb and its alpha. */
function colour(value: string, theme: Record<string, string>): { rgb: Rgb; alpha: number } {
  const v = value.trim();
  if (v.startsWith("#")) return { rgb: hex(v), alpha: 1 };
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return colour(theme[ref[1]!]!, theme);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(v);
  if (mix) return { rgb: colour(mix[1]!, theme).rgb, alpha: Number(mix[2]) / 100 };
  throw new Error(`Can't read ${v}`);
}

const over = (top: { rgb: Rgb; alpha: number }, under: Rgb): Rgb => top.rgb.map((c, i) => under[i]! + top.alpha * (c - under[i]!)) as Rgb;
const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** How far apart two colours look (CIE76). */
function difference(a: Rgb, b: Rgb): number {
  const lab = (c: Rgb) => {
    const [r, g, bl] = c.map(linear) as Rgb;
    const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.9505, 0.2126 * r + 0.7152 * g + 0.0722 * bl, (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.089];
    const [fx, fy, fz] = xyz.map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)) as Rgb;
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

describe("a search mark", () => {
  for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
    it(`keeps the text on it readable in ${name}, muted text and the palette's selected row too`, () => {
      const mark = colour(theme["--highlight"]!, theme);
      for (const surface of ["--panel", "--popover", "--select"]) {
        const bg = over(mark, colour(theme[surface]!, theme).rgb);
        for (const ink of surface === "--select" ? ["--text", "--muted", "--select-text"] : ["--text", "--muted"])
          expect(contrast(colour(theme[ink]!, theme).rgb, bg), `${ink} on a mark over ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("stands out from the surface under it in dark at least as much as in light", () => {
    const seen = (theme: Record<string, string>, surface: string) => {
      const bg = colour(theme[surface]!, theme).rgb;
      return difference(over(colour(theme["--highlight"]!, theme), bg), bg);
    };
    for (const surface of ["--panel", "--popover", "--select"]) expect(seen(dark, surface), surface).toBeGreaterThanOrEqual(seen(light, surface));
  });
});
