import { useState, type ReactNode } from "react";
import { setCookieChoice, useCookieChoice, type CookieChoice as Choice } from "../lib/analytics.ts";
import { Button } from "../ui/button.tsx";
import { Glyph } from "../ui/glyph.tsx";
import { prefersReducedMotion } from "../ui/media.ts";
import "../styles/screens/cookies.css";

/**
 * The cookie choice in the bottom corner, for the app and the public site alike: Decline and
 * Accept, of equal weight, until the person picks one. It blocks nothing and never takes focus.
 * `open` shows it again after a choice, for changing it.
 */
export function CookieChoice({ purpose, link, open = false, onClose }: { purpose: string; link?: ReactNode; open?: boolean; onClose?: () => void }) {
  const choice = useCookieChoice();
  const [closing, setClosing] = useState(false);
  if (choice && !open && !closing) return null;
  const choose = (c: Choice) => {
    setClosing(true);
    setCookieChoice(c);
    setTimeout(() => {
      setClosing(false);
      onClose?.();
    }, prefersReducedMotion() ? 0 : 160);
  };
  return (
    <aside className="cookie-notice" aria-label="Cookies" data-state={closing ? "closing" : "open"}>
      <Glyph name="cookie" className="cookie-notice-glyph" />
      <p className="cookie-notice-text">
        <b>WhatBuild uses cookies</b> {purpose}
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
