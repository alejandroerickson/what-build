import { describe, expect, it } from "vitest";
import { instanceOwnersFrom, listOf, loadConfig } from "../src/config.ts";

// Lists of addresses are written with commas, or with semicolons where `gcloud --set-env-vars`
// keeps commas for itself, as deploy/cloud-run/setup.sh writes them. Both read the same.

const config = (env: Record<string, string>) => loadConfig({ NODE_ENV: "test", ...env });

describe("settings that list addresses", () => {
  it("are split on commas and on semicolons, trimmed and lowercased", () => {
    expect(listOf(" A@example.com, b@example.com ;@Listed.example;; ")).toEqual(["a@example.com", "b@example.com", "@listed.example"]);
    expect(listOf(undefined)).toEqual([]);
  });

  it("read several instance owners as setup.sh writes them", () => {
    expect(config({ WHATBUILD_INSTANCE_OWNERS: "riley@example.com;sam@example.com" }).instanceOwners).toEqual(["riley@example.com", "sam@example.com"]);
    expect(config({ WHATBUILD_INSTANCE_OWNERS: "riley@example.com,sam@example.com" }).instanceOwners).toEqual(["riley@example.com", "sam@example.com"]);
  });

  it("read a sign-up allowlist of addresses and domains either way, and none when unset", () => {
    expect(config({ WHATBUILD_SIGNUP_ALLOWLIST: "riley@example.com;@listed.example" }).signupAllowlist).toEqual(["riley@example.com", "@listed.example"]);
    expect(config({ WHATBUILD_SIGNUP_ALLOWLIST: "riley@example.com, @listed.example" }).signupAllowlist).toEqual(["riley@example.com", "@listed.example"]);
    expect(config({}).signupAllowlist).toBeNull();
  });

  it("read the instance owners a copy of the deployment takes from its service the same way", () => {
    expect(instanceOwnersFrom("riley@example.com;Sam@example.com")).toEqual(["riley@example.com", "sam@example.com"]);
  });

  it("leave a domain out of the instance owners", () => {
    expect(config({ WHATBUILD_INSTANCE_OWNERS: "@example.com;riley@example.com" }).instanceOwners).toEqual(["riley@example.com"]);
  });
});
