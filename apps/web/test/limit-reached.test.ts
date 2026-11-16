import { describe, expect, it } from "vitest";
import { peopleRoom } from "../src/shell/limit-reached.tsx";

// A plan's people limit, said without what the people editor knows: only what is true without it.

describe("a plan's people limit without the screen's knowledge of the organization", () => {
  it("offers only adding fewer people, where some fit, and nothing it can't tell", () => {
    expect(peopleRoom({ quota: "members_max", limit: 2, used: 2, email: "new@example.com", roomFor: 0 })).toBe("No places are left for new@example.com. Story readers don’t count.");
    expect(peopleRoom({ quota: "members_max", limit: 3, used: 3, email: "b@example.com", roomFor: 1 })).toBe(
      "Nothing was saved. There’s room for the first address only. Add fewer people. Story readers don’t count.",
    );
  });

  it("says what earlier calls saved, and counts the room left after them", () => {
    expect(peopleRoom({ quota: "members_max", limit: 150, used: 150, email: "x@example.com", roomFor: 130, saved: 100 })).toBe(
      "The first 100 addresses are saved, and none after them. There’s room for the next 30 addresses only. Add fewer people. Story readers don’t count.",
    );
    expect(peopleRoom({ quota: "members_max", limit: 150, used: 150, email: "x@example.com", roomFor: 100, saved: 100 }, { tookBefore: 0, invitations: true, others: false })).toBe(
      "The first 100 addresses are saved, and none after them. No places are left. Cancel an invitation. Story readers don’t count.",
    );
  });
});
