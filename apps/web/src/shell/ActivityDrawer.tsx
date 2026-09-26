import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useProduct } from "../lib/session.tsx";
import { IconClose } from "../ui/icons.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";

/**
 * Activity is a drawer on every product screen, filtered by default to what the screen shows:
 * the open source, entry or insight, or the whole product.
 */
export function ActivityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { app } = useProduct();
  const loc = useLocation();
  const parts = loc.pathname.slice(app.length).split("/").filter(Boolean);
  const entityId = parts.find((p) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(p)) ?? (parts[0] === "story" && parts[1] ? parts[1] : undefined);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="drawer" aria-labelledby="activity-title" onCancel={(e) => (e.preventDefault(), onClose())} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="drawer-head row-between">
        <div>
          <h2 id="activity-title" style={{ fontSize: "var(--text-lg)" }}>
            Activity
          </h2>
          <p className="small muted">{entityId ? "Changes to what you are looking at." : "Everything that changed in this product."}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close activity">
          <IconClose />
        </button>
      </div>
      <div className="drawer-body">{open ? <ActivityFeed entityId={entityId} compact /> : null}</div>
    </dialog>
  );
}
