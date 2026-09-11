import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
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
