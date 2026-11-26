import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useConnectedAgentCount } from "../lib/agents.ts";
import { useMe, useSaveTutorial, type TutorialState } from "../lib/session.tsx";
import { SETTINGS_PARAM, useSettingsTo } from "../shell/settings-link.ts";
import { useToast } from "../ui/index.tsx";
import { PHONE_QUERY, prefersReducedMotion, useMediaQuery } from "../ui/media.ts";
import { accountButton, boxOf, fly } from "./flight.ts";
import { TutorialLayer } from "./layer.tsx";
import { dueTutorial, menuItem, pageOf, pillWords, sectionOf, TOO_NARROW_QUERY, tutorialFor, welcomeSeen } from "./state.ts";
import { PLACES, stopsFor, type Part, type Stop } from "./stops.ts";
import "./tutorial.css";

/**
 * The spotlight tutorials, for the product a panel shows: whether the person gets them there, which
 * starts by itself on arriving at a screen, and while one runs, the stop it is at. Each page reads it
 * to draw the tutorial's examples in place of the product's own (screens.tsx), the shell to keep the
 * page still and the panels shown, the account menu to offer the tutorial of the page on screen, and
 * the layer (layer.tsx) to darken the screen around one thing at a time.
 *
 * There are five: the welcome, offered on the first screen someone lands on, and one for each of a
 * product's four pages, which starts by itself the first time they open that page (not on the visit
 * the welcome was offered on) and stays on it. The welcome offered in the example organization is
 * offered once more on the first product of the person's own; offered there, never again. Every
 * screen with a product's panel has a provider: a product's own screens (`inside`), and the screens
 * beside them that show the panel of the product the person was last in, the overview above all,
 * where only the welcome comes. Away from the product, starting one goes into the product, which
 * takes it from there.
 *
 * Which have been shown, and whether the person turned tutorials off, live on their account
 * (`PATCH /api/v1/me`), so nothing starts by itself twice, in this browser or another. A tutorial is
 * shown once it starts; closed part-way, it is taken again from the account menu, from the start.
 * A toast that points at the account menu goes when the person leaves these screens, since the
 * screen they go to may have no account menu (the Welcome form has none).
 */

export type Mode = "off" | "welcome" | "stop";
/** In: up and still. Entering: coming out of the account menu, flying to its stop. Closing: going back into it. */
export type Phase = "in" | "entering" | "closing";
/**
 * At a stop that something pressed at the stop before opens (More info, a source's row): pressing
 * it, then open. Only Next from the stop before presses it; coming back, resuming, or with reduced
 * motion, it is open at once.
 */
export type Reveal = "press" | "open";

/** The product a panel shows, as the tutorial needs it: where it is, and what the person may do there. */
export interface TutorialTarget {
  path: string;
  role: string;
  example: boolean;
  canWrite: boolean;
}

/** How a tutorial was started: from the welcome, from the account menu (it flies out of it), or by itself on arriving. */
type From = "welcome" | "menu" | "self";

/** What a screen away from the product hands to the product's own screens: a tutorial to take there. */
type HandOff = { tutorial?: { part: Part; from: "welcome" | "menu" } } | null;

export interface TutorialApi {
  /** The person gets the tutorials on this product. */
  eligible: boolean;
  /** The tutorial running, or else the one the account menu offers here: the page's, or the welcome. */
  part: Part;
  /** Its stops. */
  stops: readonly Stop[];
  /** The person turned tutorials off: none starts by itself. */
  off: boolean;
  mode: Mode;
  phase: Phase;
  /** The stop it is at, while a stop is up. */
  at: number;
  current: Stop | null;
  /** The examples are drawn in place of the product's own content. */
  showing: boolean;
  /** The examples are fading as the tutorial closes. */
  leaving: boolean;
  /** What the tutorial has opened on the page. */
  opens: Stop["opens"] | null;
  /** Where pressing what opens it has got to, at a stop that opens something; null elsewhere. */
  reveal: Reveal | null;
  /** Where the thing in the light is, when it is there to be tried. */
  live: "main" | "inspector" | null;
  /** The example canvas as a clickable prototype, or unfolded. */
  prototype: boolean;
  setPrototype: (on: boolean) => void;
  /** Changes when the canvas is to start afresh: whole, in pan mode. */
  canvasKey: number;
  /** The canvas keys used at the stop that lights it. */
  hit: ReadonlySet<string>;
  hitKey: (key: string) => void;
  /**
   * Focus at the canvas stop: the panels hidden and the canvas taking the window, as F does on a
   * canvas. It is the tutorial's own, off at every other stop, and never the person's Focus choice.
   */
  focus: boolean;
  toggleFocus: () => void;
  start: (part: Part, from: From) => void;
  go: (n: number) => void;
  /** Closes this tutorial into the account menu: the close button, Esc, Not now. */
  later: () => void;
  /** Closes it and turns tutorials off, so none starts by itself again. */
  turnOff: () => void;
  finish: (connect: boolean) => void;
  /** The layer's card (bubble, welcome or stage) and the pill that flies, for the choreography. */
  cardRef: RefObject<HTMLElement | null>;
  pillRef: RefObject<HTMLElement | null>;
  pill: string;
  /** The layer has placed the card at its stop. */
  placed: () => void;
}

const Context = createContext<TutorialApi | null>(null);

/** The tutorial on this product, or null outside a product. */
export function useTutorial(): TutorialApi | null {
  return useContext(Context);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The account menu's tutorial item, opened by Show me, says where it is for a moment. */
function showMe() {
  const b = accountButton();
  if (!b) return;
  // A panel the person hid comes back first, so the menu opens where it belongs.
  const pill = document.querySelector<HTMLElement>(".show-pill:not([hidden])");
  if (pill) pill.click();
  requestAnimationFrame(() => {
    if (b.getAttribute("aria-expanded") !== "true") b.click();
  });
  setTimeout(() =>
    requestAnimationFrame(() => {
      const item = document.querySelector<HTMLElement>(".menu .menu-tutorial");
      if (!item) return;
      item.removeAttribute("data-hint");
      void item.offsetWidth;
      item.setAttribute("data-hint", "");
    }), 260);
}

export function TutorialProvider({ target, inside, children }: { target: TutorialTarget | null; inside: boolean; children: ReactNode }) {
  const app = target ? `/t/${target.path}` : "";
  const me = useMe();
  const save = useSaveTutorial().mutate;
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const [params] = useSearchParams();
  const settingsTo = useSettingsTo();
  const toast = useToast();
  const narrow = useMediaQuery(TOO_NARROW_QUERY);
  const agents = useConnectedAgentCount();
  const hasAgent = (agents ?? 0) > 0;
  const eligible = target ? tutorialFor({ canWrite: target.canWrite, role: target.role, example: target.example, narrow }) : false;
  const kept: TutorialState | undefined = me.data?.tutorial;
  const off = Boolean(kept?.off);
  // The page on screen: whose tutorial the account menu offers, and whose starts by itself on arriving.
  const section = inside ? sectionOf(pathname) : null;
  const page = inside ? pageOf(pathname) : null;
  // The welcome is offered once in the example organization and once on a product of the person's own.
  const example = Boolean(target?.example);

  const [running, setRunning] = useState<Part | null>(null);
  const part: Part = running ?? section ?? "welcome";
  const stops = useMemo(() => stopsFor(part, hasAgent), [part, hasAgent]);

  const [mode, setMode] = useState<Mode>("off");
  const [phase, setPhase] = useState<Phase>("in");
  const [at, setAt] = useState(0);
  const [showing, setShowing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [prototype, setPrototype] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [hit, setHit] = useState<ReadonlySet<string>>(new Set());
  const [pill, setPill] = useState("Tutorial");
  const [reveal, setReveal] = useState<Reveal>("open");
  const [focus, setFocus] = useState(false);
  const [revealRun, setRevealRun] = useState(0);
  const revealPending = useRef(false);
  const revealTimers = useRef<number[]>([]);
  const cardRef = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const onPlaced = useRef<(() => void) | null>(null);
  /** Where the running tutorial was started: leaving it, by a move the tutorial did not make, closes it. */
  const startedAt = useRef<string | null>(null);

  /**
   * The toasts that point at the account menu go when the person leaves these screens: the screen they
   * go to may have no account menu (the Welcome form has none), where Show me would do nothing.
   */
  const pointers = useRef<(() => void)[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pointers.current.forEach((take) => take());
      pointers.current = [];
    };
  }, []);
  const pointAtMenu = useCallback(
    (message: string, withShowMe = true) => {
      if (!alive.current) return;
      const take = toast(message, withShowMe ? { action: { label: "Show me", onClick: showMe } } : undefined);
      pointers.current = [...pointers.current.slice(-2), take];
    },
    [toast],
  );

  const current = mode === "stop" ? (stops[Math.min(at, stops.length - 1)] ?? null) : null;

  /**
   * What entering a stop does besides showing it: the canvas starts afresh, whole and in pan mode; and
   * Next onto a stop that opens something presses it in front of the person, then opens it.
   */
  const enter = useCallback((list: readonly Stop[], n: number, how: "forward" | "back" | "resume") => {
    const s = list[n];
    if (!s) return;
    setAt(n);
    // Leaving the canvas stop, either way, ends Focus first: every other stop has its panels.
    setFocus(false);
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];
    const press = Boolean(s.opens) && how === "forward" && !prefersReducedMotion();
    revealPending.current = press;
    setReveal(press ? "press" : "open");
    setRevealRun((r) => r + 1);
    if (s.id === "canvas") {
      setPrototype(false);
      setCanvasKey((k) => k + 1);
      setHit(new Set());
    }
    // The toolbar is labelled as it is in Canvas view, with every control showing.
    if (s.id === "toolbar") setPrototype(false);
  }, []);

  const go = useCallback(
    (n: number) => {
      if (busy.current || mode !== "stop" || n < 0 || n >= stops.length) return;
      enter(stops, n, n < at ? "back" : "forward");
    },
    [mode, at, stops, enter],
  );

  /** Focus goes back where it was before the tutorial opened, once the page behind is no longer inert; else to the account button. */
  const restoreFocus = () => {
    const back = returnTo.current;
    returnTo.current = null;
    // The page behind stays inert until React has drawn the tutorial closed, which may be a frame or
    // two after this; a focus() on an inert element does nothing, so try again until it is not.
    let frames = 0;
    const attempt = () => {
      const target = back?.isConnected && back !== document.body ? back : accountButton();
      if (!target) return;
      if (target.closest("[inert]")) {
        if (++frames < 30) requestAnimationFrame(attempt);
        return;
      }
      target.focus({ preventScroll: true });
    };
    requestAnimationFrame(attempt);
  };

  /** Closes into the account menu: the card shrinks to a pill, the examples fade, the pill flies, the account button pulses. */
  const close = useCallback(
    async (kind: "welcome" | "stop" | "finished", after?: () => void) => {
      if (busy.current) return;
      busy.current = true;
      setFocus(false);
      const reduced = prefersReducedMotion();
      setPill(pillWords(kind, at, stops.length));
      const from = boxOf(cardRef.current);
      setPhase("closing");
      setLeaving(true);
      await wait(reduced ? 0 : 200);
      setShowing(false);
      setLeaving(false);
      await fly(pillRef.current, from);
      setMode("off");
      setRunning(null);
      setPhase("in");
      busy.current = false;
      if (after) after();
      else restoreFocus();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [at, stops.length],
  );

  const later = useCallback(() => {
    if (mode === "off") return;
    void close(mode === "welcome" ? "welcome" : "stop").then(() => pointAtMenu("The tutorial is in your account menu."));
  }, [mode, close, pointAtMenu]);

  const turnOff = useCallback(() => {
    if (mode === "off") return;
    save({ off: true });
    void close(mode === "welcome" ? "welcome" : "stop").then(() =>
      toast("Tutorials are off. Turn them on again in Settings.", { action: { label: "Undo", onClick: () => save({ off: false }) } }),
    );
  }, [mode, save, close, toast]);

  const finish = useCallback(
    (connect: boolean) => {
      if (mode !== "stop") return;
      void close("finished", connect ? () => navigate(settingsTo("agents")) : undefined).then(() =>
        pointAtMenu("Tutorial finished. It stays in your account menu.", !connect),
      );
    },
    [mode, close, navigate, settingsTo, pointAtMenu],
  );

  /** The welcome, offered over the darkened screen: Not now, or Start the tutorial. */
  const offer = useCallback(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRunning("welcome");
    setMode("welcome");
    setPhase("in");
    save({ seen: welcomeSeen(example) });
  }, [save, example]);

  const start = useCallback(
    (p: Part, from: From) => {
      if (busy.current || !eligible) return;
      // Away from the product, its own screens take it from here: at the tutorial's page, or Idea for the welcome.
      if (!inside) {
        if (from !== "self") navigate(`${app}/${PLACES[p === "welcome" ? "idea" : p].path}`, { state: { tutorial: { part: p, from } } satisfies HandOff });
        return;
      }
      if (from !== "welcome") returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Taken, it counts as shown: the welcome as offered on this kind of product, like the offer itself.
      const shown = p === "welcome" ? welcomeSeen(example) : [p];
      if (!shown.every((s) => kept?.seen.includes(s))) save({ seen: shown });
      // A page's tutorial runs on its page: from the account menu on a source's own screen, to the list of sources.
      if (p !== "welcome" && pageOf(pathname) !== p) {
        startedAt.current = `${app}/${PLACES[p].path}`;
        navigate(startedAt.current);
      } else startedAt.current = pathname;
      const list = stopsFor(p, hasAgent);
      setRunning(p);
      // The welcome lights the panel and the agent stage, the product's own screen behind; a page's draws its examples.
      setShowing(p !== "welcome");
      setMode("stop");
      enter(list, 0, "forward");
      if (from === "menu" && !prefersReducedMotion()) {
        busy.current = true;
        setPill(pillWords("stop", 0, list.length));
        setPhase("entering");
        // Once the layer has put the card at its stop, the pill flies out to it and the card appears.
        onPlaced.current = () => {
          onPlaced.current = null;
          void fly(pillRef.current, boxOf(cardRef.current), true).then(() => {
            busy.current = false;
            setPhase("in");
          });
        };
      } else setPhase("in");
    },
    [eligible, inside, app, navigate, pathname, kept, example, hasAgent, save, enter],
  );
  const startRef = useRef(start);
  startRef.current = start;

  // Next pressed what the stop before lit: it shows its press a moment, then what it opens unfolds.
  useEffect(() => {
    if (!revealPending.current || mode !== "stop" || phase !== "in") return;
    revealPending.current = false;
    revealTimers.current = [window.setTimeout(() => setReveal("open"), 280)];
  }, [revealRun, mode, phase]);
  useEffect(() => () => revealTimers.current.forEach(clearTimeout), []);

  /**
   * Each arrival at a screen decides once what starts by itself there: the page on screen, or a screen
   * beside the product. Closing a tutorial is no arrival, so the welcome closed on Idea leaves Idea's
   * own for the next time the person opens Idea.
   */
  const arrival = inside ? (page ?? `beside:${section ?? ""}`) : "outside";
  const decided = useRef<string | null>(null);

  // Handed over from a screen away from the product: the address says so once, and a reload starts nothing.
  const handed = useRef(false);
  useEffect(() => {
    const ask = (location.state as HandOff)?.tutorial;
    if (!inside || !ask || handed.current || !eligible || !kept) return;
    handed.current = true;
    decided.current = arrival;
    navigate(`${pathname}${location.search}`, { replace: true, state: null });
    start(ask.part, ask.from);
  }, [inside, location.state, location.search, pathname, eligible, kept, navigate, start, arrival]);

  // A moment after arriving, with nothing else up: the welcome until it has been offered on this kind
  // of product, then the page's own the first time.
  const settingsOpen = params.has(SETTINGS_PARAM);
  useEffect(() => {
    if (decided.current === arrival || mode !== "off" || busy.current || settingsOpen || !eligible || !kept) return;
    if ((location.state as HandOff)?.tutorial) return;
    const t = setTimeout(() => {
      decided.current = arrival;
      const due = dueTutorial(kept, page, example);
      if (due === "welcome") offer();
      else if (due) startRef.current(due, "self");
    }, 700);
    return () => clearTimeout(t);
  }, [arrival, page, kept, example, eligible, mode, settingsOpen, location.state, offer]);

  const placed = useCallback(() => onPlaced.current?.(), []);
  const atCanvas = current?.id === "canvas";
  const toggleFocus = useCallback(() => {
    if (!atCanvas || busy.current) return;
    setFocus((f) => !f);
    setHit((h) => (h.has("f") ? h : new Set([...h, "f"])));
  }, [atCanvas]);
  const focusOn = focus && atCanvas && phase !== "closing";
  const hitKey = useCallback((key: string) => setHit((h) => (h.has(key) ? h : new Set([...h, key]))), []);

  /**
   * Closed at once, without the flight: the person went somewhere the tutorial didn't take them, or the
   * window became too narrow for it. `say` is the toast; `offer` its Show me, where the menu has the item.
   */
  const quietly = useCallback(
    (say: boolean, offerMenu = true) => {
      if (mode === "off" || busy.current) return;
      setFocus(false);
      setMode("off");
      setRunning(null);
      setPhase("in");
      setShowing(false);
      setLeaving(false);
      returnTo.current = null;
      if (say) pointAtMenu("The tutorial is in your account menu.", offerMenu);
    },
    [mode, pointAtMenu],
  );

  // A move the tutorial did not make (the browser's Back, say) closes it: the screen arrived at decides what comes next.
  useEffect(() => {
    if (mode === "stop" && startedAt.current !== null && pathname !== startedAt.current) quietly(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // In a window too narrow for it there is no tutorial: it closes where it is. The toast says where it
  // went, without Show me, since the menu offers it only at that width; and at phone width, where the
  // panel is a drawer, says nothing.
  useEffect(() => {
    if (!eligible) quietly(!window.matchMedia(PHONE_QUERY).matches, false);
  }, [eligible, quietly]);

  const api = useMemo<TutorialApi>(
    () => ({
      eligible,
      part,
      stops,
      off,
      mode,
      phase,
      at,
      current,
      showing,
      leaving,
      opens: current?.opens && reveal === "open" ? current.opens : null,
      reveal: current?.opens ? reveal : null,
      live: current?.live ? (current.target === "view" ? "inspector" : "main") : null,
      prototype,
      setPrototype,
      canvasKey,
      hit,
      hitKey,
      focus: focusOn,
      toggleFocus,
      start,
      go,
      later,
      turnOff,
      finish,
      cardRef,
      pillRef,
      pill,
      placed,
    }),
    [eligible, part, stops, off, mode, phase, at, current, showing, leaving, reveal, prototype, canvasKey, hit, hitKey, focusOn, toggleFocus, start, go, later, turnOff, finish, pill, placed],
  );

  return (
    <Context.Provider value={api}>
      {children}
      {mode !== "off" ? <TutorialLayer /> : null}
    </Context.Provider>
  );
}

/**
 * What the account menu offers: its one tutorial item, the tutorial of the page on screen (the welcome
 * elsewhere), or nothing where the person doesn't get them or one is up. It is there with tutorials
 * off too: off, none starts by itself.
 */
export function useTutorialMenuItem(): ({ onSelect: () => void } & ReturnType<typeof menuItem>) | null {
  const t = useTutorial();
  if (!t || !t.eligible || t.mode !== "off") return null;
  return { ...menuItem(t.part, t.stops.length), onSelect: () => t.start(t.part, "menu") };
}

/** What the shell does while the tutorial is up: keep the page still, the panels shown, Focus off. */
export function useTutorialShell(): { active: boolean; live: "main" | "inspector" | null; showing: boolean; focus: boolean } {
  const t = useTutorial();
  // Through the flight into the account menu too, so the account button stays where the pill lands.
  return { active: Boolean(t && t.mode !== "off"), live: t?.phase === "closing" ? null : (t?.live ?? null), showing: Boolean(t?.showing), focus: Boolean(t?.focus) };
}
