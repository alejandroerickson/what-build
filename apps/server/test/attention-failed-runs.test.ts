import { describe, expect, it } from "vitest";

// scripts/attention.mjs, which tells an agent at the start of a session what is waiting, a failed run on main among it.
// The repository's scripts have no vitest project of their own, so the server's runs this one.
type Run = { workflowName: string; displayTitle: string; event: string; conclusion: string; status: string; createdAt: string; url: string };
const attention = (await import(new URL("../../../scripts/attention.mjs", import.meta.url).href)) as {
  failedRuns(runs: Run[]): { text: string; skill: string }[];
};

let n = 0;
/** A finished run on main, newest first as `gh run list` gives them. */
const run = (workflowName: string, event: string, conclusion: string, createdAt: string, displayTitle = "A change"): Run => ({
  workflowName, displayTitle, event, conclusion, status: "completed", createdAt, url: `https://github.example.com/runs/${++n}`,
});

describe("a failed run on main", () => {
  it("stays reported after push runs that skip the scheduled jobs pass", () => {
    const failed = run("Security", "schedule", "failure", "2026-11-23T18:02:18Z");
    const runs = [
      run("Security", "push", "success", "2026-11-24T02:24:50Z"),
      run("Security", "push", "success", "2026-11-23T22:42:06Z"),
      failed,
      run("Security", "push", "success", "2026-11-23T09:51:46Z"),
    ];
    const lines = attention.failedRuns(runs);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(/^the last scheduled Security run on main failed .*: /);
    expect(lines[0]!.text.endsWith(failed.url)).toBe(true);
    expect(lines[0]!.skill).toBe("triage-security-findings");
  });

  it("is settled by a later run for the same event", () => {
    expect(attention.failedRuns([
      run("Security", "schedule", "success", "2026-11-30T18:00:00Z"),
      run("Security", "push", "success", "2026-11-24T02:24:50Z"),
      run("Security", "schedule", "failure", "2026-11-23T18:02:18Z"),
    ])).toEqual([]);
    expect(attention.failedRuns([
      run("CI", "push", "success", "2026-11-24T02:00:00Z"),
      run("CI", "push", "failure", "2026-11-24T01:00:00Z"),
    ])).toEqual([]);
  });

  it("goes by when each run started, though the schedule's own list comes after the others", () => {
    const general = [run("Security", "push", "success", "2026-12-01T02:00:00Z"), run("Security", "schedule", "failure", "2026-11-23T18:02:18Z")];
    const scheduled = [run("Security", "schedule", "success", "2026-11-30T18:00:00Z"), general[1]!];
    expect(attention.failedRuns([...general, ...scheduled])).toEqual([]);
  });

  it("says a run of another event without naming the event", () => {
    const lines = attention.failedRuns([run("CodeQL", "dynamic", "failure", "2026-11-24T01:00:00Z"), run("CodeQL", "push", "success", "2026-11-24T00:00:00Z")]);
    expect(lines.map((l) => l.text)).toEqual([expect.stringMatching(/^the last CodeQL run on main failed /)]);
  });

  it("names the workflow alone when it runs for one event", () => {
    const lines = attention.failedRuns([run("CI", "push", "failure", "2026-11-24T01:00:00Z"), run("CI", "push", "success", "2026-11-23T01:00:00Z")]);
    expect(lines.map((l) => l.text)).toEqual([expect.stringMatching(/^the last CI run on main failed /)]);
    expect(lines[0]!.skill).toBe("");
  });

  it("is the scheduled run's, when the schedule's own list repeats it", () => {
    const failed = run("CodeQL", "schedule", "cancelled", "2026-11-23T07:00:00Z");
    const lines = attention.failedRuns([run("CodeQL", "push", "success", "2026-11-24T00:00:00Z"), failed, failed]);
    expect(lines.map((l) => l.text)).toEqual([expect.stringMatching(/^the last scheduled CodeQL run on main ended cancelled /)]);
  });

  it("is Dependabot's regular update of each ecosystem, not its update for one package", () => {
    const lines = attention.failedRuns([
      run("Dependabot Updates", "dynamic", "failure", "2026-11-24T03:00:00Z", "npm_and_yarn in /. for vite - Update #12"),
      run("Dependabot Updates", "dynamic", "success", "2026-11-24T02:00:00Z", "github_actions in /. - Update #11"),
      run("Dependabot Updates", "dynamic", "failure", "2026-11-24T01:00:00Z", "npm_and_yarn in /. - Update #10"),
      run("Dependabot Updates", "dynamic", "failure", "2026-11-23T01:00:00Z", "github_actions in /. - Update #9"),
    ]);
    expect(lines.map((l) => l.text)).toEqual([expect.stringMatching(/^the last Dependabot update \(npm_and_yarn in \/\.\) run on main failed /)]);
  });
});
