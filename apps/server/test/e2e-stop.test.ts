import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { instancePid, stopInstance } from "../src/e2e.ts";

// pnpm e2e stop stops the end-to-end instance this checkout started, named by the pid file
// pnpm dev:e2e keeps, and leaves another checkout's instance serving its own tests.

const dir = mkdtempSync(join(tmpdir(), "e2e-stop-"));
const pidFile = join(dir, "dev.pid");
const started: ChildProcess[] = [];

/** A process that runs until interrupted, its command line reading as pnpm dev:e2e's when `args` say so. */
async function runUntilInterrupted(args: string[]): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "process.on('SIGINT', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000);", ...args], { stdio: ["ignore", "pipe", "ignore"] });
  started.push(child);
  await new Promise<void>((ready) => child.stdout!.once("data", () => ready()));
  return child;
}

const exited = (child: ChildProcess) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((done) => child.once("exit", () => done())));

afterAll(() => {
  for (const child of started) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
});

describe("pnpm e2e stop", () => {
  it("stops the instance this checkout's pid file names, and leaves another checkout's running", async () => {
    const ours = await runUntilInterrupted(["apps/server/src/dev.ts", "--e2e"]);
    const theirs = await runUntilInterrupted(["apps/server/src/dev.ts", "--e2e"]);
    writeFileSync(pidFile, `${ours.pid}\n`);
    expect(instancePid(pidFile)).toBe(ours.pid);

    expect(await stopInstance(pidFile)).toEqual({ pid: ours.pid, stopped: true });
    await exited(ours);
    expect(ours.exitCode).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
    expect(theirs.exitCode).toBeNull();
    expect(theirs.signalCode).toBeNull();
    // Nothing of this checkout's runs now, and the other instance is still not touched.
    expect(await stopInstance(pidFile)).toEqual({ pid: null, stopped: false });
    expect(theirs.exitCode).toBeNull();
  });

  it("takes no process that has the id of an instance that is gone for it, and removes the file it left", async () => {
    const stranger = await runUntilInterrupted([]);
    writeFileSync(pidFile, `${stranger.pid}\n`);
    expect(instancePid(pidFile)).toBeNull();
    expect(existsSync(pidFile)).toBe(false);
    writeFileSync(pidFile, `${stranger.pid}\n`);
    expect(await stopInstance(pidFile)).toEqual({ pid: null, stopped: false });
    expect(stranger.exitCode).toBeNull();
    expect(stranger.signalCode).toBeNull();
    writeFileSync(pidFile, "not a process\n");
    expect(instancePid(pidFile)).toBeNull();
    expect(existsSync(pidFile)).toBe(false);
  });
});
