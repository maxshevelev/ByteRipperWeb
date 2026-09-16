import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // Which names the dev server answers to, and on which port, is the machine's
  // business and not the repository's: this bench opens it at its own name on
  // the tailnet, someone else's clone opens it at localhost, and neither should
  // have to edit this file — or worse, commit their address into it. It comes
  // from `.env.local`, which is never committed, and `.env.local.example` says
  // which keys it holds. `loadEnv` reads the file on every start, so `npm run
  // dev` stays the whole instruction: no flags to remember, and none to get
  // wrong at the next restart.
  const local = loadEnv(mode, root, "DEV_SERVER_");
  const allowedHosts = (local.DEV_SERVER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one.length > 0);

  return {
    // The app is published as a GitHub Pages *project* page, which is served from
    // a subdirectory of the host rather than its root. Without this, the bundle
    // asks for `/assets/...`, the host has no such path, and the page comes up
    // blank while the dev server — which serves from the root — looks fine.
    base: "/ByteRipperWeb/",
    plugins: [react()],
    server: {
      // Where it listens, and who it answers — and both are needed. Binding
      // every interface is what lets another machine open it at all; a server
      // on loopback alone is one nobody off this machine can reach, whatever
      // names it answers to. `allowedHosts` is the other half, Vite's guard
      // against DNS rebinding, and it binds nothing by itself. With no
      // `.env.local` the server still runs: it answers localhost and its own
      // addresses, and refuses any other `Host`.
      host: true,
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
      // Pinned, and strictly: the address is a bookmark on the machines that
      // open it, and a server that quietly steps to the next free port is one
      // answering an older session, or nothing at all. Refusing to start is the
      // honest outcome, and it names what holds the port.
      port: Number(local.DEV_SERVER_PORT ?? 5173),
      strictPort: true,
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
  };
});
