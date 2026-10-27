import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, providersText } from "../src/config.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startHarness({
    operator: "Example Labs",
    privacyContact: "privacy@example.com",
    providers: providersText("Example Cloud runs the service and keeps its files and logs.\n  Example DB holds the database, and Example Mail sends the email."),
    sessionDays: 21,
  });
});
afterAll(async () => h?.close());

describe("the privacy page's facts", () => {
  it("come from the deployment, signed out", async () => {
    const meta = (await (await fetch(`${h.baseUrl}/api/v1/meta`)).json()) as { privacy: Record<string, unknown> };
    expect(meta.privacy).toEqual({
      operator: "Example Labs",
      contact: "privacy@example.com",
      providers: "Example Cloud runs the service and keeps its files and logs. Example DB holds the database, and Example Mail sends the email.",
      analytics: false,
    });
  });

  it("are empty where the deployment names nothing", () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://x/y" });
    expect([config.operator, config.privacyContact, config.providers]).toEqual([null, null, null]);
    expect(providersText(" \n ")).toBeNull();
  });
});
