import { FRAME_SCRIPT } from "@whatbuild/core";
import { describe, expect, it } from "vitest";

// Story pages published when products were in teams link to one another as
// /t/<tenant>/<team>/<product>/story/<page>. The frame still shows such a page in place.

describe("a Story page's link written when products were in teams", () => {
  const base = "https://app.example/t/acme/planner/story/";
  const run = (href: string) => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const sent: unknown[] = [];
    const parent = { postMessage: (m: unknown) => sent.push(m) };
    const attrs: Record<string, string> = {};
    const a = { href, getAttribute: (n: string) => (n === "href" ? href : attrs[n] ?? null), setAttribute: (n: string, v: string) => void (attrs[n] = v), hasAttribute: (n: string) => n in attrs };
    new Function("addEventListener", "parent", FRAME_SCRIPT)((type: string, fn: (e: unknown) => void) => void (listeners[type] = fn), parent);
    listeners["message"]!({ source: parent, data: { whatbuild: "story-base", base } });
    let prevented = false;
    listeners["click"]!({ target: { closest: () => a }, button: 0, defaultPrevented: false, preventDefault: () => void (prevented = true) });
    return { sent, prevented, target: attrs["target"] };
  };

  it("is shown in place, as a link to the Story's address is", () => {
    expect(run(`${base}release-plan`).sent).toEqual([{ whatbuild: "story-page", page: "release-plan" }]);
    expect(run("https://app.example/t/acme/product-team/planner/story/release-plan")).toEqual({ sent: [{ whatbuild: "story-page", page: "release-plan" }], prevented: true, target: undefined });
    expect(run("https://app.example/t/acme/core/planner/story/epics?v=2#matrix").sent).toEqual([{ whatbuild: "story-page", page: "epics" }]);
  });

  it("leaves another product's, another organization's and another site's links to open in a new tab", () => {
    for (const href of [
      "https://app.example/t/acme/core/other/story/overview",
      "https://app.example/t/globex/core/planner/story/overview",
      "https://app.example/t/acme/core/planner/evidence/01ABC",
      "https://app.example/t/acme/planner/story/Not-A-Slug/more",
      "https://example.com/t/acme/core/planner/story/overview",
    ])
      expect(run(href), href).toEqual({ sent: [], prevented: false, target: "_blank" });
  });
});
