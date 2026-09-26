import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/parsers", "apps/server", "apps/web"],
  },
});
