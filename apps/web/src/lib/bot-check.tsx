import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

/**
 * The bot check: Cloudflare Turnstile's widget, on the forms anyone can send without being signed in
 * that make WhatBuild email someone or make an account (apps/server/src/bot-check.ts). The server
 * says whether it asks for one, with the widget's site key (`bot_check` in `/auth/methods` and in the
 * site's `whatbuild-site`); without one, nothing loads and nothing changes.
 *
 * Nothing of Cloudflare's loads or runs while someone only reads the page: its script loads, and the
 * check runs, when they send the form (or press Continue with Google or Microsoft), as the privacy
 * page says. The widget mostly decides on its own in a second or two, and shows itself only when it
 * needs the person to do something.
 */

/** What the server says of its bot check: the site key the widget is drawn with, or null where it asks for none. */
export type BotCheckSetting = { site_key: string } | null | undefined;

/** The form a token is for, which the server checks it says. */
export type BotCheckAction = "sign_in" | "waitlist";

/** The field a form sends the token in (BOT_CHECK_FIELD in apps/server/src/bot-check.ts). */
export const BOT_CHECK_FIELD = "bot_check";

/** What the person reads when the check could not decide: nothing they can fix but trying again. */
export const BOT_CHECK_FAILED = "WhatBuild couldn’t check that you’re a person. Try again, or reload the page.";

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  execute(id: string): void;
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

/** Cloudflare's script, loaded once for the page, the first time a form is sent. */
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
 * form is on the page. `take` runs the check and hands over its token, which the server redeems
 * once: each call runs it afresh, one after another, so two presses never share a token. It is
 * undefined where the deployment asks for no check, and rejects with BOT_CHECK_FAILED when the
 * check could not decide; the next call tries again.
 */
export function useBotCheck(setting: BotCheckSetting, action: BotCheckAction) {
  const siteKey = setting?.site_key ?? null;
  const box = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  // The call waiting for the widget's answer, and the calls queued behind it.
  const pending = useRef<((t: string | null) => void) | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const ran = useRef(false);
  const gone = useRef(false);

  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
      ran.current = false;
      pending.current?.(null);
      pending.current = null;
    };
  }, [siteKey, action]);

  /** The widget, drawn the first time it is needed, to run only when asked (`execution: "execute"`). */
  const drawn = useCallback(async (): Promise<string> => {
    const t = await loadTurnstile();
    if (gone.current || !box.current) throw new Error(BOT_CHECK_FAILED);
    if (widget.current) return widget.current;
    const answer = (value: string | null) => {
      const give = pending.current;
      pending.current = null;
      give?.(value);
    };
    widget.current = t.render(box.current, {
      sitekey: siteKey,
      action,
      theme: "auto",
      size: "flexible",
      appearance: "interaction-only",
      execution: "execute",
      // Nothing runs behind the person's back: a token is handed over at once and never kept, and a
      // failure waits for the next send rather than trying again by itself.
      "refresh-expired": "never",
      retry: "never",
      callback: (value: string) => answer(value),
      "error-callback": () => {
        answer(null);
        // Handled here: the next send runs it again.
        return true;
      },
      "expired-callback": () => answer(null),
      "timeout-callback": () => answer(null),
      // Shown only while it needs the person, so the form keeps its shape the rest of the time.
      "before-interactive-callback": () => box.current?.setAttribute("data-shown", ""),
      "after-interactive-callback": () => box.current?.removeAttribute("data-shown"),
    });
    return widget.current;
  }, [siteKey, action]);

  const take = useCallback((): Promise<string | undefined> => {
    if (!siteKey) return Promise.resolve(undefined);
    const run = async (): Promise<string> => {
      let id: string;
      try {
        id = await drawn();
      } catch {
        throw new Error(BOT_CHECK_FAILED);
      }
      const t = window.turnstile!;
      const token = await new Promise<string | null>((resolve) => {
        pending.current = resolve;
        // A widget that ran before holds its last answer, so it starts again clean.
        if (ran.current) t.reset(id);
        ran.current = true;
        t.execute(id);
      });
      if (!token) throw new Error(BOT_CHECK_FAILED);
      return token;
    };
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => {});
    return next;
  }, [siteKey, drawn]);

  // Where the widget shows itself when it needs the person; a failure is told by the form that asked.
  const slot: ReactNode = siteKey ? <div ref={box} className="bot-check" /> : null;

  return { on: Boolean(siteKey), slot, take };
}

/**
 * The parameter that tells a page someone signed in came back to that the server refused their
 * check (`/signin?error=bot_check`, on starting Google or Microsoft sign-in again before deleting an
 * account), since the sign-in page sends someone signed in straight on.
 */
export const BOT_CHECK_REFUSED = "bot_check_refused";

/** `next` (a path on this origin), saying that the check was refused. */
export function withBotCheckRefused(next: string): string {
  const u = new URL(next, "https://origin.invalid");
  u.searchParams.set(BOT_CHECK_REFUSED, "1");
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * A link that starts signing in with a provider (`/auth/google`, `/auth/microsoft`), carrying the
 * bot check's token where the deployment asks for one: the click waits for it, then goes. `error`
 * says why the last click went nowhere, until the next click or `clear`.
 */
export function useProviderLink(take: () => Promise<string | undefined>) {
  const [going, setGoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (href: string) => async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setGoing(href);
    setError(null);
    try {
      const t = await take();
      window.location.assign(t ? `${href}${href.includes("?") ? "&" : "?"}${BOT_CHECK_FIELD}=${encodeURIComponent(t)}` : href);
    } catch (failure) {
      setGoing(null);
      setError(failure instanceof Error ? failure.message : BOT_CHECK_FAILED);
    }
  };
  return { going, go, error, clear: () => setError(null) };
}
