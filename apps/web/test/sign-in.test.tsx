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
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

/** Where the sign-in page sends someone already signed in who opened `/signin?next=<next>`. */
async function returnsTo(next: string): Promise<string> {
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
        <MemoryRouter initialEntries={[`/signin?next=${encodeURIComponent(next)}`]}>
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
  methods = { email_link: true, google: false, microsoft: true, dev: false },
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

describe("signing in on the way to an invitation", () => {
  it("says so, whether by the invitation's link or by its id", async () => {
    for (const next of ["/invite/secret-token", "/invitations/01M7GNG6G4QN5YKXEBWBDXFJ0H"]) {
      const host = await signInPageAt(`?next=${encodeURIComponent(next)}`);
      expect(host.querySelector("h1")?.textContent, next).toBe("Sign in to see your invitation");
      unmount?.();
      unmount = null;
    }
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
