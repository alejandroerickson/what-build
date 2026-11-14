import { describe, expect, it } from "vitest";
import { actionName, maskedPage, screenPath, settingsScreen } from "../src/lib/analytics.ts";

describe("screenPath", () => {
  it("names the screen, never the organization, product or record", () => {
    expect(screenPath("/t/acme/planner/story/launch-plan")).toBe("/t/:org/:product/story/:id");
    expect(screenPath("/t/acme/planner/exploration/mockups/01HX")).toBe("/t/:org/:product/exploration/mockups/:id");
    expect(screenPath("/t/acme/planner")).toBe("/t/:org/:product");
    expect(screenPath("/t/acme/members")).toBe("/t/:org/members");
    expect(screenPath("/join/abc123")).toBe("/join/:code");
    expect(screenPath("/invite/tok")).toBe("/invite/:code");
    expect(screenPath("/settings")).toBe("/settings");
    expect(screenPath("/")).toBe("/");
  });
});

describe("actionName", () => {
  it("names a change by the operation the server ran, never by its address", () => {
    const P = "/api/v1/p/acme/planner";
    expect(actionName(`${P}/outcomes`, "outcomes.create")).toBe("outcomes_create");
    expect(actionName(`${P}/outcomes/01JABCDEF/archive`, "outcomes.archive")).toBe("outcomes_archive");
    expect(actionName(`${P}/sources/01J/fetch`, "attachments.fetch_url")).toBe("attachments_fetch_url");
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
    expect(actionName("/api/v1/p/acme/planner", "acme secret launch")).toBeNull();
    expect(actionName("/api/v1/p/acme/planner", "Acme.Launch")).toBeNull();
  });
});

describe("maskedPage", () => {
  it("names the screen and where the person came from, never whose", () => {
    const page = maskedPage("/t/acme/planner/search");
    expect(page).toMatchObject({ page_path: "/t/:org/:product/search", page_title: "WhatBuild" });
    expect(page.page_location).toBe(`${location.origin}/t/:org/:product/search`);
    expect(JSON.stringify(page)).not.toMatch(/acme|planner/);
  });
});

describe("settingsScreen", () => {
  it("counts a Settings section as a screen of its own, and nothing else in the query", () => {
    expect(settingsScreen("?settings=organization/plan&reach=product&product=acme/planner")).toBe("/settings/organization/plan");
    expect(settingsScreen("?settings=agents")).toBe("/settings/agents");
    expect(settingsScreen("?settings=acme-secret-name")).toBe("/settings");
    expect(settingsScreen("?q=spreadsheet")).toBeNull();
  });
});
