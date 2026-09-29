import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { singleFile } from "./vite.singlefile.ts";

const root = fileURLToPath(new URL(".", import.meta.url));

// The version the landing screen signs off with: the upstream release this
// edition was last brought level with, which the release skill writes into
// package.json (Skills/release). One home for the number.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as {
  readonly version: string;
};

export default defineConfig(({ mode, command }) => {
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

  // `--mode single`: the whole app in one HTML file, opened from disk — so
  // every path is relative, nothing is split into chunks, and the plugin puts
  // the script, the stylesheet and the workers into the page.
  const single = mode === "single";

  return {
    // A build that is not a release says so on the landing screen: the dev
    // server, and the Pages preview of `main`, which sets APP_VERSION_SUFFIX
    // (.github/workflows/deploy-pages.yml). A release — the page built from its
    // tag, the single file, the Windows build — carries the number alone.
    define: {
      __APP_VERSION__: JSON.stringify(
        `${version}${process.env.APP_VERSION_SUFFIX ?? (command === "serve" ? "-dev" : "")}`
      ),
    },
    // The app is published as a GitHub Pages *project* page, which is served from
    // a subdirectory of the host rather than its root. Without this, the bundle
    // asks for `/assets/...`, the host has no such path, and the page comes up
    // blank while the dev server — which serves from the root — looks fine.
    // `PAGES_BASE` moves it for the development preview, which is published
    // beside the released app at /ByteRipperWeb/preview/
    // (.github/workflows/deploy-pages.yml).
    base: single ? "./" : (process.env.PAGES_BASE ?? "/ByteRipperWeb/"),
    plugins: single ? [react(), singleFile()] : [react()],
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
      ...(single
        ? {
            outDir: "dist-single",
            assetsInlineLimit: Number.MAX_SAFE_INTEGER,
            cssCodeSplit: false,
            // Nothing to preload in a page that holds everything.
            modulePreload: false,
            chunkSizeWarningLimit: Number.MAX_SAFE_INTEGER,
            rolldownOptions: { output: { inlineDynamicImports: true } },
          }
        : {}),
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
      // A timeout is here to catch a test that hangs, not a machine that is
      // busy. Nearly every test in this suite is instantaneous, but a handful
      // do real work — LZMA at its maximum level, the SHA-384 and SHA-512
      // vectors, a megabyte joined through the piece table — and those take
      // about a second each on an idle machine. Vitest runs one worker per
      // core, so on a full one they take several, and the default five seconds
      // failed them at random rather than the run after a genuine regression.
      // Twenty is long enough that only a test that will never finish hits it.
      testTimeout: 20_000,
    },
  };
});
