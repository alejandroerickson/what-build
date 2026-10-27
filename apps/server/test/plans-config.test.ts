import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plansFrom, startingPlanFrom } from "../src/plans-config.ts";
import { EXAMPLE_PLANS } from "./harness.ts";

// A deployment defines its plans (WHATBUILD_PLANS): their ids, names, what each is for, every limit
// and a price, as JSON or a JSON file. Anything wrong stops the server from starting, saying what.

const example = () => JSON.parse(JSON.stringify(plansFrom(EXAMPLE_PLANS))) as ReturnType<typeof plansFrom>;
const inline = (plans: unknown) => JSON.stringify({ plans });

describe("the deployment's plans", () => {
  it("are none when nothing is set, so every organization is unlimited", () => {
    expect(plansFrom(undefined)).toEqual([]);
    expect(plansFrom("  ")).toEqual([]);
    expect(startingPlanFrom(undefined, [])).toBe("unlimited");
    expect(startingPlanFrom("unlimited", [])).toBe("unlimited");
  });

  it("are read from the example file, sizes in words turned into bytes", () => {
    const [free, pro] = plansFrom(EXAMPLE_PLANS);
    expect(free).toMatchObject({ id: "free", name: "Free", price: null });
    expect(free!.limits).toMatchObject({ file_max_bytes: 10 * 1024 * 1024, storage_max_bytes: 200 * 1024 * 1024, members_max: 2, documents_only: true });
    expect(pro!.limits).toMatchObject({ bytes_per_day: 1024 ** 3, products_max: null });
  });

  it("are read from JSON given in the setting itself, and from any file", () => {
    const plans = example();
    plans[1]!.price = "$20 a month";
    expect(plansFrom(inline(plans)).map((p) => [p.id, p.price])).toEqual([["free", null], ["pro", "$20 a month"]]);
    const dir = mkdtempSync(join(tmpdir(), "plans-"));
    writeFileSync(join(dir, "plans.json"), inline([{ ...plans[0], id: "starter", name: "Starter" }]));
    expect(plansFrom(join(dir, "plans.json")).map((p) => p.id)).toEqual(["starter"]);
  });

  it("refuse a plan that is not whole or well named, saying what is wrong", () => {
    const [free] = example();
    const without = { ...free!, limits: { ...free!.limits } } as { limits: Record<string, unknown> };
    delete without.limits["members_max"];
    expect(() => plansFrom(inline([without]))).toThrow(/every limit must be given; members_max is missing/);
    expect(() => plansFrom(inline([{ ...free, limits: { ...free!.limits, seats: 3 } }]))).toThrow(/seats is not a limit/);
    expect(() => plansFrom(inline([{ ...free, limits: { ...free!.limits, writes_per_day: null } }]))).toThrow(/writes_per_day must be a whole number of at least 0\./);
    expect(() => plansFrom(inline([{ ...free, limits: { ...free!.limits, storage_max_bytes: "lots" } }]))).toThrow(/storage_max_bytes must be bytes, or a size such as "10 MB"/);
    expect(() => plansFrom(inline([{ ...free, id: "Free Plan" }]))).toThrow(/id must be lowercase/);
    expect(() => plansFrom(inline([{ ...free, id: "unlimited" }]))).toThrow(/"unlimited" is the plan with no limits/);
    expect(() => plansFrom(inline([free, free]))).toThrow(/the id free is used twice/);
    expect(() => plansFrom(inline([{ ...free, name: "" }]))).toThrow(/name must be 1 to 40 characters/);
    expect(() => plansFrom("{ not json")).toThrow(/WHATBUILD_PLANS is not JSON/);
    expect(() => plansFrom('{"tiers": []}')).toThrow(/must be \{ "plans": \[ … \] \}/);
    expect(() => plansFrom("/nowhere/plans.json")).toThrow(/can't be read/);
  });

  it("name the plan organizations start on only if it is one of them", () => {
    const plans = example();
    expect(startingPlanFrom("Free", plans)).toBe("free");
    expect(() => startingPlanFrom("gold", plans)).toThrow(/names gold, which WHATBUILD_PLANS doesn't define; it defines free, pro/);
    expect(() => startingPlanFrom("free", [])).toThrow(/WHATBUILD_PLANS defines no plans/);
  });
});
