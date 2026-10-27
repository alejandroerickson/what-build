import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "./button.tsx";
import { Glyph } from "./glyph.tsx";
import { Menu, MenuItem } from "./menu.tsx";
import { OneLine, useMeasure } from "./one-line.tsx";
import { useToast } from "./toast.tsx";

// ---- Sheets: the surface every non-Story screen is built from ----------------------------------

/** A white (dark: grey) rounded surface on the canvas. Consecutive sheets are spaced 16px apart. */
export function Sheet({ children, className = "", as: As = "section", labelledBy, label }: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "form";
  labelledBy?: string;
  label?: string;
}) {
  return (
    <As className={`sheet ${className}`} aria-labelledby={labelledBy} aria-label={label}>
      {children}
    </As>
  );
}

/**
 * The header row of a sheet: title, a count, an optional filter (a Segmented) and an end slot for
 * actions. On a list screen the title is the screen's h1 (`level={1}`).
 */
export function SheetHeader({ title, level = 2, count, filter, end, id }: {
  title: ReactNode;
  level?: 1 | 2 | 3;
  count?: ReactNode;
  filter?: ReactNode;
  end?: ReactNode;
  id?: string;
}) {
  const H = `h${level}` as "h1" | "h2" | "h3";
  return (
    <header className="sheet-head">
      <H className="sheet-title" id={id}>
        {title}
        {count !== undefined && count !== null ? <span className="sheet-count num">{count}</span> : null}
      </H>
      {filter ? <div className="sheet-filter">{filter}</div> : null}
      {end ? <div className="sheet-end">{end}</div> : null}
    </header>
  );
}

/** Padded text or form content inside a sheet, inset by --sheet-px. */
export function SheetBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`sheet-body ${className}`}>{children}</div>;
}

/** Kept for screens not yet rebuilt: a sheet with padded content. */
export function Card({ children, className = "", as = "section" }: { children: ReactNode; className?: string; as?: "section" | "article" | "div" }) {
  return (
    <Sheet as={as} className={`sheet-padded ${className}`}>
      {children}
    </Sheet>
  );
}

/**
 * One row of a list inside a sheet: an id column, a title with a sub line, and a right-hand cell.
 * With `to` the whole row is a real link (open in a new tab works). Screens that need different
 * columns add a class and set `grid-template-columns` in their own CSS.
 */
export function ListRow({ to, lead, title, sub, children, end, className = "" }: {
  to?: string;
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      {lead !== undefined ? <span className="list-lead num">{lead}</span> : null}
      <span className="list-main">
        <span className="list-title">{title}</span>
        {sub ? <span className="list-sub">{sub}</span> : null}
        {children}
      </span>
      {end !== undefined ? <span className="list-end">{end}</span> : null}
    </>
  );
  const cls = `list-row${lead === undefined ? " list-row-nolead" : ""}${className ? ` ${className}` : ""}`;
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * The filters a list is narrowed by, under its sheet head: one chip per filter that removes it, and
 * a way to clear them all. It keeps the view legible while the panel that set it is hidden.
 */
export function FiltersInUse({ chips, clearTo }: { chips: { label: string; to: string }[]; clearTo: string }) {
  if (!chips.length) return null;
  return <FilterChips chips={chips} clearTo={clearTo} />;
}

function FilterChips({ chips, clearTo }: { chips: { label: string; to: string }[]; clearTo: string }) {
  // A chip is as wide as its label, so a label is cut against the room the group has.
  const group = useRef<HTMLDivElement>(null);
  const measure = useMeasure(group);
  return (
    // A group, so its name is announced: a plain div's label is not.
    <div ref={group} className="filters-in-use" role="group" aria-label="Filters in use">
      {chips.map((c) => (
        <Link key={c.label} to={c.to} className="chip filters-in-use-chip" replace aria-label={`Remove filter: ${c.label}`}>
          <OneLine text={c.label} measure={measure} />
          <Glyph name="x" size="sm" />
        </Link>
      ))}
      <Link to={clearTo} className="quiet-link" replace>
        Clear filters
      </Link>
    </div>
  );
}

// ---- Page chrome --------------------------------------------------------------------------------

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Breadcrumbs. The last crumb is the current page. With `currentAsHeading` the current crumb is the
 * screen's h1, visually as quiet as the other crumbs (Story pages, whose own title lives in the
 * sandboxed frame). On a phone the middle crumbs fold into a "…" menu.
 */
export function Crumbs({ items, currentAsHeading, label = "Breadcrumbs" }: { items: Crumb[]; currentAsHeading?: boolean; label?: string }) {
  const mids = items.slice(1, -1);
  const nav = useRef<HTMLElement>(null);
  const measure = useMeasure(nav);
  return (
    <nav ref={nav} className="crumbs" aria-label={label}>
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          const mid = i > 0 && !last;
          const text = <OneLine text={c.label} measure={measure} />;
          return (
            <li key={`${i}:${c.label}`} className={mid ? "crumb-mid" : undefined}>
              {last ? (
                currentAsHeading ? (
                  <h1 className="crumb crumb-current" aria-current="page">
                    {text}
                  </h1>
                ) : (
                  <span className="crumb crumb-current" aria-current="page">
                    {text}
                  </span>
                )
              ) : c.to ? (
                <Link className="crumb" to={c.to} title={c.label}>
                  {text}
                </Link>
              ) : (
                <span className="crumb">{text}</span>
              )}
              {i === 0 && mids.length ? (
                <span className="crumb-fold">
                  <Menu label="Show the rest of the path" trigger={<Glyph name="ellipsis" />} triggerClassName="crumb" align="start">
                    {mids.map((m, j) => (m.to ? <MenuItem key={j} to={m.to}>{m.label}</MenuItem> : <MenuItem key={j} disabled>{m.label}</MenuItem>))}
                  </Menu>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The head of an item screen (a source, an assumption): crumbs, a 20px h1, a faint meta line
 * and actions at the right.
 */
export function PageHeader({ title, description, meta, actions, crumbs }: {
  title: ReactNode;
  /** A sentence under the title. */
  description?: ReactNode;
  /** A faint line of facts: id · kind · who · when. */
  meta?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <header className="page-head">
      {crumbs?.length ? <Crumbs items={crumbs} /> : null}
      <div className="page-head-row">
        <div className="page-head-main">
          <h1 className="page-title">{title}</h1>
          {meta ? <div className="page-meta">{meta}</div> : null}
          {description ? <p className="page-description">{description}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

// ---- Filters ------------------------------------------------------------------------------------

export interface SegmentedItem {
  id: string;
  label: ReactNode;
  count?: ReactNode;
  /** Makes the item a link (the filter lives in the URL); current is marked with aria-current. */
  to?: string;
  disabled?: boolean;
}

/**
 * The one segmented control. Link items for URL-backed filters and views (aria-current), button
 * items for local choices (aria-pressed). Never ARIA tabs: each item is a link or a toggle.
 */
export function Segmented({ label, items, value, onChange, equal, className = "" }: {
  label: string;
  items: SegmentedItem[];
  value: string;
  onChange?: (id: string) => void;
  /** Stretch items to equal widths filling the container. */
  equal?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`segmented${equal ? " segmented-equal" : ""} ${className}`}>
      {items.map((it) => {
        const on = it.id === value;
        const inner = (
          <>
            {it.label}
            {it.count !== undefined ? <span className="segmented-count num">{it.count}</span> : null}
          </>
        );
        return it.to && !it.disabled ? (
          <Link key={it.id} to={it.to} className="segmented-item" aria-current={on ? "page" : undefined}>
            {inner}
          </Link>
        ) : (
          <button key={it.id} type="button" className="segmented-item" aria-pressed={on} disabled={it.disabled} onClick={() => onChange?.(it.id)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

// ---- Inspector content --------------------------------------------------------------------------

/** A titled group in the inspector (or any narrow panel). */
export function Group({ title, count, action, children }: { title: ReactNode; count?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="group">
      <h3 className="group-title">
        <span>{title}</span>
        {count !== undefined ? <span className="group-count num">{count}</span> : null}
        {action ? <span className="group-action">{action}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Label and value pairs in two columns (64px labels). Rows with an empty value are left out. */
export function KeyValue({ items }: { items: { label: ReactNode; value: ReactNode; key?: string }[] }) {
  return (
    <dl className="kv">
      {items
        .filter((it) => it.value !== null && it.value !== undefined && it.value !== "")
        .map((it, i) => (
          <div className="kv-row" key={it.key ?? i}>
            <dt>{it.label}</dt>
            <dd>{it.value}</dd>
          </div>
        ))}
    </dl>
  );
}

// ---- People -------------------------------------------------------------------------------------

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** A person's initials in a 22px circle. Decorative: the name is always written next to it. */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** The mark for an agent, in place of an avatar. Decorative: the agent's name is written next to it. */
export function AgentFace() {
  return (
    <span className="agent-face" aria-hidden="true">
      <Glyph name="bot" size="sm" />
    </span>
  );
}

// ---- Command field ------------------------------------------------------------------------------

/** A single line of code (a command, a URL) with a Copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <code aria-label={label} tabIndex={0}>
        {value}
      </code>
      <Button
        size="sm"
        icon={copied ? "check" : "copy"}
        onClick={() => {
          navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
              toast("Copied.");
            })
            .catch(() => toast("Couldn’t copy. Select the text and copy it.", { tone: "negative" }));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
