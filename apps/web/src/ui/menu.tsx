import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { Glyph, type GlyphName } from "./glyph.tsx";
import { prefersReducedMotion } from "./media.ts";

const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
const ENABLED = `:is(${ITEM}):not([aria-disabled="true"])`;
const EXIT_MS = 100;

const MenuContext = createContext<{ close: (returnFocus?: boolean) => void } | null>(null);

type State = "closed" | "open" | "closing";

/**
 * A popover menu on a button. It opens below the trigger (or above, with side="top"), flips when it
 * would leave the window, and is drawn in a portal so a panel's overflow never clips it.
 *
 * Keyboard: ↑/↓ move and wrap, Home/End jump, a letter jumps to the next item starting with it,
 * Esc and Tab close and return focus to the trigger; ↓ or ↑ on the trigger opens it.
 */
export function Menu({ label, trigger, triggerClassName = "menu-trigger", title, children, align = "end", side = "bottom", minWidth = 200 }: {
  /** Accessible name for the trigger. Leave it out when the trigger's visible text names it. */
  label?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  title?: string;
  children: ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  minWidth?: number;
}) {
  const [state, setState] = useState<State>("closed");
  const [focusLast, setFocusLast] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus = true) => {
    setState((s) => (s === "open" ? "closing" : s));
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state !== "closing") return;
    const t = setTimeout(() => setState("closed"), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(t);
  }, [state]);

  useLayoutEffect(() => {
    if (state !== "open") return;
    const menu = menuRef.current;
    const t = triggerRef.current;
    if (!menu || !t) return;
    const place = () => {
      const r = t.getBoundingClientRect();
      menu.style.minWidth = `${Math.max(r.width, minWidth)}px`;
      const m = menu.getBoundingClientRect();
      let x = align === "end" ? r.right - m.width : r.left;
      x = Math.max(8, Math.min(x, window.innerWidth - m.width - 8));
      let y = side === "top" ? r.top - m.height - 6 : r.bottom + 6;
      if (side === "bottom" && y + m.height > window.innerHeight - 8) y = r.top - m.height - 6;
      if (side === "top" && y < 8) y = r.bottom + 6;
      y = Math.max(8, Math.min(y, window.innerHeight - m.height - 8));
      menu.style.left = `${Math.round(x)}px`;
      menu.style.top = `${Math.round(y)}px`;
      menu.style.visibility = "visible";
    };
    place();
    const items = [...menu.querySelectorAll<HTMLElement>(ENABLED)];
    (focusLast ? items[items.length - 1] : items[0])?.focus();
  }, [state, align, side, minWidth, focusLast]);

  useEffect(() => {
    if (state !== "open") return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [state, close]);

  const openWith = (last: boolean) => {
    setFocusLast(last);
    setState("open");
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(ENABLED) ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
      const hit = order.find((el) => (el.textContent ?? "").trim().toLowerCase().startsWith(k));
      if (hit) {
        e.preventDefault();
        hit.focus();
      }
    }
  };

  const shown = state !== "closed";
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={state === "open"}
        aria-controls={shown ? menuId : undefined}
        aria-label={label}
        title={title}
        onClick={() => (state === "open" ? close(false) : openWith(false))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openWith(e.key === "ArrowUp");
          }
        }}
      >
        {trigger}
      </button>
      {shown
        ? createPortal(
            <MenuContext.Provider value={{ close }}>
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={label}
                className="menu"
                data-state={state}
                style={{ visibility: "hidden", left: -9999, top: -9999 }}
                onKeyDown={onMenuKey}
              >
                {children}
              </div>
            </MenuContext.Provider>,
            document.body,
          )
        : null}
    </>
  );
}

function useMenu() {
  return useContext(MenuContext);
}

interface ItemSlots {
  icon?: GlyphName;
  /** A keyboard shortcut, shown right-aligned in the kbd style. */
  kbd?: string;
  /** A short description, shown right-aligned in faint text ("Reversible", "3 people"). */
  meta?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

function Slots({ icon, kbd, meta, children, check }: ItemSlots & { check?: boolean }) {
  return (
    <>
      {check !== undefined ? <Glyph name="check" className="menu-check" /> : null}
      {icon ? <Glyph name={icon} /> : null}
      <span className="menu-text">{children}</span>
      {meta ? <span className="menu-meta">{meta}</span> : null}
      {kbd ? <kbd className="menu-kbd">{kbd}</kbd> : null}
    </>
  );
}

/** A command or a link. Choosing it closes the menu. */
export function MenuItem({ onSelect, to, href, download, tone, keepOpen, ...slots }: ItemSlots & {
  onSelect?: () => void;
  /** An in-app route. */
  to?: string;
  /** An external or file URL. */
  href?: string;
  download?: boolean;
  tone?: "danger";
  keepOpen?: boolean;
}) {
  const menu = useMenu();
  const cls = `menu-item${tone === "danger" ? " menu-item-danger" : ""}`;
  const activate = (e: { preventDefault: () => void }) => {
    if (slots.disabled) {
      e.preventDefault();
      return;
    }
    onSelect?.();
    if (!keepOpen) menu?.close(!to && !href);
  };
  if (to && !slots.disabled)
    return (
      <Link role="menuitem" to={to} className={cls} tabIndex={-1} onClick={activate}>
        <Slots {...slots} />
      </Link>
    );
  if (href && !slots.disabled)
    return (
      <a role="menuitem" href={href} download={download} className={cls} tabIndex={-1} onClick={activate}>
        <Slots {...slots} />
      </a>
    );
  return (
    <button type="button" role="menuitem" className={cls} tabIndex={-1} aria-disabled={slots.disabled || undefined} onClick={activate}>
      <Slots {...slots} />
    </button>
  );
}

/** One of a set of exclusive choices; put a set inside a MenuGroup. */
export function MenuRadio({ checked, onSelect, keepOpen, ...slots }: ItemSlots & { checked: boolean; onSelect: () => void; keepOpen?: boolean }) {
  const menu = useMenu();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-disabled={slots.disabled || undefined}
      className="menu-item"
      tabIndex={-1}
      onClick={() => {
        if (slots.disabled) return;
        onSelect();
        if (!keepOpen) menu?.close(true);
      }}
    >
      <Slots {...slots} check={checked} />
    </button>
  );
}

/** An on/off choice. The menu stays open so several can be toggled. */
export function MenuCheckbox({ checked, onChange, ...slots }: ItemSlots & { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={slots.disabled || undefined}
      className="menu-item"
      tabIndex={-1}
      onClick={() => !slots.disabled && onChange(!checked)}
    >
      <Slots {...slots} check={checked} />
    </button>
  );
}

/** Groups items (radios in particular) under an optional visible label that names the group. */
export function MenuGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={label ? id : undefined}>
      {label ? (
        <div className="menu-label" id={id}>
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Context at the top of a menu: the page's title, the signed-in email, the organization. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}

/** A wrapped sentence of explanation. */
export function MenuNote({ children }: { children: ReactNode }) {
  return <div className="menu-note">{children}</div>;
}

export function MenuSeparator() {
  return <div role="separator" className="menu-sep" />;
}
