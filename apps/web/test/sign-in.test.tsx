import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_LINK_SUBJECT } from "@whatbuild/core/sign-in-link";
import { SignIn } from "../src/routes/auth.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Where() {
  const loc = useLocation();
  return <output>{`${loc.pathname}${loc.search}${loc.hash}`}</output>;
}

let unmount: (() => void) | null = null;
/** Takes the page away, to show another in the same test. */
function close() {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
}
afterEach(close);

/** Where the sign-in page sends someone already signed in who opened `/signin?next=<next>`, with `error` where one is given. */
async function returnsTo(next: string, error?: string): Promise<string> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["me"], { account_id: "a", email: "sam@example.com", display_name: "Sam" });
  qc.setQueryData(["auth-methods"], { email_link: true, google: false, microsoft: false, dev: false });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/signin?next=${encodeURIComponent(next)}${error ? `&error=${error}` : ""}`]}>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return host.querySelector("output")?.textContent ?? "(stayed on sign-in)";
}

describe("where the sign-in page returns to", () => {
  it("keeps a path on this origin", async () => {
    expect(await returnsTo("/t/acme/onboarding/story?page=intro#top")).toBe("/t/acme/onboarding/story?page=intro#top");
    expect(await returnsTo("/join/AbC-123_x")).toBe("/join/AbC-123_x");
  });

  it("goes home instead of anywhere a browser could read as another origin, by the server's rule", async () => {
    for (const next of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/%2F/evil.example", "/.//evil.example", "https://evil.example", "javascript:alert(1)"])
      expect(await returnsTo(next), JSON.stringify(next)).toBe("/");
  });
});

/**
 * The sign-in page's text for someone signed out who arrived at `/signin<search>`, on a deployment
 * that names `contact` and has a public site at `site`, or neither.
 */
async function signInPageAt(
  search: string,
  methods: { email_link: boolean; google: boolean; microsoft: boolean; dev: boolean; open?: boolean } = { email_link: true, google: false, microsoft: true, dev: false },
  deployment: { contact?: string | null; site?: string | null } = {},
): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["me"], null);
  qc.setQueryData(["auth-methods"], methods);
  qc.setQueryData(["plans"], { plans: [], starting_plan: "unlimited", limits: [], file_max_bytes: 0, contact: deployment.contact ?? null });
  qc.setQueryData(["meta"], { privacy_url: "/site/privacy/", site_url: deployment.site ?? null });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/signin${search}`]}>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return host;
}

describe("a refused Microsoft sign-in", () => {
  it("allows that the server's setup is at fault when no confirmed email came back, and shows the reference to pass on", async () => {
    const text = (await signInPageAt("?error=microsoft_no_verified_email&ref=K7Q2-M9XD")).textContent ?? "";
    expect(text).toContain("WhatBuild couldn’t confirm your email with Microsoft");
    expect(text).toContain("usually the server’s setup, not your account");
    expect(text).toContain("tell whoever runs WhatBuild here, with the reference K7Q2-M9XD.");
    expect(text).toContain("you can use an email link");
    // A valid person is not sent to look for another account.
    expect(text).not.toMatch(/another account|work account in this organization/i);
  });

  it("says the sign-in came from another directory, with its reference", async () => {
    const text = (await signInPageAt("?error=microsoft_wrong_directory&ref=AB12-CD34")).textContent ?? "";
    expect(text).toContain("That Microsoft sign-in came from another directory");
    expect(text).toContain("with the reference AB12-CD34");
  });

  it("shows only a reference in the server's form, so a crafted link cannot put words on the page", async () => {
    const text = (await signInPageAt(`?error=microsoft_no_verified_email&ref=${encodeURIComponent("Call 555-0100")}`)).textContent ?? "";
    expect(text).not.toContain("555");
    expect(text).toContain("tell whoever runs WhatBuild here.");
  });

  it("says to write to the deployment's contact, where it names one, with the reference", async () => {
    const host = await signInPageAt("?error=microsoft_no_verified_email&ref=K7Q2-M9XD", undefined, { contact: "hello@example.com" });
    expect(host.textContent).toContain("write to hello@example.com, with the reference K7Q2-M9XD.");
    expect(host.textContent).not.toContain("whoever runs");
    expect(host.querySelector('a[href="mailto:hello@example.com"]')).not.toBeNull();
  });

  it("still explains an old link's microsoft_unverified, and offers no email link where there is none", async () => {
    const text = (await signInPageAt("?error=microsoft_unverified", { email_link: false, google: false, microsoft: true, dev: false })).textContent ?? "";
    expect(text).toContain("That Microsoft sign-in didn’t work here");
    expect(text).toContain("the server’s setup may be at fault");
    expect(text).not.toContain("email link");
  });
});

describe("a sign-in refused as invite-only", () => {
  it("points to the public site's waitlist, where the deployment has one", async () => {
    const host = await signInPageAt("?error=invite_only", undefined, { site: "https://site.example" });
    const callout = host.querySelector(".callout-text")!;
    expect(callout.textContent).toBe("Ask someone who uses it to invite you, or join the waitlist at site.example.");
    expect(callout.querySelector("a")?.getAttribute("href")).toBe("https://site.example/#interest");
  });

  it("says only to ask for an invitation where it has none", async () => {
    const host = await signInPageAt("?error=invite_only");
    expect(host.querySelector(".callout-text")?.textContent).toBe("Ask someone who uses it to invite you.");
  });
});

describe("asking for a sign-in link", () => {
  it("says where to look and for how long, never that a link was sent, with the development note after", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ received: true, dev_note: "In development, a link is printed in the server’s terminal." }), { status: 200 }));
    try {
      const host = await signInPageAt("", { email_link: true, google: false, microsoft: false, dev: false });
      const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "maya@example.com");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      await act(() => new Promise((r) => setTimeout(r, 20)));
      expect(host.querySelector(".callout-title")?.textContent).toBe("Check your email");
      // The mail's own subject, so they know which one to look for among the rest.
      expect(host.querySelector(".callout-text")?.textContent).toBe(
        `Look in maya@example.com for an email from WhatBuild called “${SIGN_IN_LINK_SUBJECT}”. Its link works for 15 minutes. In development, a link is printed in the server’s terminal.`,
      );
      expect(SIGN_IN_LINK_SUBJECT).toBe("Your WhatBuild sign-in link");
      expect(host.textContent).not.toMatch(/on its way|was sent/);
      expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Use another email")).toBe(true);
    } finally {
      fetched.mockRestore();
    }
  });
});

describe("the bot check", () => {
  /** Cloudflare's widget, standing in for its script: drawn when asked, it hands a new token each time it runs, or fails. */
  function standInTurnstile(first: "token" | "error") {
    const drawn: Record<string, unknown>[] = [];
    const runs: number[] = [];
    const reset = vi.fn();
    let n = 0;
    /** What it does the next time it runs, which a test may change. */
    const state = { outcome: first };
    window.turnstile = {
      render(_el: HTMLElement, options: Record<string, unknown>) {
        drawn.push(options);
        return "widget-1";
      },
      execute() {
        const options = drawn.at(-1)!;
        runs.push(Date.now());
        setTimeout(() => (state.outcome === "token" ? (options["callback"] as (t: string) => void)(`token-${++n}`) : (options["error-callback"] as () => void)()));
      },
      reset,
      remove: vi.fn(),
    };
    return { drawn, runs, reset, state };
  }
  afterEach(() => {
    delete window.turnstile;
    vi.unstubAllGlobals();
  });
  const WITH_CHECK = { email_link: true, google: true, microsoft: false, dev: false, bot_check: { site_key: "1x00000000000000000000AA" } } as never;
  const typeEmail = async (host: HTMLElement, email: string) => {
    const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, email);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const askFor = async (host: HTMLElement, email: string) => {
    await typeEmail(host, email);
    await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await act(() => new Promise((r) => setTimeout(r, 20)));
  };
  const google = (host: HTMLElement) => [...host.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === "Continue with Google")!;
  const press = async (a: HTMLAnchorElement) => {
    await act(async () => a.click());
    await act(() => new Promise((r) => setTimeout(r, 20)));
  };

  it("runs nothing of Cloudflare's while the page is only read, and runs the check when the form is sent, sending its token", async () => {
    const widget = standInTurnstile("token");
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ received: true }), { status: 200 }));
    try {
      const host = await signInPageAt("", WITH_CHECK);
      await act(() => new Promise((r) => setTimeout(r, 20)));
      await typeEmail(host, "maya@example.com");
      // Opened and typed into: no widget drawn, no check run.
      expect(widget.drawn).toEqual([]);
      expect(widget.runs).toEqual([]);
      await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
      await act(() => new Promise((r) => setTimeout(r, 20)));
      expect(widget.drawn).toHaveLength(1);
      expect(widget.drawn[0]).toMatchObject({ sitekey: "1x00000000000000000000AA", action: "sign_in", appearance: "interaction-only", execution: "execute", "refresh-expired": "never", retry: "never" });
      expect(widget.runs).toHaveLength(1);
      const sent = fetched.mock.calls.find(([url]) => String(url).endsWith("/auth/email"))!;
      expect(JSON.parse(String((sent[1] as RequestInit).body))).toMatchObject({ email: "maya@example.com", bot_check: "token-1" });
      expect(host.querySelector(".callout-title")?.textContent).toBe("Check your email");
      // Another link: the same widget runs again, from a clean start, for a token of its own.
      await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Use another email")!.click());
      await act(() => new Promise((r) => setTimeout(r, 20)));
      await askFor(host, "maya@example.com");
      expect(widget.drawn).toHaveLength(1);
      expect(widget.reset).toHaveBeenCalledWith("widget-1");
      const again = fetched.mock.calls.filter(([url]) => String(url).endsWith("/auth/email")).at(-1)!;
      expect(JSON.parse(String((again[1] as RequestInit).body))).toMatchObject({ bot_check: "token-2" });
    } finally {
      fetched.mockRestore();
    }
  });

  it("gives each of two presses made together a token of its own", async () => {
    standInTurnstile("token");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ received: true }), { status: 200 }));
    try {
      const host = await signInPageAt("", WITH_CHECK);
      await typeEmail(host, "maya@example.com");
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
        google(host).click();
      });
      await act(() => new Promise((r) => setTimeout(r, 40)));
      const sent = fetched.mock.calls.find(([url]) => String(url).endsWith("/auth/email"))!;
      const tokens = [JSON.parse(String((sent[1] as RequestInit).body)).bot_check, new URL(String(assign.mock.calls[0]![0]), "https://origin.invalid").searchParams.get("bot_check")];
      expect(tokens.sort()).toEqual(["token-1", "token-2"]);
    } finally {
      fetched.mockRestore();
    }
  });

  it("says so, and sends nothing, when the widget could not decide", async () => {
    standInTurnstile("error");
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ received: true }), { status: 200 }));
    try {
      const host = await signInPageAt("", WITH_CHECK);
      await askFor(host, "maya@example.com");
      expect(fetched.mock.calls.some(([url]) => String(url).endsWith("/auth/email"))).toBe(false);
      expect(host.textContent).toContain("WhatBuild couldn’t check that you’re a person. Try again, or reload the page.");
    } finally {
      fetched.mockRestore();
    }
  });

  it("starts Google sign-in with the token once the check passes, and says why, until the next try, when it could not decide", async () => {
    const widget = standInTurnstile("token");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const host = await signInPageAt("?next=%2Ft%2Facme", WITH_CHECK);
    await press(google(host));
    expect(assign).toHaveBeenCalledWith("/auth/google?next=%2Ft%2Facme&bot_check=token-1");
    expect(widget.drawn[0]).toMatchObject({ action: "sign_in", execution: "execute" });
    close();

    const flaky = standInTurnstile("error");
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ received: true }), { status: 200 }));
    try {
      const failing = await signInPageAt("", WITH_CHECK);
      await press(google(failing));
      expect(failing.textContent).toContain("WhatBuild couldn’t check that you’re a person. Try again, or reload the page.");
      // The check passes on the next try, by email: the message goes.
      flaky.state.outcome = "token";
      await askFor(failing, "maya@example.com");
      expect(failing.querySelector(".callout-title")?.textContent).toBe("Check your email");
      expect(failing.textContent).not.toContain("couldn’t check that you’re a person");
    } finally {
      fetched.mockRestore();
    }
  });

  it("asks for nothing, and loads nothing, where the deployment has no bot check", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ received: true }), { status: 200 }));
    try {
      const host = await signInPageAt("", { email_link: true, google: false, microsoft: false, dev: false });
      await askFor(host, "maya@example.com");
      const sent = fetched.mock.calls.find(([url]) => String(url).endsWith("/auth/email"))!;
      expect(JSON.parse(String((sent[1] as RequestInit).body))).not.toHaveProperty("bot_check");
      expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
      expect(host.querySelector(".bot-check")).toBeNull();
    } finally {
      fetched.mockRestore();
    }
  });

  it("explains a sign-in refused by the check, and one refused for too many new accounts, from the network or everywhere", async () => {
    expect((await signInPageAt("?error=bot_check")).textContent).toContain("WhatBuild couldn’t check that you’re a person");
    close();
    expect((await signInPageAt("?error=too_many_accounts")).textContent).toContain("WhatBuild is making too many new accounts just now");
    close();
    const network = (await signInPageAt("?error=too_many_accounts_from_network")).textContent ?? "";
    expect(network).toContain("Too many new accounts were made from your network");
    expect(network).toContain("Try from another network");
  });

  it("sends someone signed in on, saying the check was refused, when it was refused as they started a provider's sign-in again", async () => {
    expect(await returnsTo("/settings?delete-account=1", "bot_check")).toBe("/settings?delete-account=1&bot_check_refused=1");
    close();
    expect(await returnsTo("/settings?delete-account=1")).toBe("/settings?delete-account=1");
  });
});

describe("the browser tab's title", () => {
  it("follows the heading where Start using WhatBuild leads, and says Sign in elsewhere", async () => {
    const starting = await signInPageAt(`?next=${encodeURIComponent("/start")}`);
    expect(starting.querySelector("h1")?.textContent).toBe("Start using WhatBuild");
    expect(document.title).toBe("Start using WhatBuild · WhatBuild");
    close();
    await signInPageAt(`?next=${encodeURIComponent("/demo?landing=/&button=explore")}`);
    expect(document.title).toBe("Explore the demo · WhatBuild");
    close();
    await signInPageAt("");
    expect(document.title).toBe("Sign in · WhatBuild");
  });
});

describe("the way in from Explore the demo", () => {
  const open = { email_link: true, google: false, microsoft: false, dev: false, open: true };

  it("says signing in opens the demo, and that it creates the account where anyone may make one", async () => {
    const host = await signInPageAt(`?next=${encodeURIComponent("/demo?landing=/what-to-build/&button=explore")}`, open);
    expect(host.querySelector("h1")?.textContent).toBe("Explore the demo");
    expect(host.querySelector(".entry-form > p.muted")?.textContent).toBe("Sign in to open the demo. New here? Signing in creates your account.");
  });

  it("still says it opens the demo where nobody may make an account", async () => {
    const host = await signInPageAt(`?next=${encodeURIComponent("/demo")}`, { ...open, open: false });
    expect(host.querySelector(".entry-form > p.muted")?.textContent).toBe("Sign in to open the demo.");
  });

  it("leaves plain sign-in as it was", async () => {
    const host = await signInPageAt("", open);
    expect(host.querySelector("h1")?.textContent).toBe("Sign in to WhatBuild");
    expect(host.querySelector(".entry-form > p.muted")?.textContent).toBe("New here? Signing in creates your account.");
    close();
    const closed = await signInPageAt("", { ...open, open: false });
    expect(closed.querySelector(".entry-form > p.muted")).toBeNull();
  });
});
