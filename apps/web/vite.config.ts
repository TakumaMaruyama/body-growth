import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiOrigin = process.env.API_DEV_ORIGIN ?? "http://127.0.0.1:3001";

if (!Number.isInteger(webPort) || webPort <= 0) {
  throw new Error("WEB_PORT must be a positive integer");
}

const previewHosts = [
  "localhost",
  "127.0.0.1",
  ...[process.env.REPLIT_DOMAINS, process.env.REPLIT_DEV_DOMAIN]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
  ".replit.dev",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: "0.0.0.0",
    port: webPort,
    strictPort: true,
    allowedHosts: [...new Set(previewHosts)],
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: false,
      },
    },
  },
});
