import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useConnectedAgentCount } from "../lib/agents.ts";
import { useMe, useSaveTutorial, type TutorialState } from "../lib/session.tsx";
import { SETTINGS_PARAM, useSettingsTo } from "../shell/settings-link.ts";
import { useToast } from "../ui/index.tsx";
import { PHONE_QUERY, prefersReducedMotion, useMediaQuery } from "../ui/media.ts";
import { accountButton, boxOf, fly } from "./flight.ts";
import { TutorialLayer } from "./layer.tsx";
import { menuItem, offerWelcome, pillWords, resumeAt, standing as standingOf, TOO_NARROW_QUERY, tutorialFor, type Standing } from "./state.ts";
import { PLACES, stopsFor, type Place, type Stop } from "./stops.ts";
import "./tutorial.css";

/**
 * The spotlight tutorial, for the product a panel shows: whether the person gets it there, where it
 * stands on their account, and while it runs, the stop it is at. Each page reads it to draw the
 * tutorial's examples in place of the product's own (screens.tsx), the shell to keep the page still
 * and the panels shown, the account menu to offer it, and the layer (layer.tsx) to darken the screen
 * around one thing at a time.
 *
 * Every screen with a product's panel has one: a product's own screens (`inside`), and the screens
 * beside them that show the panel of the product the person was last in, the overview above all. So
 * the welcome comes on the first screen someone lands on, and the account menu is the same
 * everywhere. Away from the product, starting it goes into the product, which takes it from there.
 *
 * Where the person is lives on their account (`PATCH /api/v1/me`), kept at every stop, so a reload, a
 * sign-out, a guest's time running out or leaving the product leaves it closed at that stop, to be
 * resumed from the account menu. Nothing about it is kept in the browser.
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

/** What a screen away from the product hands to the product's own screens: begin, or resume from the account menu. */
type HandOff = { tutorial?: "welcome" | "menu" } | null;

export interface TutorialApi {
  /** The person gets the tutorial on this product. */
  eligible: boolean;
  stops: readonly Stop[];
  standing: Standing;
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
  start: (from: "welcome" | "menu") => void;
  go: (n: number) => void;
  later: () => void;
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

/** The page of a product an address is on, by its first part after the product. */
function placeOf(pathname: string): string {
  return pathname.split("/")[4] ?? "idea";
}

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
  const stops = useMemo(() => stopsFor((agents ?? 0) > 0), [agents]);
  const eligible = target ? tutorialFor({ canWrite: target.canWrite, role: target.role, example: target.example, narrow }) : false;
  const kept: TutorialState | undefined = me.data?.tutorial;
  const standing = standingOf(kept, stops.length);

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
  const navigating = useRef(false);
  const onPlaced = useRef<(() => void) | null>(null);
  const offered = useRef(false);

  const current = mode === "stop" ? (stops[Math.min(at, stops.length - 1)] ?? null) : null;

  /** To the page a stop is on, by real navigation, unless the screen is there already. */
  const visit = useCallback(
    (place: Place) => {
      if (placeOf(pathname) === place) return;
      navigating.current = true;
      navigate(`${app}/${PLACES[place].path}`);
    },
    [pathname, app, navigate],
  );

  /**
   * What entering a stop does besides showing it: the canvas starts afresh, whole and in pan mode; and
   * Next onto a stop that opens something presses it in front of the person, then opens it.
   */
  const enter = useCallback(
    (n: number, how: "forward" | "back" | "resume") => {
      const s = stops[n];
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
      visit(s.place);
    },
    [stops, visit],
  );

  const go = useCallback(
    (n: number) => {
      if (busy.current || mode !== "stop" || n < 0 || n >= stops.length) return;
      enter(n, n < at ? "back" : "forward");
      save({ stop: n });
    },
    [mode, at, stops.length, enter, save],
  );

  /** Focus goes back where it was before the tutorial opened, once the page behind is no longer inert; else to the account button. */
  const restoreFocus = () => {
    const back = returnTo.current;
    returnTo.current = null;
    requestAnimationFrame(() => {
      if (back?.isConnected && !back.closest("[inert]")) back.focus({ preventScroll: true });
      else accountButton()?.focus({ preventScroll: true });
    });
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
    void close(mode === "welcome" ? "welcome" : "stop").then(() => toast("The tutorial is in your account menu.", { action: { label: "Show me", onClick: showMe } }));
  }, [mode, close, toast]);

  const finish = useCallback(
    (connect: boolean) => {
      if (mode !== "stop") return;
      save({ stop: null, finished: true });
      void close("finished", connect ? () => navigate(settingsTo("agents")) : undefined).then(() =>
        toast("Tutorial finished. It stays in your account menu.", connect ? undefined : { action: { label: "Show me", onClick: showMe } }),
      );
    },
    [mode, save, close, navigate, settingsTo, toast],
  );

  const start = useCallback(
    (from: "welcome" | "menu") => {
      if (busy.current || !eligible) return;
      const n = from === "welcome" ? 0 : Math.min(resumeAt(standing), stops.length - 1);
      // Away from the product, its own screens take it from here: at Idea for the first stop, or at the stop's page.
      if (!inside) {
        navigate(`${app}/${PLACES[stops[n]!.place].path}`, { state: { tutorial: from } satisfies HandOff });
        return;
      }
      if (from === "menu") returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      save({ stop: n, offered: true });
      setShowing(true);
      setMode("stop");
      enter(n, from === "menu" ? "resume" : "forward");
      if (from === "menu" && !prefersReducedMotion()) {
        busy.current = true;
        setPill(pillWords("stop", n, stops.length));
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
    [eligible, inside, app, navigate, standing, stops, save, enter],
  );

  // Next pressed what the stop before lit: it shows its press a moment, then what it opens unfolds.
  useEffect(() => {
    if (!revealPending.current || mode !== "stop" || phase !== "in") return;
    revealPending.current = false;
    revealTimers.current = [window.setTimeout(() => setReveal("open"), 280)];
  }, [revealRun, mode, phase]);
  useEffect(() => () => revealTimers.current.forEach(clearTimeout), []);

  // Handed over from a screen away from the product: the address says so once, and a reload starts nothing.
  const handed = useRef(false);
  useEffect(() => {
    const ask = (location.state as HandOff)?.tutorial;
    if (!inside || !ask || handed.current || !eligible || !kept) return;
    handed.current = true;
    navigate(`${pathname}${location.search}`, { replace: true, state: null });
    start(ask);
  }, [inside, location.state, location.search, pathname, eligible, kept, navigate, start]);

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
    (say: boolean, offer = true) => {
      if (mode === "off" || busy.current) return;
      setFocus(false);
      setMode("off");
      setPhase("in");
      setShowing(false);
      setLeaving(false);
      returnTo.current = null;
      if (say) toast("The tutorial is in your account menu.", offer ? { action: { label: "Show me", onClick: showMe } } : undefined);
    },
    [mode, toast],
  );

  // Offered once per person: on the first screen showing the panel of a product where they get it, the overview included.
  const settingsOpen = params.has(SETTINGS_PARAM);
  useEffect(() => {
    if (offered.current || mode !== "off" || settingsOpen || !offerWelcome(kept, eligible)) return;
    const t = setTimeout(() => {
      offered.current = true;
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMode("welcome");
      setPhase("in");
      save({ offered: true });
    }, 700);
    return () => clearTimeout(t);
  }, [kept, eligible, mode, settingsOpen, save]);

  // A move the tutorial did not make (the browser's Back, say) leaves it closed at its stop.
  useEffect(() => {
    if (navigating.current) {
      navigating.current = false;
      return;
    }
    if (mode === "stop" && current && placeOf(pathname) !== current.place) quietly(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // In a window too narrow for it there is no tutorial: it closes where it is, to resume once there is
  // room. The toast says where it went, without Show me, since the menu offers it only at that width;
  // and at phone width, where the panel is a drawer, says nothing.
  useEffect(() => {
    if (!eligible) quietly(!window.matchMedia(PHONE_QUERY).matches, false);
  }, [eligible, quietly]);

  const api = useMemo<TutorialApi>(
    () => ({
      eligible,
      stops,
      standing,
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
      finish,
      cardRef,
      pillRef,
      pill,
      placed,
    }),
    [eligible, stops, standing, mode, phase, at, current, showing, leaving, reveal, prototype, canvasKey, hit, hitKey, focusOn, toggleFocus, start, go, later, finish, pill, placed],
  );

  return (
    <Context.Provider value={api}>
      {children}
      {mode !== "off" ? <TutorialLayer /> : null}
    </Context.Provider>
  );
}

/** What the account menu offers: its one tutorial item, or nothing where the person doesn't get it or it is up. */
export function useTutorialMenuItem(): ({ onSelect: () => void } & ReturnType<typeof menuItem>) | null {
  const t = useTutorial();
  if (!t || !t.eligible || t.mode !== "off") return null;
  return { ...menuItem(t.standing, t.stops), onSelect: () => t.start("menu") };
}

/** What the shell does while the tutorial is up: keep the page still, the panels shown, Focus off. */
export function useTutorialShell(): { active: boolean; live: "main" | "inspector" | null; showing: boolean; focus: boolean } {
  const t = useTutorial();
  // Through the flight into the account menu too, so the account button stays where the pill lands.
  return { active: Boolean(t && t.mode !== "off"), live: t?.phase === "closing" ? null : (t?.live ?? null), showing: Boolean(t?.showing), focus: Boolean(t?.focus) };
}
