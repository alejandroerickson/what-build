import { describe, expect, it } from "vitest";
import { releaseView } from "../src/shell/release.tsx";

const sha = "fced2c9a1b2c3d4e5f60718293a4b5c6d7e8f901";
const SOURCE = "https://github.com/alejandroerickson/what-build";

describe("the release in the account menu", () => {
  it("names a tag as a release, with its commit beside it, linked to the release notes", () => {
    const v = releaseView({ version: "v0.3.1", commit: sha, built_at: "2026-10-03T12:00:00Z" })!;
    expect([v.lead, v.name, v.icon, v.detailCommit]).toEqual(["Release", "v0.3.1", "tag", "fced2c9"]);
    expect(v.built).toMatch(/^Built \d+ Oct 2026$/);
    expect(v.href).toBe(`${SOURCE}/releases/tag/v0.3.1`);
    expect(v.title).toContain(`Commit ${sha}`);
  });

  it("names a build of a commit by its short hash, linked to the commit", () => {
    const v = releaseView({ version: "fced2c9", commit: sha, built_at: null })!;
    expect([v.lead, v.name, v.icon, v.detailCommit, v.built]).toEqual(["Commit", "fced2c9", "git-commit", null, null]);
    expect(v.href).toBe(`${SOURCE}/commit/${sha}`);
  });

  it("falls back to the version for an image that recorded no commit", () => {
    expect(releaseView({ version: "ad9e459", commit: null, built_at: null })!.href).toBe(`${SOURCE}/commit/ad9e459`);
  });

  it("links another name only through its commit", () => {
    expect(releaseView({ version: "staging", commit: null, built_at: null })!.href).toBeNull();
    expect(releaseView({ version: "staging", commit: sha, built_at: null })!.href).toBe(`${SOURCE}/commit/${sha}`);
  });

  it("has nothing to name on a development server", () => {
    expect(releaseView({ version: "dev-0.10.0", commit: null, built_at: null })).toBeNull();
  });
});
