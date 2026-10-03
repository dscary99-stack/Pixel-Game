import { defineConfig } from "vite";

// `?server` (empty) uses this proxy to reach `wrangler dev` on :8787 without CORS.
const proxy = { "/battles": "http://127.0.0.1:8787" };

export default defineConfig({
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  server: { host: "127.0.0.1", port: 5173, proxy },
  preview: { host: "127.0.0.1", port: 4173, proxy },
});
