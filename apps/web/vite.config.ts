import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env["WHATBUILD_API"] ?? "http://localhost:8787";
const proxied = ["/api", "/auth", "/oauth", "/mcp", "/.well-known", "/install.sh", "/install.ps1", "/whatbuild-skill.md", "/whatbuild-skill.zip", "/healthz", "/invite-accept"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env["WHATBUILD_WEB_PORT"] ?? 5273),
    strictPort: true,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: api, changeOrigin: false }])),
  },
  build: { outDir: "dist", sourcemap: true },
  test: { name: "web", environment: "jsdom", include: ["test/**/*.test.ts?(x)"] },
} as never);
