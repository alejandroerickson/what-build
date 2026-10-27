import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./button.tsx";

/**
 * A native modal dialog: the browser traps and restores focus. Escape and a click on the backdrop
 * close it unless `dismissable` is false (while a save is running, for example). The click must
 * start on the backdrop too: selecting text in a field and letting go outside keeps it open.
 */
export function Dialog({ open, onClose, title, description, children, footer, dismissable = true, wide }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  dismissable?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  /** Whether the press that led to the coming click started on the backdrop. */
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? " dialog-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        const fromBackdrop = pressedBackdrop.current;
        pressedBackdrop.current = false;
        if (dismissable && fromBackdrop && e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {dismissable ? <IconButton label="Close" icon="x" onClick={onClose} /> : null}
      </div>
      {description ? (
        <p id={descId} className="dialog-description">
          {description}
        </p>
      ) : null}
      <div className="dialog-body">{children}</div>
      {footer ? <div className="dialog-foot">{footer}</div> : null}
    </dialog>
  );
}
