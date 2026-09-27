import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { Glyph, type GlyphName } from "./glyph.tsx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ControlSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** sm is 24px tall, md (default) 28px. */
  size?: ControlSize;
  /** A leading glyph. While busy it becomes a spinner. */
  icon?: GlyphName;
  /** Shows a spinner, sets aria-busy and blocks further clicks. */
  busy?: boolean;
  /** Replaces the label while busy, e.g. "Saving…". */
  busyLabel?: string;
  wide?: boolean;
};

function buttonClass(variant: ButtonVariant, size: ControlSize, wide?: boolean, extra = "") {
  return `btn btn-${variant} btn-${size}${wide ? " btn-wide" : ""}${extra ? ` ${extra}` : ""}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, busy, busyLabel, wide, children, disabled, className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, wide, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Glyph name="loader" className="spin" /> : icon ? <Glyph name={icon} /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
});

/** A link that looks like a button. For navigation only; actions use Button. */
export function ButtonLink({ to, variant = "secondary", size = "md", icon, wide, children, className = "", target, rel }: {
  to: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: GlyphName;
  wide?: boolean;
  children: ReactNode;
  className?: string;
  target?: string;
  rel?: string;
}) {
  return (
    <Link to={to} className={buttonClass(variant, size, wide, className)} target={target} rel={rel}>
      {icon ? <Glyph name={icon} /> : null}
      {children}
    </Link>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** The accessible name; also the tooltip unless `title` is given. */
  label: string;
  icon: GlyphName;
  size?: ControlSize;
};

/** A square, icon-only button: 28px (md) or 24px (sm). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", title, className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={`icon-btn icon-btn-${size}${className ? ` ${className}` : ""}`} aria-label={label} title={title ?? label} {...rest}>
      <Glyph name={icon} />
    </button>
  );
});
