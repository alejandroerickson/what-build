import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./button.tsx";

/**
 * A native modal dialog: the browser traps and restores focus. Escape and a click on the backdrop
 * close it unless `dismissable` is false (while a save is running, for example).
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
      onClick={(e) => {
        if (dismissable && e.target === ref.current) onClose();
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
