import { describe, expect, it } from "vitest";
import { dayCount, surfaceWords } from "../src/shell/ActivityFeed.tsx";

const person = { account_id: "acc_1", display_name: "Sam", surface: "web", client: null };
const system = { account_id: "system", display_name: "WhatBuild", surface: null, client: "parser" };

describe("the surface an activity entry names", () => {
  it("names the door a person or an agent came through", () => {
    expect(surfaceWords({ through_agent: false, channel: "web", actor: person })).toBe("in the app");
    expect(surfaceWords({ through_agent: false, channel: "rest", actor: { ...person, surface: "rest" } })).toBe("through the API");
    expect(surfaceWords({ through_agent: true, channel: "mcp", actor: { ...person, surface: "mcp", client: "claude-code" } })).toBe("via claude-code");
  });

  it("puts what WhatBuild did by itself, such as parsing a file an agent uploaded, on the server rather than in the app", () => {
    expect(surfaceWords({ through_agent: false, channel: null, actor: system })).toBe("on the server");
  });
});

describe("a day's count of changes", () => {
  it("is exact once the day is loaded, and claims no total while older changes wait", () => {
    expect(dayCount(1, false)).toBe("1 change");
    expect(dayCount(37, false)).toBe("37 changes");
    expect(dayCount(37, true)).toBe("37+ changes");
  });
});
