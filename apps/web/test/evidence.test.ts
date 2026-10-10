import { describe, expect, it } from "vitest";
import { sourcesCount } from "../src/routes/evidence.tsx";

const facets = {
  sources: 75,
  tags: [{ tag: "interview", count: 62 }, { tag: "workshop", count: 13 }],
  tags_truncated: false,
  added_by: [{ account_id: "acc_sam", display_name: "Sam", count: 58 }],
};

describe("the count beside the Sources heading", () => {
  it("is the exact total while more pages wait, when the facets know it", () => {
    expect(sourcesCount({ loaded: 50, more: true, filters: {}, facets })).toBe("75");
    expect(sourcesCount({ loaded: 50, more: true, filters: { include_archived: "1" }, facets })).toBe("75");
    expect(sourcesCount({ loaded: 50, more: true, filters: { tags: "Interview" }, facets, of: " of 75" })).toBe("62 of 75");
    expect(sourcesCount({ loaded: 50, more: true, filters: { added_by: "acc_sam" }, facets, of: " of 75" })).toBe("58 of 75");
  });

  it("is the rows when every page is loaded", () => {
    expect(sourcesCount({ loaded: 13, more: false, filters: { tags: "workshop" }, facets, of: " of 75" })).toBe("13 of 75");
  });

  it("says 50+ only where the total is unknown", () => {
    expect(sourcesCount({ loaded: 50, more: true, filters: {}, facets: undefined })).toBe("50+");
    expect(sourcesCount({ loaded: 50, more: true, filters: { tags: "interview", added_by: "acc_sam" }, facets, of: " of 75" })).toBe("50+ of 75");
    expect(sourcesCount({ loaded: 50, more: true, filters: { tags: "interview, workshop" }, facets, of: " of 75" })).toBe("50+ of 75");
    expect(sourcesCount({ loaded: 50, more: true, filters: { query: "crew" }, facets, of: " of 75" })).toBe("50+ of 75");
  });
});
