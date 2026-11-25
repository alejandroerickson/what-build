import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

/**
 * The bot check: Cloudflare Turnstile's widget, on the forms anyone can send without being signed in
 * that make WhatBuild email someone or make an account (apps/server/src/bot-check.ts). The server
 * says whether it asks for one, with the widget's site key (`bot_check` in `/auth/methods` and in the
 * site's `whatbuild-site`); without one, nothing loads and nothing changes. The widget mostly
 * decides on its own, and shows itself only when it needs the person to do something.
 */

/** What the server says of its bot check: the site key the widget is drawn with, or null where it asks for none. */
export type BotCheckSetting = { site_key: string } | null | undefined;

/** The form a token is for, which the server checks it says. */
export type BotCheckAction = "sign_in" | "waitlist";

/** The field a form sends the token in (BOT_CHECK_FIELD in apps/server/src/bot-check.ts). */
export const BOT_CHECK_FIELD = "bot_check";

/** What the person reads when the check could not decide: nothing they can fix but a reload. */
export const BOT_CHECK_FAILED = "WhatBuild couldn’t check that you’re a person. Reload the page and try again.";

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Turnstile> | null = null;

/** Cloudflare's script, loaded once for the page, the first time a form asks for the check. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("blocked"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The widget for one form. `slot` goes where the widget may show itself, kept in place while the
 * form is on the page; `take` waits for a token
 * and hands it over once, then asks the widget for the next, since the server redeems each token
 * once; it is undefined where the deployment asks for no check, and rejects with BOT_CHECK_FAILED
 * when the check could not decide.
 */
export function useBotCheck(setting: BotCheckSetting, action: BotCheckAction) {
  const siteKey = setting?.site_key ?? null;
  const box = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<((t: string | null) => void)[]>([]);
  const [failed, setFailedState] = useState(false);
  // What `take` reads: a click while the check stands failed is told so at once, not left waiting.
  const failedNow = useRef(false);
  const setFailed = (f: boolean) => {
    failedNow.current = f;
    setFailedState(f);
  };

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    const give = (t: string | null) => waiting.current.splice(0).forEach((w) => w(t));
    loadTurnstile().then(
      (t) => {
        if (gone || !box.current) return;
        widget.current = t.render(box.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          size: "flexible",
          appearance: "interaction-only",
          callback: (value: string) => {
            token.current = value;
            setFailed(false);
            give(value);
          },
          "expired-callback": () => {
            token.current = null;
          },
          "error-callback": () => {
            token.current = null;
            setFailed(true);
            give(null);
            // Handled here: the widget tries again by itself.
            return true;
          },
        });
      },
      () => {
        if (gone) return;
        setFailed(true);
        give(null);
      },
    );
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
      token.current = null;
    };
  }, [siteKey, action]);

  const take = useCallback(async (): Promise<string | undefined> => {
    if (!siteKey) return undefined;
    if (!token.current && failedNow.current) throw new Error(BOT_CHECK_FAILED);
    const t = token.current ?? (await new Promise<string | null>((resolve) => waiting.current.push(resolve)));
    if (!t) throw new Error(BOT_CHECK_FAILED);
    token.current = null;
    if (widget.current) window.turnstile?.reset(widget.current);
    return t;
  }, [siteKey]);

  // Where the widget shows itself when it needs the person; a failure is told by the form that asked.
  const slot: ReactNode = siteKey ? <div ref={box} className="bot-check" /> : null;

  return { on: Boolean(siteKey), slot, take, failed };
}

/**
 * A link that starts signing in with a provider (`/auth/google`, `/auth/microsoft`), carrying the
 * bot check's token where the deployment asks for one: the click waits for it, then goes.
 */
export function useProviderLink(take: () => Promise<string | undefined>, onFailed: (message: string) => void) {
  const [going, setGoing] = useState<string | null>(null);
  const go = (href: string) => async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setGoing(href);
    try {
      const t = await take();
      window.location.assign(t ? `${href}${href.includes("?") ? "&" : "?"}${BOT_CHECK_FIELD}=${encodeURIComponent(t)}` : href);
    } catch (error) {
      setGoing(null);
      onFailed(error instanceof Error ? error.message : BOT_CHECK_FAILED);
    }
  };
  return { going, go };
}
