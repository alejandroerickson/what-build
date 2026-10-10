import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { insideRoot, staticRoutes } from "../src/public-routes.ts";

const base = mkdtempSync(join(tmpdir(), "whatbuild-static-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("the web app's files", () => {
  it("are served only from inside their folder, never from a sibling whose name starts the same", async () => {
    expect(insideRoot("/srv/web", "/srv/web/assets/app.js")).toBe(true);
    expect(insideRoot("/srv/web", "/srv/web-private/secret.txt")).toBe(false);
    expect(insideRoot("/srv/web", "/srv/web")).toBe(false);
    expect(insideRoot("/srv/web", "/srv/other/web/app.js")).toBe(false);

    const dist = join(base, "web");
    mkdirSync(join(dist, "assets"), { recursive: true });
    mkdirSync(join(base, "web-private"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>app</title>");
    writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(base, "web-private", "secret.txt"), "not for the web");
    const app = staticRoutes(dist);
    expect(await (await app.request("/assets/app.js")).text()).toBe("console.log(1)");
    for (const path of ["/../web-private/secret.txt", "/%2e%2e/web-private/secret.txt", "/..%2fweb-private%2fsecret.txt"]) {
      const res = await app.request(path);
      expect(await res.text(), path).not.toContain("not for the web");
    }
  });
});
