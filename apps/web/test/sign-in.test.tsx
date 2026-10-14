import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(await returnsTo("/t/acme/core/onboarding/story?page=intro#top")).toBe("/t/acme/core/onboarding/story?page=intro#top");
    expect(await returnsTo("/join/AbC-123_x")).toBe("/join/AbC-123_x");
  });

  it("goes home instead of anywhere a browser could read as another origin, by the server's rule", async () => {
    for (const next of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/%2F/evil.example", "/.//evil.example", "https://evil.example", "javascript:alert(1)"])
      expect(await returnsTo(next), JSON.stringify(next)).toBe("/");
  });
});

/** The sign-in page's text for someone signed out who arrived at `/signin<search>`. */
async function signInPageAt(search: string, methods = { email_link: true, google: false, microsoft: true, dev: false }): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["me"], null);
  qc.setQueryData(["auth-methods"], methods);
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

  it("still explains an old link's microsoft_unverified, and offers no email link where there is none", async () => {
    const text = (await signInPageAt("?error=microsoft_unverified", { email_link: false, google: false, microsoft: true, dev: false })).textContent ?? "";
    expect(text).toContain("That Microsoft sign-in didn’t work here");
    expect(text).toContain("the server’s setup may be at fault");
    expect(text).not.toContain("email link");
  });
});
