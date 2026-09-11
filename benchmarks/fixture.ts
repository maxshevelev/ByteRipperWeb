/**
 * Finding something to measure against.
 *
 * A real dump is the only fixture worth trusting a number from — it is what the
 * shop actually opens, and it comes off a disk through the OS cache rather than
 * out of a buffer. `benchmarks/fixtures/` is gitignored precisely so real ones
 * can live there.
 *
 * When there is none, the harness synthesises one rather than refusing to run,
 * and says so in its output loudly enough that nobody quotes the number. The
 * synthetic file is written to the OS temp directory and read back through the
 * same `Blob` path, so it is at least a file on a disk and not a buffer.
 */

import { openAsBlob } from "node:fs";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Fixture {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  /** False when the bytes were invented here, which changes what a number means. */
  readonly real: boolean;
  /**
   * The file as a `Blob`, which is the same interface a browser's `File`
   * offers — so the code under measurement is the code that will ship.
   */
  blob(): Promise<Blob>;
}

const FIXTURE_DIRECTORY = new URL("./fixtures/", import.meta.url).pathname;
const SYNTHETIC_SIZE = 16 * 1024 * 1024;

/**
 * The dump to measure against: `$BENCH_FIXTURE` if set, otherwise the largest
 * file in `benchmarks/fixtures/`, otherwise a synthetic one.
 */
export async function resolveFixture(): Promise<Fixture> {
  const named = process.env.BENCH_FIXTURE;
  if (named !== undefined && named !== "") return await describe(named, true);

  const candidates: { path: string; size: number }[] = [];
  for (const entry of await readdir(FIXTURE_DIRECTORY).catch(() => [])) {
    if (entry.startsWith(".") || entry.endsWith(".md")) continue;
    const path = join(FIXTURE_DIRECTORY, entry);
    const info = await stat(path);
    if (info.isFile()) candidates.push({ path, size: info.size });
  }

  candidates.sort((a, b) => b.size - a.size);
  const largest = candidates[0];
  return largest === undefined ? await synthesise() : await describe(largest.path, true);
}

async function describe(path: string, real: boolean): Promise<Fixture> {
  const info = await stat(path);
  return {
    path,
    name: path.split("/").pop() ?? path,
    size: info.size,
    real,
    blob: () => openAsBlob(path),
  };
}

/**
 * A 16 MB stand-in shaped like a flash dump rather than like noise: mostly
 * erased `0xFF`, with structured regions between. Deterministic, so two runs on
 * one machine are comparable with each other even though neither is comparable
 * with a real dump.
 */
async function synthesise(): Promise<Fixture> {
  const bytes = new Uint8Array(SYNTHETIC_SIZE).fill(0xff);
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  };
  for (let region = 0; region < SYNTHETIC_SIZE; region += 0x40000) {
    const end = Math.min(region + 0x30000, SYNTHETIC_SIZE);
    for (let at = region; at < end; at++) bytes[at] = next();
  }

  const directory = await mkdtemp(join(tmpdir(), "byteripper-bench-"));
  const path = join(directory, "synthetic-16mb.bin");
  await writeFile(path, bytes);
  return { ...(await describe(path, false)), real: false };
}
