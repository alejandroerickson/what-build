import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const api = process.env["WHATBUILD_API"] ?? "http://localhost:8787";
const proxied = ["/api", "/auth", "/oauth", "/mcp", "/.well-known", "/health", "/invite-accept", "/prototypes"];
// The commit the image is built from, which the server records too (apps/server/build.mjs): the app
// compares it with the server's to know that a release replaced it. Empty in development.
const commit = /^[0-9a-f]{40}$/.test(process.env["WHATBUILD_COMMIT"] ?? "") ? process.env["WHATBUILD_COMMIT"]! : "";

export default defineConfig({
  plugins: [react()],
  define: { __WHATBUILD_COMMIT__: JSON.stringify(commit) },
  server: {
    port: Number(process.env["WHATBUILD_WEB_PORT"] ?? 5273),
    strictPort: true,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: api, changeOrigin: false }])),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // The app, and the public site's pages (dist/site/index.html, dist/site/plans/index.html), which the server serves on the site's own host.
    rollupOptions: { input: { app: fileURLToPath(new URL("index.html", import.meta.url)), site: fileURLToPath(new URL("site/index.html", import.meta.url)), "site-plans": fileURLToPath(new URL("site/plans/index.html", import.meta.url)) } },
  },
  test: { name: "web", environment: "jsdom", include: ["test/**/*.test.ts?(x)"] },
} as never);
