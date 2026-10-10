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
