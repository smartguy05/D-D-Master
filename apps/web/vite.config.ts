import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": target,
      "/media": target,
      "/ws": { target: target.replace("http", "ws"), ws: true },
    },
  },
});
