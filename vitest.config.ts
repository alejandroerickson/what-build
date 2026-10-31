import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/parsers", "apps/server", "apps/web"],
    // The line each parse logs for whoever runs a deployment says nothing to a test run; the parse's own tests read it.
    onConsoleLog: (log) => (log.startsWith("parse: ") ? false : undefined),
  },
});
