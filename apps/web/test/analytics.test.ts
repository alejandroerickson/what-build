import { describe, expect, it } from "vitest";
import { actionName, maskedPage, screenPath } from "../src/lib/analytics.ts";

describe("screenPath", () => {
  it("names the screen, never the organization, product or record", () => {
    expect(screenPath("/t/acme/core/planner/story/launch-plan")).toBe("/t/:org/:team/:product/story/:id");
    expect(screenPath("/t/acme/core/planner/exploration/assumptions/01HX/edit")).toBe("/t/:org/:team/:product/exploration/assumptions/:id/edit");
    expect(screenPath("/t/acme/core/planner/exploration/mockups/01HX")).toBe("/t/:org/:team/:product/exploration/mockups/:id");
    expect(screenPath("/t/acme/core/planner")).toBe("/t/:org/:team/:product");
    expect(screenPath("/t/acme/members")).toBe("/t/:org/members");
    expect(screenPath("/join/abc123")).toBe("/join/:code");
    expect(screenPath("/invite/tok")).toBe("/invite/:code");
    expect(screenPath("/settings")).toBe("/settings");
    expect(screenPath("/")).toBe("/");
  });
});

describe("actionName", () => {
  it("names a change by the operation the server ran, never by its address", () => {
    const P = "/api/v1/p/acme/core/planner";
    expect(actionName(`${P}/assumptions`, "assumptions.create")).toBe("assumptions_create");
    expect(actionName(`${P}/assumptions/01JABCDEF/review`, "assumptions.review")).toBe("assumptions_review");
    expect(actionName(`${P}/sources/01J/files`, "files.fetch_url")).toBe("files_fetch_url");
    expect(actionName("/api/v1/tenant-allowances/remove", "products.remove_tenant_allowance")).toBe("products_remove_tenant_allowance");
  });

  it("names the few changes that are not operations, and sends nothing for any other", () => {
    expect(actionName("/api/v1/interest", null)).toBe("generate_lead");
    expect(actionName("/auth/sign-out", null)).toBe("sign_out");
    expect(actionName("/auth/email", null)).toBe("sign_in_link");
    expect(actionName("/api/v1/invitations/accept", null)).toBe("invitation_accept");
    expect(actionName("/api/v1/me", null)).toBe("profile_update");
    expect(actionName("/api/v1/me/agents/Claude%20Code", null)).toBe("agent_disconnect");
    expect(actionName("/api/v1/acme-secret-launch/whatever", null)).toBeNull();
    // Only an operation's name is taken from the header, never other text.
    expect(actionName("/api/v1/p/acme/core/planner", "acme secret launch")).toBeNull();
    expect(actionName("/api/v1/p/acme/core/planner", "Acme.Launch")).toBeNull();
  });
});

describe("maskedPage", () => {
  it("names the screen and where the person came from, never whose", () => {
    const page = maskedPage("/t/acme/core/planner/search");
    expect(page).toMatchObject({ page_path: "/t/:org/:team/:product/search", page_title: "WhatBuild" });
    expect(page.page_location).toBe(`${location.origin}/t/:org/:team/:product/search`);
    expect(JSON.stringify(page)).not.toMatch(/acme|planner/);
  });
});
