import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { hitMeta, kindOf, Marked, resultHref, resultMeta, useDebounced, useFind, useRecentSearches, type FindResponse } from "../lib/find.tsx";
import type { Product } from "../lib/session.tsx";
import { Glyph, type GlyphName } from "../ui/index.tsx";
import { isTypingTarget, shortcutLabel } from "../ui/media.ts";

/**
 * Find anything in a product from anywhere in it: ⌘K / Ctrl+K, or / when not typing, or the Search
 * field at the top of the panel. It opens as the field, with recent searches under it; results come
 * as you type, best match first. Enter opens the selected one; the field's All results button
 * (⌘Enter / Ctrl+Enter) opens every result on the Search screen. Closing keeps the words for next
 * time; going on to the Search screen hands them over and clears them here.
 */

const FindContext = createContext<(initial?: string) => void>(() => {});

export function useOpenFind() {
  return useContext(FindContext);
}

/** A row in the list: a result, which opens, or a recent search, which fills the field. */
interface Option {
  key: string;
  href?: string;
  fill?: string;
  glyph: GlyphName;
  title: ReactNode;
  meta?: ReactNode;
  line?: ReactNode;
}

const SHOWN = 8;

function options(app: string, d: FindResponse | undefined): Option[] {
  return (d?.results ?? []).slice(0, SHOWN).map((r) => {
    const hit = r.hits?.[0];
    return {
      key: `${r.kind}:${r.id}`,
      href: hit && !r.title_marks.length ? `${app}/evidence/${r.id}?view=passages&seq=${hit.seq}` : resultHref(app, r),
      glyph: kindOf(r.kind).glyph,
      title: <Marked text={r.title} marks={r.title_marks} />,
      meta: resultMeta(r),
      line: hit ? (
        <>
          <span className="find-pal-addr">{hitMeta(hit)}</span> <Marked text={hit.text} marks={hit.marks} />
        </>
      ) : r.snippet ? (
        <Marked text={r.snippet} marks={r.snippet_marks} />
      ) : null,
    };
  });
}

function Palette({ app, base, product, text, setText, onClose }: { app: string; base: string; product: Product; text: string; setText: (t: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const { recent, remember, clear } = useRecentSearches(product.path);
  const [active, setActive] = useState(0);
  // Left alone for three seconds after opening, the palette flashes once so it is not missed.
  const [touched, setTouched] = useState(false);
  const [flash, setFlash] = useState(false);
  const q = useDebounced(text, 90);
  const res = useFind(base, q);
  const typed = Boolean(text.trim());
  const d = typed ? res.data : undefined;
  const opts = useMemo<Option[]>(
    () => (typed ? options(app, d) : recent.map((r) => ({ key: `recent:${r}`, fill: r, glyph: "clock", title: r }))),
    [app, typed, d, recent],
  );
  useEffect(() => {
    ref.current?.showModal();
    input.current?.select();
  }, []);
  useEffect(() => {
    if (touched) return;
    const t = setTimeout(() => setFlash(true), 3000);
    return () => clearTimeout(t);
  }, [touched]);
  useEffect(() => setActive(0), [d, typed]);
  const go = (o: Option | undefined) => {
    if (!o) return;
    if (o.fill !== undefined) {
      setText(o.fill);
      input.current?.focus();
      return;
    }
    remember(text);
    onClose();
    navigate(o.href!);
  };
  const all = () => {
    const words = text.trim();
    if (!words) return;
    remember(words);
    setText("");
    onClose();
    navigate(`${app}/search?q=${encodeURIComponent(words)}`);
  };
  const searching = typed && (res.isPending || q !== text);
  const note = d ? understood(d) : null;
  const total = d?.results.length;
  return (
    <dialog
      ref={ref}
      className={`find-pal${flash ? " is-flash" : ""}`}
      aria-label={`Search ${product.name}`}
      onKeyDown={() => setTouched(true)}
      onPointerDown={() => setTouched(true)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="find-pal-field">
        <Glyph name={searching ? "loader" : "search"} className={searching ? "spin" : undefined} />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={opts.length > 0}
          aria-controls={opts.length ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={opts[active] ? `${listId}-${active}` : undefined}
          aria-keyshortcuts={typed ? "Meta+Enter Control+Enter" : undefined}
          placeholder={`Search ${product.name}`}
          value={text}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, opts.length - 1));
            } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) all();
              else go(opts[active]);
            }
          }}
        />
        {typed ? (
          <button type="button" className="btn btn-md find-pal-all" onClick={all}>
            {total ? `All ${total} ${total === 1 ? "result" : "results"}` : "All results"}
            <kbd>{shortcutLabel("↵")}</kbd>
          </button>
        ) : null}
      </div>
      {note ? <p className="find-pal-note">{note}</p> : null}
      {!typed && recent.length ? (
        <div className="find-pal-head">
          <span id={`${listId}-h`}>Recent searches</span>
          <button type="button" className="panel-text-button" onClick={clear}>
            Clear
          </button>
        </div>
      ) : null}
      {typed && d && !d.results.length ? (
        <p className="find-pal-empty">
          Nothing in {product.name} matches “{text.trim()}”. Try another word for the same thing.
        </p>
      ) : null}
      {opts.length ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={typed ? "Results" : undefined}
          aria-labelledby={typed ? undefined : `${listId}-h`}
          className={`find-pal-list${typed ? "" : " find-pal-recent"}`}
          aria-busy={searching || undefined}
        >
          {opts.map((o, i) => (
            <li
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="find-pal-opt"
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => go(o)}
            >
              <Glyph name={o.glyph} />
              <span className="find-pal-main">
                <span className="find-pal-title">
                  <span className="ellipsis">{o.title}</span>
                  {o.meta ? <span className="find-pal-meta">{o.meta}</span> : null}
                </span>
                {o.line ? <span className="find-pal-line">{o.line}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </dialog>
  );
}

/** How the query was read, in words: a corrected word, a kind brought first, words that hold nothing together. */
export function understood(d: FindResponse): ReactNode {
  const parts: ReactNode[] = [];
  if (d.corrections.length)
    parts.push(
      <span key="c">
        Showing results for{" "}
        {d.corrections.map((c, i) => (
          <b key={i}>{(i ? ", " : "") + c.to}</b>
        ))}
        .
      </span>,
    );
  if (d.kind_hint) parts.push(<span key="k">{kindOf(d.kind_hint).label} first.</span>);
  if (d.partial) parts.push(<span key="p">Nothing has all your words; these have most of them.</span>);
  return parts.length ? parts : null;
}

/** Holds the palette, and the words in it, for a product's screens, and listens for its shortcuts. */
export function FindProvider({ app, base, product, children }: { app: string; base: string; product: Product; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const loc = useLocation();
  const show = useCallback((initial?: string) => {
    if (initial !== undefined) setText(initial);
    setOpen(true);
  }, []);
  // A reader has only the Story, which search does not cover.
  const enabled = product.your_role !== "reader";
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target);
      if (!cmdK && !slash) return;
      if (document.querySelector("dialog[open]:not(.find-pal)")) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
  // Following a result closes it; so does any other navigation. Another product starts empty.
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => setText(""), [base]);
  return (
    <FindContext.Provider value={show}>
      {children}
      {open ? <Palette app={app} base={base} product={product} text={text} setText={setText} onClose={() => setOpen(false)} /> : null}
    </FindContext.Provider>
  );
}

/** The panel's Search field: a button that opens the palette, with its shortcut. */
export function FindLauncher({ product }: { product: Product }) {
  const open = useOpenFind();
  return (
    <div className="find-launch-wrap">
      <button type="button" className="find-launch" onClick={() => open()} aria-keyshortcuts="Meta+K Control+K /">
        <Glyph name="search" size="sm" />
        <span className="find-launch-label ellipsis">Search {product.name}</span>
        <kbd>{shortcutLabel("K")}</kbd>
      </button>
    </div>
  );
}
