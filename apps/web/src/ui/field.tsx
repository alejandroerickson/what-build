import { useEffect, useId, useState, type ComponentProps, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Glyph } from "./glyph.tsx";

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
}

/** How long typing rests before a screen reader is told where the text stands against its limit. */
const SAY_AFTER_MS = 800;

/** How far a text is over a limit, counted as the server counts it: what is saved is trimmed. */
function charactersOver(text: string, limit: number): number {
  return Math.max(0, text.trim().length - limit);
}

/** Whether a field's text is over its limit, so the form it is in refuses to save it. */
export function tooLong(text: string, limit: number): boolean {
  return charactersOver(text, limit) > 0;
}

/**
 * What a field with `maxLength` says of its text. The limit is never given to the browser, which
 * cuts what is pasted without a word: the text stays as typed, its field says how much is over, and
 * the form refuses to save it (`tooLong`). A read-only field holds what was saved, so says nothing.
 */
function useLimit(value: unknown, limit: number | undefined, readOnly: unknown) {
  const over = typeof value === "string" && limit !== undefined && !readOnly ? charactersOver(value, limit) : 0;
  const problem = over ? `${over.toLocaleString()} ${over === 1 ? "character" : "characters"} over the limit of ${limit!.toLocaleString()}. Shorten it to save.` : null;
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (!problem && !said) return;
    const wait = setTimeout(() => setSaid(problem ?? "Within the limit now."), SAY_AFTER_MS);
    return () => clearTimeout(wait);
    // Said for each new state of the text, never again for having been said.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem]);
  return { problem, said: limit === undefined ? null : said };
}

function describedBy(id: string, hint: unknown, error: unknown) {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

function FieldFrame({ id, label, hint, error, optional, said, children }: FieldShell & { id: string; said?: string | null; children: ReactNode }) {
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional ? <span className="field-optional"> (optional)</span> : null}
      </label>
      <div className="field-control">
        {children}
        {hint ? (
          <div className="field-hint" id={`${id}-hint`}>
            {hint}
          </div>
        ) : null}
        {error ? (
          <div className="field-error" id={`${id}-error`}>
            <Glyph name="circle-alert" size="sm" />
            <span>{error}</span>
          </div>
        ) : null}
        {said === null || said === undefined ? null : (
          <div className="visually-hidden" aria-live="polite">
            {said}
          </div>
        )}
      </div>
    </div>
  );
}

/** A labelled text input. Read-only inputs look read-only (no border, no fill). */
export function TextField({ label, hint, error, optional, className = "", maxLength, ...rest }: FieldShell & ComponentProps<"input">) {
  const id = useId();
  const { problem, said } = useLimit(rest.value, maxLength, rest.readOnly);
  const shown = problem ?? error;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={shown} optional={optional} said={said}>
      <input id={id} className={`input ${className}`} aria-invalid={shown ? true : undefined} aria-describedby={describedBy(id, hint, shown)} {...rest} />
    </FieldFrame>
  );
}

export function TextArea({ label, hint, error, optional, className = "", maxLength, ...rest }: FieldShell & ComponentProps<"textarea">) {
  const id = useId();
  const { problem, said } = useLimit(rest.value, maxLength, rest.readOnly);
  const shown = problem ?? error;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={shown} optional={optional} said={said}>
      <textarea id={id} className={`input textarea ${className}`} aria-invalid={shown ? true : undefined} aria-describedby={describedBy(id, hint, shown)} {...rest} />
    </FieldFrame>
  );
}

export function SelectField({ label, hint, error, optional, children, className = "", ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <span className="select-wrap">
        <select id={id} className={`input select ${className}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>
          {children}
        </select>
        <Glyph name="chevron-down" size="sm" />
      </span>
    </FieldFrame>
  );
}

/** Lays fields out as a two-column form: labels in a 140px column, controls beside them. One column on a phone. */
export function FormGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`form-grid ${className}`}>{children}</div>;
}

/**
 * A search field drawn as a fill, with a leading search glyph. The label is visually hidden, so the
 * placeholder should repeat it.
 */
export function FindField({ label, className = "", ...rest }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={`find ${className}`}>
      <span className="visually-hidden">{label}</span>
      <Glyph name="search" size="sm" />
      <input type="search" autoComplete="off" placeholder={label} {...rest} />
    </label>
  );
}

/**
 * A checkbox or radio with its label as one 28px row, and an optional count at the right.
 * `boxed` draws the checked row with a fill and border (for a short list of exclusive options).
 * A hint under the label describes the choice: the label (and count) name it, and the hint is its
 * description, so a screen reader does not read the whole hint as its name.
 */
export function ChoiceRow({ type = "checkbox", label, count, hint, variant = "plain", className = "", ...rest }: {
  type?: "checkbox" | "radio";
  label: ReactNode;
  count?: ReactNode;
  hint?: ReactNode;
  variant?: "plain" | "boxed";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const id = useId();
  const counted = count !== undefined;
  return (
    <label className={`choice-row choice-${variant} ${className}`}>
      <input
        type={type}
        aria-labelledby={hint ? `${id}-label${counted ? ` ${id}-count` : ""}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...rest}
      />
      <span className="choice-label">
        <span id={`${id}-label`}>{label}</span>
        {hint ? (
          <span className="choice-hint" id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </span>
      {counted ? (
        <span className="choice-count num" id={`${id}-count`}>
          {count}
        </span>
      ) : null}
    </label>
  );
}
