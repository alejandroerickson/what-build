import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityLog, type ActivityItem } from "../src/shell/ActivityFeed.tsx";

// Activity groups the log by day, newest first, and loads it 50 changes at a time: the oldest day
// loaded may go on past what is loaded, so its count claims no total until it is all there.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

const entry = (n: number, at: string): ActivityItem => ({
  activity_id: `a${n}`, occurred_at: at, actor: { account_id: "acc_1", display_name: "Sam", surface: "web", client: null }, channel: "web",
  through_agent: false, action: "note_added", entity_type: "source", entity_id: "rec_1", entity_title: "Crew lead interview", summary: "Added a comment",
});

function render(items: ActivityItem[], more: boolean) {
  const query = { isPending: false, isError: false, data: { pages: [{ items, next_cursor: more ? "a0" : null }] }, hasNextPage: more, isFetchingNextPage: false, fetchNextPage: () => {} };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <MemoryRouter>
        <ActivityLog query={query as never} linkOf={() => null} empty={null} />
      </MemoryRouter>,
    ),
  );
  unmount = () => act(() => root.unmount());
  return [...host.querySelectorAll(".activity-day-count")].map((c) => c.textContent);
}

// Midday, so the local day is the same wherever the test runs.
const day2 = [entry(5, "2026-09-02T12:00:00Z"), entry(4, "2026-09-02T11:00:00Z")];
const day1 = [entry(3, "2026-09-01T12:00:00Z"), entry(2, "2026-09-01T11:00:00Z"), entry(1, "2026-09-01T10:00:00Z")];

describe("the count beside each day in Activity", () => {
  it("counts a day exactly once an older day follows it, and the oldest day loaded only so far", () => {
    expect(render([...day2, ...day1], true)).toEqual(["2 changes", "3+ changes"]);
  });

  it("counts every day exactly once the log is all loaded", () => {
    expect(render([...day2, ...day1], false)).toEqual(["2 changes", "3 changes"]);
  });
});

describe("the words a deletion reads as in Activity", () => {
  it.each([
    ["note_deleted", "source", "deleted a comment on"],
    ["deleted", "assumption", "deleted the assumption"],
    ["deleted", "mockup", "deleted the mockup"],
    ["deleted", "outcome", "deleted the outcome"],
    ["deleted", "story_page", "deleted the page"],
  ])("%s of a %s reads as %s", (action, entity_type, words) => {
    render([{ ...entry(1, "2026-09-01T12:00:00Z"), action, entity_type } as ActivityItem], false);
    expect(document.body.textContent).toContain(words);
  });
});
