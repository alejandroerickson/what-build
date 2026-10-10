import { describe, expect, it } from "vitest";
import { actionName, screenPath } from "../src/lib/analytics.ts";

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
  it("names what was done from known words only", () => {
    const P = "/api/v1/p/acme/core/planner";
    expect(actionName("POST", `${P}/assumptions`)).toBe("assumptions_create");
    expect(actionName("PATCH", `${P}/assumptions/01JABCDEF`)).toBe("assumptions_update");
    expect(actionName("POST", `${P}/assumptions/01JABCDEF/review`)).toBe("assumptions_review");
    expect(actionName("POST", `${P}/mockups/01J/check-citations`)).toBe("mockups_check_citations");
    expect(actionName("POST", `${P}/sources/01J/annotations`)).toBe("sources_annotations_create");
    expect(actionName("DELETE", `${P}/sources/01J`)).toBe("sources_delete");
    expect(actionName("POST", `${P}/mockups/01J/downloads`)).toBe("mockups_downloads_create");
    expect(actionName("PATCH", P)).toBe("product_update");
    expect(actionName("POST", "/api/v1/teams/acme/core/products")).toBe("products_create");
    expect(actionName("POST", "/api/v1/tenants/acme/members")).toBe("members_create");
    expect(actionName("POST", "/api/v1/tenants")).toBe("tenants_create");
    expect(actionName("POST", "/api/v1/interest")).toBe("generate_lead");
    expect(actionName("POST", "/auth/email")).toBe("auth_email_create");
    expect(actionName("POST", "/api/v1/acme-secret-launch/whatever")).toBe("create");
  });
});
