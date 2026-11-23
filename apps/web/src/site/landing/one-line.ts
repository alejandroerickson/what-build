import { HUES, KINDS, clamp, div, eIO, eOut, lerp, makeTile, part, person, pick, place, rng, seg, startStage, svg } from "./motion.ts";

/**
 * The picture of the landing page whose words scroll past it: a heap of evidence settles into rows,
 * an agent works through them, they are drawn into three product concepts and one is narrowed to,
 * it is told as a Story to the people around it, and a coding agent builds straight from it.
 * Six steps of words scroll up beside it; s runs from 0 to 5, and s = k when step k fills the window.
 */
export function startOneLine(root: HTMLElement): () => void {
  const CX = 1080; // the picture's middle line
  const tilesEl = part(root, "tiles");
  const agent = part(root, "agent");
  const arcs = part<SVGSVGElement>(root, "arcs");
  const ties = part<SVGSVGElement>(root, "ties");
  const page = part(root, "page");
  const lane = part(root, "lane");
  const ship = part(root, "ship");
  const concept = part(root, "concept");
  const framesEl = part(root, "frames");
  const readersEl = part(root, "readers");
  for (const el of [tilesEl, arcs, ties, framesEl, readersEl]) el.replaceChildren();
  lane.querySelectorAll(".ld-block").forEach((b) => b.remove());

  // Everything known about the users: a loose heap, then rows.
  const R = rng(7);
  const COLS = 5, ROWS = 5, N = COLS * ROWS;
  const bell = () => (R() + R() + R()) / 1.5 - 1;
  type Tile = { el: HTMLDivElement; cx: number; cy: number; cr: number; ph: number; ox: number; oy: number; rank: number; walk: number; frame: number };
  const loose: Omit<Tile, "ox" | "oy" | "rank" | "walk" | "frame">[] = [];
  for (let i = 0; i < N; i++) {
    const el = makeTile(tilesEl, pick(KINDS, R), pick(HUES, R));
    // A few lie apart from the heap.
    const stray = i % 6 === 2;
    const cx = stray ? 800 + R() * 540 : CX - 27 + bell() * 210;
    const cy = stray ? (R() < 0.5 ? 140 + R() * 70 : 730 + R() * 70) : 440 + bell() * 240;
    loose.push({ el, cx, cy, cr: (R() * 2 - 1) * 34, ph: R() * 6.3 });
  }
  // The highest settle into the top row, and each row keeps its tiles in left-to-right order.
  loose.sort((a, b) => a.cy - b.cy);
  const ordered: typeof loose = [];
  for (let r = 0; r < ROWS; r++) ordered.push(...loose.slice(r * COLS, r * COLS + COLS).sort((a, b) => a.cx - b.cx));
  const tiles: Tile[] = ordered.map((t, i) => {
    const row = Math.floor(i / COLS), col = i % COLS;
    return {
      ...t,
      ox: CX - 27 + (col - 2) * 80 - (t.el.offsetWidth - 54) / 2,
      oy: 290 + row * 78 - (t.el.offsetHeight - 68) / 2,
      rank: i / (N - 1),
      walk: row * COLS + (row % 2 ? COLS - 1 - col : col), // the agent reads row by row
      frame: col < 2 ? 0 : col < 3 ? 1 : 2,
    };
  });
  const byWalk = [...tiles].sort((a, b) => a.walk - b.walk);

  // The product concepts explored, the one narrowed to, and the Story told about it.
  const FS = 0.72, FW = 250 * FS, FH = 176 * FS;
  const FX = [CX - FW * 1.5 - 22, CX - FW / 2, CX + FW / 2 + 22], FY = 420;
  const frames = FX.map((_, i) => {
    const f = div(framesEl, "ld-frame");
    f.style.setProperty("--fill", ["#dcf2ee", "#e4e3fb", "#fcefd8"][i]!);
    return { f, ring: div(f, "ld-ring") };
  });
  const PC = { x: CX, y: 470 }; // the page's middle
  const readers = [-150, 180, 150, -30, 0, 30].map((a, i) => {
    const d = person(readersEl, HUES[i % 6]!);
    const rad = (a * Math.PI) / 180;
    const x = PC.x + 255 * Math.cos(rad) - 22, y = PC.y + 215 * Math.sin(rad) - 22;
    const tie = svg(ties, "line", { x1: PC.x, y1: PC.y, x2: x + 22, y2: y + 22 });
    return { d, x, y, tie };
  });

  // What the agent connects as it reads.
  const ARC_PAIRS: [number, number][] = [[1, 13], [8, 21], [4, 17]];
  const arcEls = ARC_PAIRS.map(([m, n], i) => {
    const a = tiles[m]!, b = tiles[n]!;
    const x1 = a.ox + 54, y1 = a.oy + 34, x2 = b.ox + 54, y2 = b.oy + 34, bow = 70 + i * 22;
    return svg(arcs, "path", { d: `M${x1} ${y1}C${Math.max(x1, x2) + bow} ${y1},${Math.max(x1, x2) + bow} ${y2},${x2} ${y2}`, pathLength: 1, "stroke-dasharray": 1, "stroke-dashoffset": 1 });
  });

  // The build line runs straight down from the concept to a tick.
  const CONCEPT_Y = 150, LANE_TOP = 250;
  const blocks = Array.from({ length: 6 }, () => div(lane, "ld-block"));
  let flow = 0;

  // With reduced motion, each step shows its settled picture.
  const SETTLED = [0, 1, 2.4, 3.45, 4.35, 5];

  return startStage(root, root, { x: 780, y: 120, w: 610, h: 740, top: 0.07, bottom: 0.56 }, (clock, now, dt) => {
    const still = clock.reduced;
    const s = still ? SETTLED[Math.round(clock.p * 5)]! : clock.p * 5;

    // Tiles: a heap, then rows; read by the agent; then gathered into the concepts.
    const walkA = seg(s, 1.55, 2.3);
    const gather = seg(s, 2.5, 3.0);
    const calm = clamp(1 - seg(s, 0.2, 0.8));
    tiles.forEach((tl, i) => {
      const u = eIO(seg(s, 0.2 + tl.rank * 0.45, 0.5 + tl.rank * 0.45));
      const jx = still ? 0 : Math.sin(now * 2.1 + tl.ph) * 1.6 * calm;
      const jy = still ? 0 : Math.cos(now * 1.7 + tl.ph) * 2.2 * calm;
      let x = lerp(tl.cx + jx, tl.ox, u);
      let y = lerp(tl.cy + jy, tl.oy, u);
      const r = lerp(tl.cr + (still ? 0 : Math.sin(now * 1.3 + tl.ph) * 1.5 * calm), 0, u);
      let k = 1, o = 1;
      if (gather > 0) {
        const g = eIO(seg(gather, (i % 5) * 0.08, (i % 5) * 0.08 + 0.68));
        x = lerp(x, FX[tl.frame]! + FW / 2 - 27, g);
        y = lerp(y, FY + FH / 2 - 34, g);
        k = lerp(1, 0.4, g);
        o = 1 - seg(g, 0.55, 1);
      }
      place(tl.el, x, y, r, k);
      tl.el.style.setProperty("--c", (1 - u).toFixed(3));
      tl.el.style.opacity = o.toFixed(3);
      tl.el.classList.toggle("ld-read", walkA > 0 && tl.walk < walkA * N);
    });

    // The agent walks the rows, and later builds from the concept.
    const ag = seg(s, 1.45, 1.55) * (1 - seg(s, 2.4, 2.5));
    const ab = seg(s, 4.68, 4.78);
    agent.style.opacity = Math.max(ag, ab).toFixed(3);
    if (ab > 0) agent.style.transform = `translate3d(${CX}px,${(CONCEPT_Y + FH).toFixed(1)}px,0)`;
    else if (ag > 0) {
      const steps = walkA * (N - 1);
      const k = Math.floor(steps), f = steps - k;
      const a = byWalk[Math.min(N - 1, k)]!, b = byWalk[Math.min(N - 1, k + 1)]!;
      agent.style.transform = `translate3d(${(lerp(a.ox, b.ox, eIO(f)) + 27).toFixed(1)}px,${(lerp(a.oy, b.oy, eIO(f)) - 12).toFixed(1)}px,0)`;
    }
    arcEls.forEach((p, i) => {
      const on = seg(s, 1.8 + i * 0.15, 2.05 + i * 0.15) * (1 - seg(s, 2.45, 2.6));
      p.style.strokeDashoffset = (1 - on).toFixed(3);
      p.style.opacity = on > 0 ? "1" : "0";
    });

    // The concepts appear; one is narrowed to; it becomes the Story.
    // Each step's picture is whole by the time its words fill the window.
    const fin = seg(s, 2.6, 2.9), chose = eOut(seg(s, 2.95, 3.2)), toPage = eIO(seg(s, 3.5, 3.8));
    frames.forEach(({ f, ring }, i) => {
      const chosen = i === 1;
      let o = eOut(fin), k = 1;
      const y = lerp(18, 0, eOut(fin));
      if (!chosen) {
        o *= lerp(1, 0.28, chose) * (1 - toPage);
        k = lerp(1, 0.92, chose);
      } else {
        k = lerp(1, 1.12, chose) * lerp(1, 0.9, toPage);
        o *= 1 - seg(toPage, 0.5, 1);
        ring.style.opacity = chose.toFixed(3);
      }
      f.style.opacity = o.toFixed(3);
      f.style.transform = `translate3d(${(FX[i]! + (FW * (1 - k)) / 2).toFixed(1)}px,${(FY + y + (FH * (1 - k)) / 2).toFixed(1)}px,0) scale(${(FS * k).toFixed(3)})`;
    });

    // The Story, and the people who read it. Both leave before the build line arrives.
    const pageIn = seg(toPage, 0.35, 1), leave = seg(s, 4.4, 4.55);
    page.style.opacity = (pageIn * (1 - leave)).toFixed(3);
    page.style.transform = `translate3d(${PC.x - 105}px,${PC.y - 135}px,0) scale(${lerp(0.92, 1, pageIn).toFixed(3)})`;
    readers.forEach((rd, i) => {
      const o = eOut(seg(s, 3.7 + i * 0.04, 3.85 + i * 0.04)) * (1 - leave);
      rd.d.style.opacity = o.toFixed(3);
      rd.d.style.transform = `translate3d(${rd.x}px,${(rd.y + (1 - o) * 10).toFixed(1)}px,0)`;
      rd.tie.style.opacity = (o * 0.9).toFixed(3);
    });

    // The coding agent builds straight from the concept: one line down from it to what ships.
    const laneOn = seg(s, 4.5, 4.75), drop = (1 - eOut(laneOn)) * 30;
    lane.style.opacity = laneOn.toFixed(3);
    lane.style.transform = `translate3d(${CX - 60}px,${(LANE_TOP + drop).toFixed(1)}px,0)`;
    concept.style.opacity = laneOn.toFixed(3);
    concept.style.transform = `translate3d(${(CX - FW / 2).toFixed(1)}px,${(CONCEPT_Y + drop).toFixed(1)}px,0) scale(${FS})`;
    const run = seg(s, 4.75, 4.97);
    flow += dt * 90 * (still ? 0 : run);
    blocks.forEach((b, i) => {
      const y = ((i * 95 + flow) % 400) + 70;
      b.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
      b.style.opacity = (0.92 * run * clamp((y - 70) / 50) * clamp((470 - y) / 60)).toFixed(3);
    });
    ship.style.transform = `scale(${(1 + 0.12 * Math.sin(Math.PI * seg(s, 4.9, 5))).toFixed(3)})`;
  });
}
