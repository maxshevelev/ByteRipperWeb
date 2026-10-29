import { installMapSource, MAP_FILE_NAMES } from "@/firmware/mapData/mapResources";

/**
 * Every suite reads the committed map files from disk, as upstream's tests read
 * them from the bundle: a worker's synchronous request has no counterpart in
 * Node. Installed before each file's tests by the test configuration, by a path
 * from the repository root, where every test runs. Node's file system is
 * reached at run time, as `fixtureFile.ts` reaches it: the domain's type-check
 * knows no Node.
 */
const fs = (await import(/* @vite-ignore */ "node:fs" as string)) as {
  readFileSync(path: string): Uint8Array;
};

installMapSource((family) => {
  try {
    return new Uint8Array(fs.readFileSync(`src/firmware/mapData/data/${MAP_FILE_NAMES[family]}`));
  } catch {
    return undefined;
  }
});
