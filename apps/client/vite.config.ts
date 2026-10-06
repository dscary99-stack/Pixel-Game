import { defineConfig } from "vite";

// `?server` (empty) uses this proxy to reach `wrangler dev` on :8787 without CORS.
const proxy = {
  "/battles": "http://127.0.0.1:8787",
  "/character": "http://127.0.0.1:8787",
  "/town": "http://127.0.0.1:8787",
  "/party": "http://127.0.0.1:8787",
  "/quests": "http://127.0.0.1:8787",
  "/journal": "http://127.0.0.1:8787",
  "/frontier": "http://127.0.0.1:8787",
  "/world": { target: "http://127.0.0.1:8787", ws: true },
};

export default defineConfig({
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  server: { host: "127.0.0.1", port: 5173, proxy },
  preview: { host: "127.0.0.1", port: 4173, proxy },
});
