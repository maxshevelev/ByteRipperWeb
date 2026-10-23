/**
 * A fixture file, by its path from the repository root — where every test runs. Node's file
 * system is reached at run time: the core's type-check knows no Node, and every test runs under it.
 */
const fs = (await import(/* @vite-ignore */ "node:fs" as string)) as {
  readFileSync(path: string): Uint8Array;
  existsSync(path: string): boolean;
};

/** The bytes of the fixture at `path`. */
export const fixtureBytes = (path: string): Uint8Array => new Uint8Array(fs.readFileSync(path));

/** Whether there is a fixture at `path`. */
export const fixtureExists = (path: string): boolean => fs.existsSync(path);
