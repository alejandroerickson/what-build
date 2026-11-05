import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// A run of the server tests whose Postgres port another server holds (another checkout's running
// suite, say) ends with the refusal that names the port and the variable that moves it, not with
// an error from vitest's own printing of it.

const serverDir = join(import.meta.dirname, "..");
const vitestBin = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
/** The one test file the run names; any file of the server's would do. */
const ONE_FILE = "test/address-lists-config.test.ts";
const sockets = new Set<Socket>();
let holder: Server | undefined;
let child: ChildProcess | undefined;

afterAll(async () => {
  child?.kill();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((done) => (holder ? holder.close(() => done()) : done()));
});

/** A server on a port of its own that takes connections and never answers, as a server that is not Postgres does. */
async function holdAPort(): Promise<number> {
  holder = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((done) => holder!.listen(0, "127.0.0.1", () => done()));
  return (holder.address() as AddressInfo).port;
}

/**
 * vitest run on the server project, and what it printed. It names one test file, as vitest runs
 * the global setup only when some file matches; the setup refuses the port before that file runs.
 */
function runServerSetup(port: number): Promise<string> {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith("VITEST") && !name.startsWith("TEST_DATABASE_")) env[name] = value;
  env["WHATBUILD_TEST_PG_PORT"] = String(port);
  env["NO_COLOR"] = "1";
  return new Promise((done, fail) => {
    const run = spawn(process.execPath, [vitestBin, "run", "--config", "vitest.config.ts", ONE_FILE], { cwd: serverDir, env, stdio: ["ignore", "pipe", "pipe"] });
    child = run;
    let output = "";
    run.stdout.on("data", (chunk) => (output += chunk));
    run.stderr.on("data", (chunk) => (output += chunk));
    run.on("error", fail);
    run.on("exit", () => done(output));
  });
}

describe("the server tests' global setup", () => {
  it("says the Postgres port is taken, and names the variable that moves it", async () => {
    expect(existsSync(join(serverDir, ONE_FILE)), `${ONE_FILE} is gone: name another test file of the server's`).toBe(true);
    const port = await holdAPort();
    const output = await runServerSetup(port);
    expect(output).not.toContain("charCodeAt");
    expect(output).toContain(`Port ${port} is taken by a server that is not this checkout's Postgres`);
    expect(output).toContain("WHATBUILD_TEST_PG_PORT");
  });
});
