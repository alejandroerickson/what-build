import { describe, expect, it, vi } from "vitest";

// deploy/cloud-run/kill-switch/kill-switch.mjs, which closes the services when the bill reaches its cap.
const ks = (await import(new URL("../../../deploy/cloud-run/kill-switch/kill-switch.mjs", import.meta.url).href)) as {
  decide(message: unknown): { close: boolean; reason: string };
  parseServices(text: string | undefined): string[];
  closeAll(services: string[], token: string, fetch: typeof globalThis.fetch): Promise<string[]>;
  handle(push: unknown, deps: { services: string[]; token: () => Promise<string>; fetch: typeof globalThis.fetch; log: (e: unknown) => void }): Promise<{ close: boolean; reason: string; results: string[] }>;
};

const message = (data: unknown) => ({ data: Buffer.from(JSON.stringify(data)).toString("base64"), attributes: {} });
const budget = (costAmount: number, budgetAmount = 50) => message({ budgetDisplayName: "WhatBuild: every project", costAmount, budgetAmount, budgetAmountType: "SPECIFIED_AMOUNT", currencyCode: "USD", costIntervalStart: "2026-01-01T08:00:00Z" });
const incident = (state: string) => message({ version: "1.2", incident: { state, policy_name: "whatbuild: kill switch, logs" } });

const PUBLIC = { role: "roles/run.invoker", members: ["allUsers"] };

/** A Cloud Run API that holds each service's access policy, and records every call made to it. */
function cloudRun(policies: Record<string, { bindings?: { role: string; members: string[] }[]; etag?: string }>, fail: string[] = []) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const [, name, verb] = /^\/v2\/projects\/([^/]+\/locations\/[^/]+\/services\/[^/:]+):(\w+)$/.exec(u.pathname)!;
    const service = name!.replace("/locations/", "/").replace("/services/", "/");
    calls.push(`${verb} ${service}`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer a-token");
    if (fail.includes(service)) return new Response("denied", { status: 403 });
    if (verb === "setIamPolicy") {
      expect(init?.method).toBe("POST");
      const { policy } = JSON.parse(String(init!.body));
      expect(policy.etag).toBe(policies[service]!.etag);
      policies[service] = policy;
      return Response.json(policy);
    }
    return Response.json(policies[service]);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, policies };
}

describe("the kill switch", () => {
  it("closes when the month's spending reaches the budget's amount, and not before", () => {
    expect(ks.decide(budget(49.99))).toMatchObject({ close: false });
    expect(ks.decide(budget(50))).toMatchObject({ close: true, reason: expect.stringContaining("50 of 50 USD") });
    expect(ks.decide(budget(120))).toMatchObject({ close: true });
    // A budget raised after a close: the same spending no longer closes anything.
    expect(ks.decide(budget(60, 80))).toMatchObject({ close: false });
  });

  it("closes when one of its alerts opens, and not when one closes", () => {
    expect(ks.decide(incident("open"))).toMatchObject({ close: true, reason: expect.stringContaining("kill switch, logs") });
    expect(ks.decide(incident("closed"))).toMatchObject({ close: false });
  });

  it("does nothing for any other message", () => {
    expect(ks.decide(undefined)).toMatchObject({ close: false });
    expect(ks.decide({ data: Buffer.from("not json").toString("base64") })).toMatchObject({ close: false });
    expect(ks.decide(message({ hello: "world" }))).toMatchObject({ close: false });
  });

  it("closes every service named to the public, keeps every other grant, and leaves one already closed as it is", async () => {
    const owner = { role: "roles/run.developer", members: ["user:owner@example.com"] };
    const run = cloudRun({
      "my-whatbuild/us-central1/whatbuild": { etag: "BwX1", bindings: [{ role: "roles/run.invoker", members: ["allUsers", "serviceAccount:probe@example.com"] }, owner] },
      "my-whatbuild-dev/us-central1/whatbuild": { etag: "BwX2", bindings: [owner] },
    });
    const services = ks.parseServices("my-whatbuild/us-central1/whatbuild, my-whatbuild-dev/us-central1/whatbuild");
    const log = vi.fn();
    const done = await ks.handle({ message: budget(51) }, { services, token: async () => "a-token", fetch: run.fetch, log });
    expect(done.results).toEqual(["my-whatbuild/us-central1/whatbuild: closed", "my-whatbuild-dev/us-central1/whatbuild: already closed"]);
    expect(run.policies["my-whatbuild/us-central1/whatbuild"]!.bindings).toEqual([{ role: "roles/run.invoker", members: ["serviceAccount:probe@example.com"] }, owner]);
    expect(run.calls).toEqual([
      "getIamPolicy my-whatbuild/us-central1/whatbuild",
      "setIamPolicy my-whatbuild/us-central1/whatbuild",
      "getIamPolicy my-whatbuild-dev/us-central1/whatbuild",
    ]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ severity: "WARNING", message: expect.stringContaining("reached its cap") }));
  });

  it("drops the invoker role when the public held it alone, and takes off every account signed in to Google too", async () => {
    const run = cloudRun({ "my-whatbuild/us-central1/whatbuild": { etag: "BwX1", bindings: [{ role: "roles/run.invoker", members: ["allUsers", "allAuthenticatedUsers"] }] } });
    await ks.closeAll(["my-whatbuild/us-central1/whatbuild"], "a-token", run.fetch);
    expect(run.policies["my-whatbuild/us-central1/whatbuild"]!.bindings).toEqual([]);
  });

  it("touches nothing, and asks for no token, when nothing is to be closed", async () => {
    const run = cloudRun({ "my-whatbuild/us-central1/whatbuild": { bindings: [PUBLIC] } });
    const token = vi.fn(async () => "a-token");
    await ks.handle({ message: budget(20) }, { services: ["my-whatbuild/us-central1/whatbuild"], token, fetch: run.fetch, log: () => {} });
    expect(token).not.toHaveBeenCalled();
    expect(run.calls).toEqual([]);
  });

  it("tries every service before it fails, so Pub/Sub tries again for the ones left open", async () => {
    const run = cloudRun(
      { "my-whatbuild/us-central1/whatbuild": { bindings: [PUBLIC] }, "my-whatbuild-dev/us-central1/whatbuild": { bindings: [PUBLIC] } },
      ["my-whatbuild/us-central1/whatbuild"],
    );
    const services = ["my-whatbuild/us-central1/whatbuild", "my-whatbuild-dev/us-central1/whatbuild"];
    await expect(ks.closeAll(services, "a-token", run.fetch)).rejects.toThrow(/my-whatbuild\/us-central1\/whatbuild: reading its access: 403.*my-whatbuild-dev\/us-central1\/whatbuild: closed/);
    expect(run.policies["my-whatbuild-dev/us-central1/whatbuild"]!.bindings).toEqual([]);
  });

  it("refuses a list of services it cannot read", () => {
    expect(() => ks.parseServices(undefined)).toThrow(/SERVICES/);
    expect(() => ks.parseServices("whatbuild")).toThrow(/project\/region\/service/);
    expect(() => ks.parseServices("my-whatbuild/us-central1/whatbuild/extra")).toThrow(/project\/region\/service/);
  });
});
