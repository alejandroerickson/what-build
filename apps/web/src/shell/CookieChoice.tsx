import { useEffect, useRef, useState, type ReactNode } from "react";
import { setCookieChoice, useCookieChoice, type CookieChoice as Choice } from "../lib/analytics.ts";
import { Button } from "../ui/button.tsx";
import { Glyph } from "../ui/glyph.tsx";
import { prefersReducedMotion } from "../ui/media.ts";
import "../styles/screens/cookies.css";

/**
 * The cookie choice in the bottom corner, for the app and the public site alike, and the one place
 * it is made: Decline and Accept, of equal weight, until the person picks one. It blocks nothing and
 * never takes focus by itself. `open` shows it again, after a choice, for changing it: asked for, it
 * comes at once and takes focus, which goes back to whatever asked once a choice is made.
 */
export function CookieChoice({ lead, ask, link, open = false, onClose }: { lead: string; ask: string; link?: ReactNode; open?: boolean; onClose?: () => void }) {
  const choice = useCookieChoice();
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
  }, [open]);
  if (choice && !open && !closing) return null;
  const choose = (c: Choice) => {
    setClosing(true);
    setCookieChoice(c);
    setTimeout(() => {
      setClosing(false);
      onClose?.();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      opener.current = null;
    }, prefersReducedMotion() ? 0 : 160);
  };
  return (
    <aside ref={box} className="cookie-notice" aria-label="Cookies" tabIndex={open ? -1 : undefined} data-asked={open ? "" : undefined} data-state={closing ? "closing" : "open"}>
      <Glyph name="cookie" className="cookie-notice-glyph" />
      <p className="cookie-notice-text">
        <b>{lead}</b> {ask}
      </p>
      <div className="cookie-notice-actions">
        {link}
        <Button size="sm" onClick={() => choose("declined")}>
          Decline
        </Button>
        <Button size="sm" onClick={() => choose("accepted")}>
          Accept
        </Button>
      </div>
    </aside>
  );
}
