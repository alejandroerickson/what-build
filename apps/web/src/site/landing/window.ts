import { HUES, KINDS, div, eIO, eOut, lerp, makeTile, part, person, pick, place, rng, seg, startStage, svg } from "./motion.ts";

/**
 * The picture of the landing page on a dark stage: WhatBuild's window lies flat, stands up as
 * evidence flies into it, opens to show the agent's side behind the side people see, fans out three
 * product concepts and takes one back, turns around to the Story with its readers, and shrinks to
 * the start of a line a coding agent builds along. The section pins the stage while the scroll runs
 * it, so someone who only scrolls sees every scene; t runs from 0 to 100.
 */
export function startWindow(root: HTMLElement): () => void {
  const rig = part(root, "rig");
  const content = part(root, "content");
  const agentl = part(root, "agentl");
  const la = part(root, "label-agent");
  const lb = part(root, "label-you");
  const fly = part(root, "fly");
  const framesEl = part(root, "frames");
  const readersEl = part(root, "readers");
  const ties = part<SVGSVGElement>(root, "ties");
  const bl = part(root, "buildline");
  const goal = part(root, "goal");
  const mover = part(root, "mover");
  const builder = part(root, "builder");
  const heads = [...root.querySelectorAll<HTMLElement>("[data-h]")];
  for (const el of [content, fly, framesEl, readersEl, ties]) el.replaceChildren();

  // The grid inside the window, and the same tiles flying in from all around it.
  const R = rng(23);
  const COLS = 8, ROWS = 3, N = COLS * ROWS;
  const RIG = { x: 300, y: 300 }, CT = { x: 150 + 34, y: 34 + 30 };
  const inside: { a: HTMLDivElement; walk: number; lx: number; ly: number }[] = [];
  const flying: { f: HTMLDivElement; cx: number; cy: number; cr: number; cs: number; ph: number; ox: number; oy: number; rank: number }[] = [];
  for (let i = 0; i < N; i++) {
    const kind = pick(KINDS, R), hue = pick(HUES, R);
    const a = makeTile(content, kind, "#fff");
    const row = Math.floor(i / COLS), col = i % COLS;
    const lx = 34 + col * 76 - (a.offsetWidth - 54) / 2, ly = 30 + row * 92 - (a.offsetHeight - 68) / 2;
    place(a, lx, ly, 0);
    a.style.opacity = "0";
    const f = makeTile(fly, kind, hue);
    // Scattered around the window, never over the words at the top.
    const ang = R() * Math.PI * 2, rad = 0.55 + R() * 0.5;
    const cx = 720 + Math.cos(ang) * 640 * rad - 27, cy = 560 + Math.sin(ang) * 300 * rad - 34;
    inside.push({ a, walk: row * COLS + (row % 2 ? COLS - 1 - col : col), lx, ly });
    flying.push({ f, cx, cy: Math.max(360, cy), cr: (R() * 2 - 1) * 40, cs: 0.75 + R() * 0.6, ph: R() * 6.3, ox: RIG.x + CT.x - 34 + lx, oy: RIG.y + CT.y - 30 + ly + 40, rank: R() });
  }
  const byWalk = [...inside].sort((a, b) => a.walk - b.walk);
  const agentDot = div(content, "ld-agent");

  // The concepts that come out of the window.
  const FX = [250, 595, 940], FY = 340;
  const frames = FX.map((_, i) => {
    const f = div(framesEl, "ld-frame");
    f.style.setProperty("--fill", ["#dcf2ee", "#e4e3fb", "#fcefd8"][i]!);
    return { f, ring: div(f, "ld-ring") };
  });

  // The people who read the Story.
  const RA = [-160, 180, 160, -20, 0, 20];
  const readers = RA.map((a, i) => ({ d: person(readersEl, HUES[i % 6]!), a: (a * Math.PI) / 180, tie: svg(ties, "line", { x1: 720, y1: 600 }) }));

  const snap = (t: number) => (t < 12 ? 3 : t < 35 ? 35 : t < 54 ? 50 : t < 71 ? 69.5 : t < 85 ? 83.5 : 99.5);
  const HEADS: [number, number][] = [[0, 7], [12, 35], [37, 53], [57, 70], [72, 85], [87, 101]];

  return startStage(root, root, { x: 140, y: 300, w: 1160, h: 600, top: 0.5, bottom: 0.97 }, (clock, now) => {
    const still = clock.reduced;
    const t = still ? snap(clock.p * 100) : clock.p * 100;
    // On a narrow window the picture keeps closer to its middle.
    const EX = clock.narrow ? 130 : 220, AX = clock.narrow ? -600 : -760, RX = clock.narrow ? 500 : 560;

    // Words: one statement at a time.
    heads.forEach((h, k) => {
      const [a, b] = HEADS[k]!;
      const o = (k === 0 ? 1 : seg(t, a, a + 3)) * (k === HEADS.length - 1 ? 1 : 1 - seg(t, b - 2.5, b));
      h.style.opacity = o.toFixed(3);
      h.style.visibility = o < 0.01 ? "hidden" : "visible";
      h.style.transform = `translate3d(0,${((1 - o) * (t < a + 3 ? 14 : -14)).toFixed(1)}px,0)`;
    });

    // The window: lying down, standing up, turning to show its layers, turning around, then small.
    const rise = eIO(seg(t, 6, 18));
    const explode = eIO(seg(t, 38, 46)) * (1 - eIO(seg(t, 52, 56)));
    const dim = eIO(seg(t, 58, 62)) * (1 - eIO(seg(t, 70, 73)));
    const turn = eIO(seg(t, 73, 80));
    const small = eIO(seg(t, 86, 91));
    const rx = lerp(68, 0, rise) + 6 * explode;
    const ry = -30 * explode + 180 * turn;
    const ty = lerp(330, 40, rise) - 20 * explode + 70 * dim;
    const tx = EX * explode + lerp(0, -420, small);
    const sc = lerp(0.92, 1, rise) * lerp(1, 0.86, dim) * lerp(1, 0.34, small);
    rig.style.transform = `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    rig.style.opacity = lerp(1, 0.06, dim).toFixed(3);

    // The agent's side comes out from behind the window.
    agentl.style.opacity = seg(explode, 0.1, 0.6).toFixed(3);
    agentl.style.transform = `translate3d(${(AX * explode).toFixed(1)}px,${(-10 * explode).toFixed(1)}px,${(-240 * explode).toFixed(1)}px)`;
    la.style.opacity = lb.style.opacity = seg(explode, 0.7, 1).toFixed(3);

    // Tiles fly in from all around and settle into the window, then live inside it.
    const handed = t >= 33;
    flying.forEach((fl) => {
      const appear = seg(t, 9, 13);
      const u = eOut(seg(t, 16 + fl.rank * 10, 22 + fl.rank * 10));
      const calm = 1 - u;
      const jx = still ? 0 : Math.sin(now * 1.8 + fl.ph) * 3 * calm, jy = still ? 0 : Math.cos(now * 1.5 + fl.ph) * 2.4 * calm;
      place(fl.f, lerp(fl.cx + jx, fl.ox, u), lerp(fl.cy + jy, fl.oy, u), lerp(fl.cr, 0, u), lerp(fl.cs, 1, u));
      fl.f.style.setProperty("--c", (1 - u).toFixed(3));
      fl.f.style.opacity = handed ? "0" : appear.toFixed(3);
    });
    const walk = seg(t, 40, 51);
    inside.forEach((it) => {
      it.a.style.opacity = handed ? "1" : "0";
      it.a.classList.toggle("ld-read", walk > 0 && it.walk < walk * N);
    });
    const steps = walk * (N - 1), k = Math.floor(steps), f = steps - k;
    const a = byWalk[Math.min(N - 1, k)]!, b = byWalk[Math.min(N - 1, k + 1)]!;
    agentDot.style.transform = `translate3d(${(lerp(a.lx, b.lx, eIO(f)) + 27).toFixed(1)}px,${(lerp(a.ly, b.ly, eIO(f)) - 10).toFixed(1)}px,0)`;
    agentDot.style.opacity = (seg(t, 38, 40) * (1 - seg(t, 51, 53))).toFixed(3);

    // Concepts fan out of the window; one is narrowed to and goes back in.
    const out = eOut(seg(t, 59, 65)), chose = eOut(seg(t, 66, 69)), back = eIO(seg(t, 70, 73));
    frames.forEach(({ f: fr, ring }, i) => {
      const chosen = i === 1;
      const o = seg(out, i * 0.1, 0.6 + i * 0.1);
      const x = lerp(595, FX[i]!, o), y = lerp(560, FY, o), s = lerp(0.4, 1, o);
      let op = o, fx = x, fy = y, fs = s * (chosen ? lerp(1, 1.1, chose) : lerp(1, 0.92, chose));
      if (!chosen) op *= lerp(1, 0.25, chose) * (1 - back);
      else {
        fx = lerp(x, 595, back);
        fy = lerp(y, 560, back);
        fs = lerp(fs, 0.4, back);
        op *= 1 - seg(back, 0.6, 1);
        ring.style.opacity = chose.toFixed(3);
      }
      fr.style.opacity = op.toFixed(3);
      fr.style.transform = `translate3d(${fx.toFixed(1)}px,${fy.toFixed(1)}px,0) rotate(${((i - 1) * 4 * (1 - o)).toFixed(2)}deg) scale(${fs.toFixed(3)})`;
    });

    // Everyone reads the same Story.
    readers.forEach((r, i) => {
      const x = 720 + RX * Math.cos(r.a) - 22, y = 600 + 240 * Math.sin(r.a) - 22;
      const o = eOut(seg(t, 79 + i * 0.8, 82 + i * 0.8)) * (1 - seg(t, 85, 87));
      r.d.style.opacity = o.toFixed(3);
      r.d.style.transform = `translate3d(${x.toFixed(1)}px,${(y + (1 - o) * 10).toFixed(1)}px,0)`;
      r.tie.setAttribute("x2", (x + 22).toFixed(1));
      r.tie.setAttribute("y2", (y + 22).toFixed(1));
      r.tie.style.opacity = (o * 0.9).toFixed(3);
    });

    // And the coding agent builds from it.
    const draw = seg(t, 90, 94);
    bl.style.width = `${(draw * 600).toFixed(1)}px`;
    goal.style.opacity = seg(t, 92, 94).toFixed(3);
    builder.style.opacity = seg(t, 89, 91).toFixed(3);
    const go = eIO(seg(t, 94, 98.5));
    mover.style.opacity = (seg(t, 93.5, 94.5) * (1 - seg(go, 0.92, 1))).toFixed(3);
    mover.style.transform = `translate3d(${lerp(470, 1096, go).toFixed(1)}px,586px,0)`;
    goal.classList.toggle("ld-goal-full", go >= 0.98);
  });
}
