import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const api = process.env["WHATBUILD_API"] ?? "http://localhost:8787";
const proxied = ["/api", "/auth", "/oauth", "/mcp", "/.well-known", "/whatbuild-skill.md", "/whatbuild-skill.zip", "/health", "/invite-accept", "/prototypes"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env["WHATBUILD_WEB_PORT"] ?? 5273),
    strictPort: true,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: api, changeOrigin: false }])),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // The app, and the public site's page (dist/site/index.html), which the server serves on the site's own host.
    rollupOptions: { input: { app: fileURLToPath(new URL("index.html", import.meta.url)), site: fileURLToPath(new URL("site/index.html", import.meta.url)) } },
  },
  test: { name: "web", environment: "jsdom", include: ["test/**/*.test.ts?(x)"] },
} as never);
