import { describe, expect, it } from "vitest";
import { nodePgUrl, pgDumpCommand } from "../src/fixture.ts";

describe("pulling a copy of a deployment", () => {
  it("gives pg_dump the database's password in its environment, never on its command line", () => {
    for (const [url, password, dbname] of [
      ["postgresql://backup:s3cr%40t@db.example/whatbuild?sslmode=require&channel_binding=require", "s3cr@t", "postgresql://backup@db.example/whatbuild?sslmode=require&channel_binding=require"],
      ["postgres://backup:hunter2@/whatbuild?host=/cloudsql/example:region:db", "hunter2", "postgres://backup@/whatbuild?host=/cloudsql/example:region:db"],
      ["postgres://backup@db.example/whatbuild?password=hunter3&sslmode=require", "hunter3", "postgres://backup@db.example/whatbuild?sslmode=require"],
    ] as const) {
      const { args, env } = pgDumpCommand(url, "/tmp/database.dump");
      expect(args.join(" "), url).not.toContain(password);
      expect(args.join(" ")).not.toContain(encodeURIComponent(password));
      expect(args).toContain(`--dbname=${dbname}`);
      expect(env["PGPASSWORD"]).toBe(password);
    }
    const none = pgDumpCommand("postgres://backup@db.example/whatbuild", "/tmp/database.dump");
    expect(none.args).toEqual(["--format=custom", "--file=/tmp/database.dump", "--dbname=postgres://backup@db.example/whatbuild"]);
    expect(none.env["PGPASSWORD"]).toBe(process.env["PGPASSWORD"]);
  });

  it("reads the deployment with node's client using its trusted authorities where libpq would use the system's", () => {
    expect(nodePgUrl("postgresql://backup:pw@db.example/whatbuild?sslmode=verify-full&sslrootcert=system")).toBe("postgresql://backup:pw@db.example/whatbuild?sslmode=verify-full");
    expect(nodePgUrl("postgresql://backup:pw@db.example/whatbuild?sslrootcert=system")).toBe("postgresql://backup:pw@db.example/whatbuild");
    for (const url of ["postgresql://backup:pw@db.example/whatbuild?sslmode=require&sslrootcert=/etc/ca.pem", "postgres://backup@db.example/whatbuild"]) expect(nodePgUrl(url)).toBe(url);
  });
});
