import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // xfwd: the server sees each browser's real address (X-Forwarded-For), so a phone on the LAN is
    // "lan" and not "this machine" (apps/server/src/auth/origin.ts).
    proxy: {
      "/api": { target, xfwd: true },
      "/media": target,
      "/ws": { target: target.replace("http", "ws"), ws: true, xfwd: true },
    },
  },
});
