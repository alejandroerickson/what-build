import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Glyph } from "./glyph.tsx";

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
}

function describedBy(id: string, hint: unknown, error: unknown) {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

function FieldFrame({ id, label, hint, error, optional, children }: FieldShell & { id: string; children: ReactNode }) {
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
      </div>
    </div>
  );
}

/** A labelled text input. Read-only inputs look read-only (no border, no fill). */
export function TextField({ label, hint, error, optional, className = "", ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <input id={id} className={`input ${className}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </FieldFrame>
  );
}

export function TextArea({ label, hint, error, optional, className = "", ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea id={id} className={`input textarea ${className}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
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
