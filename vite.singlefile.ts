import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/**
 * The whole app as one HTML file (`npm run build:single`, `--mode single`):
 * something a bench can be sent, keep on a stick, and open from disk.
 *
 * Written here rather than taken from a package — it is fifty lines, and the
 * one thing a generic single-file plugin does not know is the thing that
 * matters: the workers. The bundle is built with no code splitting, so the
 * app is one script and one stylesheet, and both go into the page. The four
 * workers are bundled separately and are self-contained (no imports of their
 * own), so each becomes a `blob:` URL made from its code where the bundle
 * asked for its file, and runs as a classic worker.
 */
export function singleFile(): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: "byteripper-single-file",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((one) => one.fileName === "index.html");
      if (html === undefined || html.type !== "asset")
        throw new Error("no index.html in the bundle");
      let page = String(html.source);

      const workers = Object.values(bundle).filter((one) =>
        /\.worker-[^/]+\.js$/.test(one.fileName)
      );
      // One entry script and the workers, and nothing lazy beside them: a
      // chunk loaded on demand — a help page, a catalogue — would be a file
      // the page asks for and a page opened from disk cannot fetch.
      const stray = Object.values(bundle).filter(
        (one) => one.type === "chunk" && !one.isEntry && !workers.includes(one)
      );
      if (stray.length > 0) {
        throw new Error(`split into chunks: ${stray.map((one) => one.fileName).join(", ")}`);
      }
      const workerCode = (fileName: string): string => {
        const worker = bundle[fileName];
        if (worker === undefined) throw new Error(`no worker ${fileName}`);
        return worker.type === "chunk" ? worker.code : String(worker.source);
      };

      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk" || !item.isEntry) continue;
        let code = item.code;
        // `new URL(\`…/assets/diff.worker-XXXX.js\`, ``+import.meta.url)` and
        // its spellings: the whole URL expression goes, a blob of the code
        // comes in its place, and `new Worker(…, { type: "module" })` takes it.
        for (const worker of workers) {
          const name = (worker.fileName.split("/").pop() ?? "").replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          // The file's own URL, relative to the page or already absolute…
          const file = `new URL\\(\\s*[\`"'][^\`"']*${name}[\`"']\\s*,\\s*(?:\`\`\\s*\\+\\s*)?import\\.meta\\.url\\s*\\)`;
          // …and, with a relative base, wrapped once more: new URL(new URL(…).href, …).
          // The options go with it: a *module* worker from a `blob:` URL is
          // refused on a page opened from disk (measured in Chrome), and these
          // bundles have no import or export, so a classic worker runs them.
          const url = `(?:new URL\\(\\s*${file}\\.href\\s*,\\s*(?:\`\`\\s*\\+\\s*)?import\\.meta\\.url\\s*\\)|${file})`;
          const reference = new RegExp(
            `${url}\\s*,\\s*\\{\\s*type\\s*:\\s*[\`"']module[\`"']\\s*\\}`,
            "g"
          );
          const blob = `URL.createObjectURL(new Blob([${JSON.stringify(workerCode(worker.fileName))}],{type:"text/javascript"}))`;
          const replaced = code.replace(reference, () => blob);
          if (replaced === code) {
            const at = code.indexOf(worker.fileName.replace(/^.*\//, ""));
            throw new Error(
              `the bundle does not ask for ${worker.fileName}${at < 0 ? "" : `: …${code.slice(at - 120, at + 80)}…`}`
            );
          }
          code = replaced;
        }
        // The lazy imports were folded into this chunk, but each still goes
        // through Vite's preload helper with a placeholder for the files to
        // preload, which the build never fills in when there are no files:
        // `__VITE_PRELOAD__ is not defined`, and the help came up empty. There
        // is nothing to preload in a page that holds everything.
        code = code.replaceAll("__VITE_PRELOAD__", "void 0");
        // `</script` inside the code would end the element early.
        const inline = code.replace(/<\/script/gi, "<\\/script");
        const tag = new RegExp(`<script[^>]*src="[^"]*${item.fileName}"[^>]*></script>`);
        if (!tag.test(page)) throw new Error(`index.html does not load ${item.fileName}`);
        page = page.replace(tag, () => `<script type="module">${inline}</script>`);
      }

      for (const item of Object.values(bundle)) {
        if (item.type !== "asset" || !item.fileName.endsWith(".css")) continue;
        const tag = new RegExp(`<link[^>]*href="[^"]*${item.fileName}"[^>]*>`);
        if (!tag.test(page)) throw new Error(`index.html does not load ${item.fileName}`);
        page = page.replace(tag, () => `<style>${String(item.source)}</style>`);
      }
      if (/<(script|link)[^>]+(src|href)="[^"]*assets\//.test(page)) {
        throw new Error("index.html still loads a file from assets/");
      }
      html.source = page;
    },
    // Everything is in the page now; what the bundler wrote beside it goes.
    // (A file cannot be taken out of the bundle while it is being generated.)
    writeBundle() {
      if (config === undefined) return;
      const out = path.resolve(config.root, config.build.outDir);
      rmSync(path.join(out, "assets"), { recursive: true, force: true });
      const left = readdirSync(out).filter((name) => name !== "index.html");
      if (left.length > 0) throw new Error(`not inlined: ${left.join(", ")}`);
    },
  };
}
