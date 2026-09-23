import { resolve } from "node:path";
import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Two pages: the desktop tuning preview (index.html) and the phone AR build
// (ar.html). HTTPS is required because iOS Safari only grants camera access to
// secure origins, and `host: true` exposes the dev server on the LAN.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5174 },
  build: {
    rollupOptions: {
      input: {
        preview: resolve(import.meta.dirname, "index.html"),
        ar: resolve(import.meta.dirname, "ar.html"),
      },
    },
  },
});
