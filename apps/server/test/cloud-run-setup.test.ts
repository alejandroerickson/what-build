import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

// deploy/cloud-run/setup.sh, run against a stand-in gcloud that answers as a project holding the
// secrets named, and writes down every call, so what the migration job and the service are given
// can be read without a Google Cloud project.

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function runSetup(settings: Record<string, string>, secrets: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "whatbuild-setup-"));
  const log = join(dir, "calls");
  const gcloud = [
    "#!/usr/bin/env bash",
    `printf '%s\\n' "$*" >> "${log}"`,
    'args=" $* "',
    'case "$args" in',
    `  *" secrets describe "*) for s in ${secrets.join(" ")}; do [[ "$args" == *" secrets describe $s "* ]] && exit 0; done; exit 1 ;;`,
    '  *" projects describe "*) echo 123456789012 ;;',
    '  *" config get-value account"*) echo someone@example.com ;;',
    '  *" run jobs describe "*|*" pubsub topics describe "*) exit 1 ;;',
    "esac",
    "exit 0",
  ].join("\n");
  writeFileSync(join(dir, "gcloud"), gcloud);
  // The alerts are made by Node, which is left out here: a stand-in that does nothing.
  writeFileSync(join(dir, "node"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "gcloud"), 0o755);
  chmodSync(join(dir, "node"), 0o755);
  try {
    const run = spawnSync("bash", ["deploy/cloud-run/setup.sh"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, PROJECT_ID: "my-whatbuild", DATABASE_URL: "postgres://db.example.com/whatbuild", ...settings },
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    const given = (verb: string, flag: string) => {
      const call = calls.find((c) => c.includes(verb));
      return call ? (new RegExp(`${flag} (\\S+)`).exec(call)?.[1] ?? "") : null;
    };
    return { status: run.status, stderr: run.stderr, calls, jobSecrets: given("run jobs create", "--set-secrets"), serviceSecrets: given("run deploy", "--set-secrets"), serviceEnv: given("run deploy", "--set-env-vars") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The settings a Cloud Run container gets from `--set-secrets`, each with a value that passes the server's checks. */
function asSettings(secrets: string): Record<string, string> {
  const value: Record<string, string> = { DATABASE_URL: "postgres://db.example.com/whatbuild", WHATBUILD_GRANT_KEY: "g".repeat(48), WHATBUILD_EDGE_KEY: "e".repeat(40), WHATBUILD_TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret" };
  return Object.fromEntries(secrets.split(",").map((pair) => pair.split("=")[0]!).map((name) => [name, value[name] ?? "set"]));
}

describe("setup.sh on Cloud Run, with the bot check's keys", () => {
  const held = ["whatbuild-database-url", "whatbuild-grant-key", "whatbuild-edge-key", "whatbuild-turnstile-secret-key"];

  it("gives the service both keys and the migration job neither, so migrating starts as before", () => {
    const run = runSetup({ TURNSTILE_SITE_KEY: "0x4AAAAAAA-site" }, held);
    expect(run.status, run.stderr).toBe(0);
    expect(run.serviceSecrets).toContain("WHATBUILD_TURNSTILE_SECRET_KEY=whatbuild-turnstile-secret-key:latest");
    expect(run.serviceEnv).toContain("WHATBUILD_TURNSTILE_SITE_KEY=0x4AAAAAAA-site");
    expect(run.jobSecrets).toBe("DATABASE_URL=whatbuild-database-url:latest,WHATBUILD_GRANT_KEY=whatbuild-grant-key:latest,WHATBUILD_EDGE_KEY=whatbuild-edge-key:latest");
    // What `main.js migrate` reads at start: the job's settings load; the service's secrets alone, without its site key, would not.
    expect(() => loadConfig({ NODE_ENV: "production", ...asSettings(run.jobSecrets!) })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: "production", ...asSettings(run.serviceSecrets!) })).toThrow(/go together/);
  });

  it("stops before changing anything when the secret key is held and no site key is given, or a site key comes without one", () => {
    for (const [settings, secrets, says] of [
      [{}, held, /pass its widget's TURNSTILE_SITE_KEY too/],
      [{ TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret" }, held.slice(0, 3), /pass its widget's TURNSTILE_SITE_KEY too/],
      [{ TURNSTILE_SITE_KEY: "0x4AAAAAAA-site" }, held.slice(0, 3), /TURNSTILE_SITE_KEY needs its secret key/],
    ] as const) {
      const run = runSetup(settings, [...secrets]);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(says);
      expect(run.calls.some((c) => / (services enable|builds submit|run deploy|run jobs|secrets create|secrets versions add) /.test(` ${c} `))).toBe(false);
    }
  });

  it("leaves the bot check off, and both lists alike but for it, when neither key is anywhere", () => {
    const run = runSetup({}, held.slice(0, 3));
    expect(run.status, run.stderr).toBe(0);
    expect(run.serviceSecrets).toBe(run.jobSecrets);
    expect(run.serviceEnv).not.toContain("TURNSTILE");
  });
});
