import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app is published as a GitHub Pages *project* page, which is served from
  // a subdirectory of the host rather than its root. Without this, the bundle
  // asks for `/assets/...`, the host has no such path, and the page comes up
  // blank while the dev server — which serves from the root — looks fine.
  base: "/ByteRipperWeb/",
  plugins: [react()],
  server: {
    // The dev server answers only the hosts it knows by name, which is Vite's
    // guard against DNS rebinding. The bench machines on the local network reach
    // it by these.
    allowedHosts: ["admins-imac", "admins-imac.local"],
  },
  build: {
    // `benchmarks/paint/` is a page Vite serves in development and Playwright
    // will drive in M12. It is not part of the app and does not ship.
    rollupOptions: { input: fileURLToPath(new URL("./index.html", import.meta.url)) },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The domain half is headless by construction (D1), so the default
    // environment is Node. A suite that needs a DOM asks for one per file with
    // `// @vitest-environment jsdom`, and brings the dependency with it.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
