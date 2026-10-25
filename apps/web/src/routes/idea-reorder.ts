import {
  useEffect, useLayoutEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject,
} from "react";

/**
 * Reordering the outcomes' cards, as photos are reordered in a listing: a card is picked up by its
 * head (or, on touch, by its number) and dragged, and the others move aside as it passes them. The
 * same move works without dragging: the number is a button that picks the card up, the arrow keys
 * or a click on another card move it, Enter (or a click on it again) places it and Escape puts it
 * back. Nothing is saved until the card is placed, and then once.
 */
export interface ReorderOptions {
  /** The cards' ids in the order the server gives. */
  ids: string[];
  /** Changes whenever the server's list is read again, which ends any order kept here. */
  version: number;
  enabled: boolean;
  titleOf: (id: string) => string;
  /** Save a card placed at a new index of the order given. */
  onPlace: (id: string, index: number, order: string[]) => void;
}

interface Drag {
  id: string;
  el: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** Where the pointer holds the card, from its top left corner. */
  grabX: number;
  grabY: number;
  active: boolean;
  start: string[];
}

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** How far a pointer moves before a press becomes a drag. */
const SLOP = 5;
/** How close to the scroller's edge a drag scrolls it, and how fast at most. */
const EDGE = 64;
const MOST = 18;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

export function useReorder({ ids, version, enabled, titleOf, onPlace }: ReorderOptions) {
  const [local, setLocal] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const order = local ?? ids;
  const orderRef = useRef(order);
  orderRef.current = order;
  const liftedRef = useRef(lifted);
  liftedRef.current = lifted;
  const liftStart = useRef<string[]>([]);

  const grid = useRef<HTMLElement | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const grips = useRef(new Map<string, HTMLElement>());
  const drag = useRef<Drag | null>(null);
  const snapshot = useRef<Map<string, DOMRect> | null>(null);
  const suppressClick = useRef(false);

  const announce = (text: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(text));
  };
  const place = (id: string, list = orderRef.current) => `position ${list.indexOf(id) + 1} of ${list.length}`;

  // A fresh read of the list ends any order kept here, unless a card is still in hand.
  useEffect(() => {
    if (!drag.current?.active && !liftedRef.current) setLocal(null);
  }, [version]);

  /** A card's place in the grid, ignoring any motion on it. */
  const slotOf = (id: string): DOMRect | null => {
    const el = items.current.get(id);
    const g = grid.current?.getBoundingClientRect();
    if (!el || !g) return null;
    return new DOMRect(g.left + el.offsetLeft, g.top + el.offsetTop, el.offsetWidth, el.offsetHeight);
  };

  /** Move a card to an index, the others gliding from where they were to where they go. */
  const moveTo = (id: string, index: number) => {
    const current = orderRef.current;
    const from = current.indexOf(id);
    const to = Math.max(0, Math.min(current.length - 1, index));
    if (from < 0 || from === to) return false;
    const rects = new Map<string, DOMRect>();
    for (const [key, el] of items.current) rects.set(key, el.getBoundingClientRect());
    snapshot.current = rects;
    const next = current.filter((x) => x !== id);
    next.splice(to, 0, id);
    orderRef.current = next;
    setLocal(next);
    return true;
  };

  /** Keep the dragged card under the pointer, wherever its place now is. */
  const follow = () => {
    const d = drag.current;
    if (!d?.active) return;
    const slot = slotOf(d.id);
    const card = cards.current.get(d.id);
    if (!slot || !card) return;
    card.style.transform = `translate3d(${d.x - d.grabX - slot.left}px, ${d.y - d.grabY - slot.top}px, 0) scale(1.02)`;
  };

  /**
   * The card under the pointer takes the dragged one's place once the pointer passes its middle,
   * across in a row and down or up between rows, so cards of different heights never trade back
   * and forth.
   */
  const hitTest = () => {
    const d = drag.current;
    if (!d?.active) return;
    const current = orderRef.current;
    const at = current.indexOf(d.id);
    const own = slotOf(d.id);
    if (!own) return;
    for (let t = 0; t < current.length; t++) {
      if (t === at) continue;
      const r = slotOf(current[t]!);
      if (!r || d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) continue;
      const sameRow = Math.abs(r.top - own.top) < 2;
      const midX = r.left + r.width / 2;
      const midY = r.top + r.height / 2;
      const past = t > at ? (sameRow ? d.x > midX : d.y > midY) : sameRow ? d.x < midX : d.y < midY;
      if (past) moveTo(d.id, t);
      return;
    }
  };

  // After the order changes: the others glide from where they were, the dragged card stays under
  // the pointer, and a card in hand keeps the focus.
  useLayoutEffect(() => {
    const rects = snapshot.current;
    snapshot.current = null;
    follow();
    if (settling.current) settle();
    const held = liftedRef.current;
    if (held && grips.current.get(held) !== document.activeElement) grips.current.get(held)?.focus({ preventScroll: true });
    if (held) cards.current.get(held)?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    if (!rects || reducedMotion()) return;
    for (const [key, el] of items.current) {
      if (key === drag.current?.id) continue;
      const before = rects.get(key);
      if (!before) continue;
      for (const a of el.getAnimations()) a.cancel();
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 240, easing: EASE });
    }
  }, [order.join(" ")]);

  // ---- Dragging ----------------------------------------------------------------------------------

  /** A released card glides from where it was let go into its place, still lifted until it lands. */
  const settling = useRef<{ id: string; from: DOMRect } | null>(null);
  const settle = () => {
    const s = settling.current;
    settling.current = null;
    if (!s) return;
    const card = cards.current.get(s.id);
    if (!card) return setDragging(null);
    card.style.transform = "";
    if (reducedMotion()) return setDragging(null);
    const to = card.getBoundingClientRect();
    const dx = s.from.left + s.from.width / 2 - (to.left + to.width / 2);
    const dy = s.from.top + s.from.height / 2 - (to.top + to.height / 2);
    const a = card.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1.02)` }, { transform: "none" }], { duration: 200, easing: EASE });
    a.onfinish = a.oncancel = () => setDragging((x) => (x === s.id ? null : x));
  };

  const end = (how: "drop" | "cancel") => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.el.removeEventListener("pointermove", listen.move);
    d.el.removeEventListener("pointerup", listen.up);
    d.el.removeEventListener("pointercancel", listen.cancel);
    window.removeEventListener("keydown", listen.escape, true);
    if (d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
    document.documentElement.classList.remove("is-holding-card", "is-dragging-card");
    if (!d.active) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const card = cards.current.get(d.id);
    if (card) settling.current = { id: d.id, from: card.getBoundingClientRect() };
    if (how === "cancel") {
      announce(`Move cancelled. “${titleOf(d.id)}” is back at ${place(d.id, d.start)}.`);
      // Put back, it settles once the others have moved; left where it started, at once.
      if (moveTo(d.id, d.start.indexOf(d.id))) return;
    } else {
      const at = orderRef.current.indexOf(d.id);
      if (at !== d.start.indexOf(d.id)) {
        onPlace(d.id, at, orderRef.current);
        announce(`Placed “${titleOf(d.id)}” at ${place(d.id)}.`);
      }
    }
    settle();
  };

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      if (Math.hypot(d.x - d.startX, d.y - d.startY) < SLOP) return;
      d.active = true;
      d.start = orderRef.current;
      if (liftedRef.current) setLifted(null);
      setDragging(d.id);
      document.documentElement.classList.add("is-dragging-card");
      requestAnimationFrame(listen.scroll);
    }
    follow();
    hitTest();
  }
  function onUp(e: PointerEvent) {
    if (drag.current && e.pointerId === drag.current.pointerId) end("drop");
  }
  function onCancel(e: PointerEvent) {
    if (drag.current && e.pointerId === drag.current.pointerId) end("cancel");
  }
  function onEscape(e: KeyboardEvent) {
    if (e.key !== "Escape" || !drag.current?.active) return;
    e.preventDefault();
    e.stopPropagation();
    end("cancel");
  }
  /** Near the scroller's top or bottom, a drag scrolls it, faster the closer it gets. */
  function scroll() {
    const d = drag.current;
    if (!d?.active) return;
    const scroller = scrollerOf(grid.current);
    if (scroller) {
      const r = scroller === document.scrollingElement ? new DOMRect(0, 0, innerWidth, innerHeight) : scroller.getBoundingClientRect();
      const by = d.y < r.top + EDGE ? -Math.ceil(((r.top + EDGE - d.y) / EDGE) * MOST) : d.y > r.bottom - EDGE ? Math.ceil(((d.y - (r.bottom - EDGE)) / EDGE) * MOST) : 0;
      if (by) {
        scroller.scrollBy(0, by);
        follow();
        hitTest();
      }
    }
    requestAnimationFrame(listen.scroll);
  }

  // The listeners a drag adds and removes stay the same functions across renders, and call this
  // render's handlers.
  const latest = useRef({ onMove, onUp, onCancel, onEscape, scroll, end });
  latest.current = { onMove, onUp, onCancel, onEscape, scroll, end };
  const listen = useRef({
    move: (e: PointerEvent) => latest.current.onMove(e),
    up: (e: PointerEvent) => latest.current.onUp(e),
    cancel: (e: PointerEvent) => latest.current.onCancel(e),
    escape: (e: KeyboardEvent) => latest.current.onEscape(e),
    scroll: () => latest.current.scroll(),
  }).current;

  /**
   * A press on a card's head (with a mouse or a pen; touch scrolls the page there) or on its number
   * (any pointer) may become a drag.
   */
  const onPointerDown = (id: string, e: ReactPointerEvent<HTMLElement>, from: "head" | "grip") => {
    if (!enabled || e.button !== 0 || drag.current) return;
    if (from === "head") {
      if (e.pointerType === "touch") return;
      if ((e.target as Element).closest("button, a, input, textarea, select, [role='menu']")) return;
    }
    const card = cards.current.get(id);
    if (!card) return;
    const r = card.getBoundingClientRect();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    // A card's picture is a frame of its own, which takes the pointer's moves while over it,
    // captured or not: while a card is held, no frame does.
    document.documentElement.classList.add("is-holding-card");
    drag.current = { id, el, pointerId: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, active: false, start: orderRef.current };
    el.addEventListener("pointermove", listen.move);
    el.addEventListener("pointerup", listen.up);
    el.addEventListener("pointercancel", listen.cancel);
    window.addEventListener("keydown", listen.escape, true);
  };

  // ---- Without dragging: pick up, move, place ------------------------------------------------------

  const lift = (id: string) => {
    liftStart.current = orderRef.current;
    setLifted(id);
    announce(`Picked up “${titleOf(id)}”, ${place(id)}. The arrow keys move it, Enter places it, Escape puts it back.`);
  };
  const drop = () => {
    const id = liftedRef.current;
    if (!id) return;
    setLifted(null);
    const at = orderRef.current.indexOf(id);
    if (at !== liftStart.current.indexOf(id)) {
      onPlace(id, at, orderRef.current);
      announce(`Placed “${titleOf(id)}” at ${place(id)}.`);
    } else announce(`“${titleOf(id)}” stays at ${place(id)}.`);
  };
  const putBack = () => {
    const id = liftedRef.current;
    if (!id) return;
    moveTo(id, liftStart.current.indexOf(id));
    setLifted(null);
    announce(`Move cancelled. “${titleOf(id)}” is back at ${place(id, liftStart.current)}.`);
  };

  /** The number: picks its card up, places it, or places the card in hand where this one is. */
  const onGripClick = (id: string) => {
    if (suppressClick.current || !enabled) return;
    const held = liftedRef.current;
    if (!held) lift(id);
    else if (held === id) drop();
    else {
      moveTo(held, orderRef.current.indexOf(id));
      drop();
    }
  };
  /** A click on another card's head, with a card in hand, places it there. */
  const onHeadClick = (id: string, e: ReactMouseEvent<HTMLElement>) => {
    const held = liftedRef.current;
    if (!held || held === id || suppressClick.current) return;
    if ((e.target as Element).closest("button, a, input, textarea, select, [role='menu']")) return;
    moveTo(held, orderRef.current.indexOf(id));
    drop();
  };
  const onGripKeyDown = (id: string, e: ReactKeyboardEvent<HTMLElement>) => {
    if (liftedRef.current !== id) return;
    const at = orderRef.current.indexOf(id);
    const last = orderRef.current.length - 1;
    const to =
      e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      putBack();
      return;
    }
    if (to === null) return;
    e.preventDefault();
    if (moveTo(id, to)) announce(`${place(id)}.`);
  };

  // A card in hand is placed where it is when the person clicks or tabs away from the cards, put
  // back with Escape wherever the focus is, and put back if the cards stop being movable.
  const away = useRef({ drop, putBack });
  away.current = { drop, putBack };
  useEffect(() => {
    if (!lifted) return;
    const click = (e: PointerEvent) => {
      if (!grid.current?.contains(e.target as Node)) away.current.drop();
    };
    // Focus going to what holds the cards (the page, when a head is clicked) is not going away.
    const focus = (e: FocusEvent) => {
      const g = grid.current;
      if (g && e.target instanceof Node && !g.contains(e.target) && !e.target.contains(g)) away.current.drop();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      away.current.putBack();
    };
    window.addEventListener("pointerdown", click, true);
    window.addEventListener("focusin", focus);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", click, true);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("keydown", key);
    };
  }, [lifted]);
  useEffect(() => {
    if (!enabled && liftedRef.current) putBack();
  }, [enabled]);
  useEffect(() => () => latest.current.end("cancel"), []);

  const register = (map: RefObject<Map<string, HTMLElement>>, id: string) => (el: HTMLElement | null) => {
    if (el) map.current.set(id, el);
    else map.current.delete(id);
  };

  return {
    order,
    dragging,
    lifted,
    announcement,
    gridRef: (el: HTMLElement | null) => {
      grid.current = el;
    },
    itemRef: (id: string) => register(items, id),
    cardRef: (id: string) => register(cards, id),
    gripRef: (id: string) => register(grips, id),
    onPointerDown,
    onGripClick,
    onGripKeyDown,
    onHeadClick,
  };
}
