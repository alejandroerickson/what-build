import { request as httpRequest, createServer as createHttpServer, type Server } from "node:http";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPublicAddress, publicOnlyLookup, SafeUrlFetcher, type Requester } from "../src/adapters/misc.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/** A lookup that sends every name to this machine, as if it were public, to reach a local server. */
const toLocalServer = publicOnlyLookup(async () => [{ address: "127.0.0.1", family: 4 }], () => true);
/** Plain HTTP in place of TLS, for a local server: everything else the fetcher does is unchanged. */
const plainHttp: Requester = (url, options, onResponse) => httpRequest(new URL(url.href.replace(/^https:/, "http:")), options, onResponse);

async function listen(server: Server | ReturnType<typeof createServer>) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; message: string };
  }
  throw new Error("expected the fetch to fail");
}

describe("which addresses are public", () => {
  it("refuses every special-purpose IPv4 range and everything outside IPv6 global unicast", () => {
    const notPublic = [
      "0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.0.9", "169.254.169.254",
      "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255",
      "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
      "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "::ffff:8.8.8.8", "::127.0.0.1",
      "64:ff9b::7f00:1", "64:ff9b:1::1", "100::1", "2001::1", "2001:db8::1", "2002:7f00:1::1", "3fff::1", "5f00::1",
      "fc00::1", "fd12:3456::1", "fe80::1", "fe90::1", "febf::1", "fec0::1", "feff::1", "ff02::1", "fe80::1%en0", "docs.example", "",
    ];
    const isPublic = ["93.184.215.14", "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.0.1.1", "198.17.255.255", "198.20.0.1", "223.255.255.255", "2606:2800:21f:cb07::1", "2a00:1450:4009:81f::200e", "2001:4860:4860::8888"];
    for (const ip of notPublic) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of isPublic) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe("the URL fetcher", () => {
  it("refuses an IP literal that is not public, in any notation, without connecting", async () => {
    const sockets: Socket[] = [];
    const server = createServer((s) => sockets.push(s.on("error", () => {})));
    const port = await listen(server);
    const fetcher = new SafeUrlFetcher();
    const urls = [
      `https://127.0.0.1:${port}/a`, `https://2130706433:${port}/a`, `https://0x7f.0.0.1:${port}/a`, `https://0177.0.0.1:${port}/a`,
      `https://127.1:${port}/a`, `https://[::1]:${port}/a`, `https://[::ffff:127.0.0.1]:${port}/a`, `https://[::ffff:7f00:1]:${port}/a`,
      "https://169.254.169.254/latest/meta-data", "https://[fe90::1]/", "https://[fec0::1]/", "https://[64:ff9b::a9fe:a9fe]/",
      "https://[2002:a9fe:a9fe::1]/", "https://0/", "https://100.100.100.200/",
    ];
    for (const url of urls) {
      const e = await failure(fetcher.fetch(url, 1024));
      expect(e.code, url).toBe("unsafe_url");
    }
    expect(sockets).toHaveLength(0);
    server.close();
  });

  it("refuses a redirect to an IP literal that is not public, and follows one to a name", async () => {
    let secret = 0;
    const server = createHttpServer((req, res) => {
      const to = req.url?.slice("/to/".length);
      if (req.url?.startsWith("/to/")) res.writeHead(302, { location: decodeURIComponent(to!) }).end();
      else if (req.url === "/secret") (secret++, res.end("internal"));
      else res.end("public page");
    });
    const port = await listen(server);
    const fetcher = new SafeUrlFetcher({ lookup: toLocalServer, request: plainHttp });
    for (const target of [`https://127.0.0.1:${port}/secret`, `https://[::ffff:127.0.0.1]:${port}/secret`, `https://2130706433:${port}/secret`, "https://169.254.169.254/latest"]) {
      const e = await failure(fetcher.fetch(`https://docs.example:${port}/to/${encodeURIComponent(target)}`, 1024));
      expect(e.code, target).toBe("unsafe_url");
    }
    expect(secret).toBe(0);
    const ok = await fetcher.fetch(`https://docs.example:${port}/to/${encodeURIComponent(`https://docs.example:${port}/page.html`)}`, 1024);
    expect(new TextDecoder().decode(ok.bytes)).toBe("public page");
    server.close();
  });

  it("keeps a file name whose escapes do not decode as it came, in the address or the server's header", async () => {
    const server = createHttpServer((req, res) => {
      if (req.url === "/named") res.writeHead(200, { "content-disposition": "attachment; filename*=UTF-8''crew%E0%A4%A.txt" });
      res.end("Crews plan by the week.");
    });
    const port = await listen(server);
    const fetcher = new SafeUrlFetcher({ lookup: toLocalServer, request: plainHttp });
    expect((await fetcher.fetch(`https://docs.example:${port}/report%C0.txt`, 1024)).fileName).toBe("report%C0.txt");
    expect((await fetcher.fetch(`https://docs.example:${port}/named`, 1024)).fileName).toBe("crew%E0%A4%A.txt");
    server.close();
  });

  it("gives up on the whole download at its deadline, however steadily a server trickles", async () => {
    const server = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      const drip = setInterval(() => res.write("."), 50);
      res.on("close", () => clearInterval(drip));
    });
    const port = await listen(server);
    const fetcher = new SafeUrlFetcher({ lookup: toLocalServer, request: plainHttp, deadlineMs: 400 });
    const started = Date.now();
    const e = await failure(fetcher.fetch(`https://docs.example:${port}/slow.txt`, 1024 * 1024));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(e.code).toBe("fetch_failed");
    server.closeAllConnections();
    server.close();
  });

  it("answers the same plain failure whether a name is private, a port is closed or a server is silent", async () => {
    const closed = createServer();
    const closedPort = await listen(closed);
    closed.close();
    const silent = createServer(() => {});
    const silentPort = await listen(silent);
    const intranet = new SafeUrlFetcher({ lookup: publicOnlyLookup(async () => [{ address: "10.20.30.40", family: 4 }]) });
    const local = new SafeUrlFetcher({ lookup: toLocalServer, deadlineMs: 300 });
    const failures = [
      await failure(intranet.fetch("https://wiki.intranet.example/doc", 1024)),
      await failure(local.fetch(`https://docs.example:${closedPort}/doc`, 1024)),
      await failure(local.fetch(`https://docs.example:${silentPort}/doc`, 1024)),
    ];
    for (const e of failures) {
      expect(e.code).toBe("fetch_failed");
      expect(e.message).toBe(failures[0]!.message);
      expect(e.message).not.toMatch(/10\.20\.30\.40|intranet|non-public|ECONNREFUSED|timed out|127\.0\.0\.1/);
    }
    silent.close();
  });
});

describe("attachments.fetch_url", () => {
  let h: Harness;
  let alice: Browser;
  let bob: Browser;
  let P: string;
  let recordId: string;
  /** Downloads that wait until the test lets them finish, standing in for a slow server. */
  const waiting: (() => void)[] = [];
  let failWith: Error | null = null;
  const fetcher = {
    async fetch() {
      if (failWith) throw failWith;
      await new Promise<void>((r) => waiting.push(r));
      return { bytes: new TextEncoder().encode("Crews plan by the week."), fileName: "notes.txt", mediaType: "text/plain" };
    },
  };
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
    expect(check()).toBe(true);
  };
  const release = () => waiting.splice(0).forEach((r) => r());
  let n = 0;
  const fetchAs = (who: Browser) => who.api("POST", `${P}/sources/${recordId}/fetch`, { record_id: recordId, url: "https://docs.example.com/notes", path: `notes-${++n}.txt` });

  beforeAll(async () => {
    h = await startHarness({}, { fetcher });
    alice = await h.signIn("alice@example.com", "Alice Example");
    bob = await h.signIn("bob@example.com", "Bob Example");
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Fetch Co" });
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
    P = `/api/v1/p/${p.body.path}`;
    await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, email: "bob@example.com", role: "editor" });
    recordId = (await alice.api("POST", `${P}/sources`, { tags: ["wiki"], title: "Crew planning notes — Example Co" })).body.record_id;
  });
  afterAll(async () => {
    release();
    await h?.close();
  });

  it("holds no database connection while it downloads", async () => {
    // The harness's pool has five connections; five slow downloads must not take them all.
    const calls = [fetchAs(alice), fetchAs(alice), fetchAs(alice), fetchAs(bob), fetchAs(bob)];
    await until(() => waiting.length === 5);
    const meanwhile = await Promise.race([alice.api("GET", "/api/v1/me/products"), new Promise<"stuck">((r) => setTimeout(() => r("stuck"), 3000))]);
    release();
    const done = await Promise.all(calls);
    expect(meanwhile).not.toBe("stuck");
    expect(done.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
  });

  it("lets one account run only a few fetches at once", async () => {
    const first = [fetchAs(alice), fetchAs(alice), fetchAs(alice)];
    await until(() => waiting.length === 3);
    const fourth = await fetchAs(alice);
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatchObject({ code: "rate_limited", details: { limit: 3 } });
    const other = fetchAs(bob);
    await until(() => waiting.length === 4);
    release();
    expect((await Promise.all([...first, other])).map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const again = fetchAs(alice);
    await until(() => waiting.length === 1);
    release();
    expect((await again).status).toBe(201);
  });

  it("does not pass on what the network said when a fetch fails", async () => {
    failWith = new Error("connect ECONNREFUSED 10.1.2.3:443");
    const r = await fetchAs(alice);
    failWith = null;
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("fetch_failed");
    expect(r.body.error.message).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
  });
});
