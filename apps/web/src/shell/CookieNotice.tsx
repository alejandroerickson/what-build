import { useState } from "react";
import { useLocation } from "react-router";
import { Button, ButtonLink, Glyph } from "../ui/index.tsx";
import { prefersReducedMotion } from "../ui/media.ts";
import "../styles/screens/cookies.css";

export const COOKIE_NOTICE_KEY = "whatbuild.cookie-notice";

function readSeen(): boolean {
  try {
    return localStorage.getItem(COOKIE_NOTICE_KEY) === "seen";
  } catch {
    return false;
  }
}

/**
 * What WhatBuild keeps in the browser, said once in the bottom corner of every screen until the
 * person dismisses it. It blocks nothing and never takes focus, so the app works the same whether
 * anyone reads it. It offers no choice because there is none to make: everything stored is needed
 * for the service or remembers a choice the person made. `/cookies` lists each item.
 */
export function CookieNotice() {
  const [state, setState] = useState<"open" | "closing" | "gone">(() => (readSeen() ? "gone" : "open"));
  const { pathname } = useLocation();
  if (state === "gone") return null;
  const dismiss = () => {
    try {
      localStorage.setItem(COOKIE_NOTICE_KEY, "seen");
    } catch {
      // Storage is blocked: the notice comes back on the next visit.
    }
    setState("closing");
    setTimeout(() => setState("gone"), prefersReducedMotion() ? 0 : 160);
  };
  return (
    <aside className="cookie-notice" aria-label="Cookies" data-state={state}>
      <Glyph name="cookie" className="cookie-notice-glyph" />
      <p className="cookie-notice-text">
        <b>Only the cookies WhatBuild needs.</b> One keeps you signed in, and this browser remembers display choices such as the theme. No analytics, no ads.
      </p>
      <div className="cookie-notice-actions">
        {pathname === "/cookies" ? null : (
          <ButtonLink to="/cookies" size="sm" variant="quiet">
            What&rsquo;s stored
          </ButtonLink>
        )}
        <Button size="sm" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </aside>
  );
}
