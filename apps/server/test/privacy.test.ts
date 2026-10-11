import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, providerList } from "../src/config.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startHarness({
    operator: "Example Labs",
    privacyContact: "privacy@example.com",
    providers: providerList("Example Cloud: hosting, files and logs; Example DB: the database; Example Mail"),
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
      providers: [
        { name: "Example Cloud", purpose: "hosting, files and logs" },
        { name: "Example DB", purpose: "the database" },
        { name: "Example Mail", purpose: "" },
      ],
      analytics: false,
      session_days: 21,
      agent_access_days: 30,
      usage_people_months: 14,
    });
  });

  it("are empty where the deployment names nothing", () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://x/y" });
    expect([config.operator, config.privacyContact, config.providers]).toEqual([null, null, []]);
    expect(providerList(" ; : nothing named ;Only A Name ")).toEqual([{ name: "Only A Name", purpose: "" }]);
  });
});
