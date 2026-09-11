/**
 * Teaches Node the project's `@/` alias, for `node --import ./benchmarks/register.mjs`.
 *
 * The benchmark has to run the very code that ships — `FileBackedStorage` over
 * the real chunk cache, not a reimplementation of it in the harness — and that
 * code imports through `@/`, which Vite resolves in the app and in the tests.
 * Node resolves nothing of the sort.
 *
 * Thirty lines of `node:module` rather than a dev dependency (`vite-node`)
 * whose only job here would be the same substitution. If the harness ever needs
 * something else Vite does — a plugin, an asset import — that is the moment to
 * reach for the dependency, and not before.
 *
 * Plain JavaScript on purpose: there are no types here worth writing, and the
 * file has to load before anything that would need them.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const sourceRoot = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

    const target = new URL(specifier.slice(2), sourceRoot);
    // The alias is written without an extension, as a bundler expects. Try the
    // spellings a TypeScript source can actually have.
    const candidates = [target, new URL(`${target.href}.ts`), new URL(`${target.href}/index.ts`)];
    for (const candidate of candidates) {
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
