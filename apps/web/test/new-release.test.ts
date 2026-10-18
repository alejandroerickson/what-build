import { beforeEach, describe, expect, it } from "vitest";
import { firstLoadFor, replaced } from "../src/lib/new-release.ts";

const ours = "fced2c9a1b2c3d4e5f60718293a4b5c6d7e8f901";
const theirs = "0a1b2c3d4e5f60718293a4b5c6d7e8f901fced2c";

beforeEach(() => sessionStorage.clear());

describe("a release that came while a page was open", () => {
  it("is told by the commit the server names differing from the app's own", () => {
    expect(replaced(ours, theirs)).toBe(true);
    expect(replaced(ours, ours)).toBe(false);
    // A response that names no commit (a proxy's error), or an app built without one (development), tells nothing.
    expect(replaced(ours, null)).toBe(false);
    expect(replaced("", theirs)).toBe(false);
  });

  it("is loaded once in a tab, so a page still old once loaded is not loaded again at every screen", () => {
    expect(firstLoadFor(sessionStorage, theirs)).toBe(true);
    expect(firstLoadFor(sessionStorage, theirs)).toBe(false);
    // The release after it is loaded in its turn.
    expect(firstLoadFor(sessionStorage, ours)).toBe(true);
  });
});
