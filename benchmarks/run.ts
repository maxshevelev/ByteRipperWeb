/**
 * `npm run bench`.
 *
 * Each milestone adds its rows here as it lands them, down the budget table in
 * `Design/ANALYSIS.md`. M1 replaced the harness's own slicing loop with the
 * storage that ships: these numbers are `FileBackedStorage` over a real
 * `ChunkCache`, so a regression in either shows up here.
 */

import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { resolveFixture } from "./fixture.ts";
import { anyOverBudget, measure, printTable, type Row } from "./harness.ts";

/** Upstream's `ChunkCache` defaults, ported as they stand. */
const CHUNK_SIZE = 64 * 1024;
const BYTE_BUDGET = 32 * 1024 * 1024;

/**
 * Roughly what a first screen costs: the chunks covering the rows a pane shows
 * plus the read-ahead window around them. A pane is some tens of rows at 16
 * bytes each, so this is one chunk of content and its neighbours.
 */
const FIRST_SCREEN_CHUNKS = 3;

async function main(): Promise<void> {
  const fixture = await resolveFixture();
  const blob = await fixture.blob();
  const chunkCount = Math.ceil(blob.size / CHUNK_SIZE);

  console.log(`ByteRipperWeb benchmarks`);
  console.log(
    `fixture: ${fixture.name} — ${(fixture.size / 1024 ** 2).toFixed(1)} MB` +
      (fixture.real ? "" : "  ⚠ SYNTHETIC")
  );
  if (!fixture.real) {
    console.log(
      "  These numbers are not evidence. Put a real 16 MB dump in benchmarks/fixtures/\n" +
        "  (gitignored) or point $BENCH_FIXTURE at one, then measure again."
    );
  }
  console.log("");

  const rows: Row[] = [];

  // The storage that ships, with upstream's own defaults. A fresh one per row
  // where a cold cache is the point, and a shared one where reuse is.
  const fresh = () =>
    new FileBackedStorage(blob, new ChunkCache({ chunkSize: CHUNK_SIZE, byteBudget: BYTE_BUDGET }));

  rows.push({
    name: "Open to first screen",
    budgetMs: 100,
    note:
      `${FIRST_SCREEN_CHUNKS} × ${CHUNK_SIZE / 1024} KB made resident through a cold cache, ` +
      "which is what a pane prefetches before it paints. The budget in ANALYSIS.md is to " +
      "the first *painted* row; the painting half arrives in M2 and is not in this number.",
    measurement: await measure(
      async () => {
        const storage = fresh();
        const base = Math.floor(Math.random() * Math.max(1, chunkCount - FIRST_SCREEN_CHUNKS));
        await storage.prefetch(base * CHUNK_SIZE, FIRST_SCREEN_CHUNKS * CHUNK_SIZE);
      },
      { samples: 15 }
    ),
  });

  rows.push({
    name: `Sequential read, whole file, ${CHUNK_SIZE / 1024} KB chunks`,
    note: "What a full-file pass — a diff, a search, a minimap build — pays just to see the bytes.",
    measurement: await measure(
      async () => {
        const storage = fresh();
        for (let at = 0; at < blob.size; at += CHUNK_SIZE) {
          await storage.read(at, Math.min(CHUNK_SIZE, blob.size - at));
        }
      },
      { samples: 5, bytes: blob.size }
    ),
  });

  const scatter = Array.from({ length: 64 }, (_, i) => (i * 2654435761) % Math.max(1, chunkCount));
  rows.push({
    name: "Scattered reads, 64 chunks",
    note: "Scrolling around a dump, or a cache that keeps missing. 64 × 64 KB = 4 MB.",
    measurement: await measure(
      async () => {
        const storage = fresh();
        for (const index of scatter) await storage.read(index * CHUNK_SIZE, CHUNK_SIZE);
      },
      { samples: 7, bytes: scatter.length * CHUNK_SIZE }
    ),
  });

  const warm = fresh();
  await warm.prefetch(0, Math.min(BYTE_BUDGET, blob.size));
  rows.push({
    name: "Cached read, 4 KB, cache hit",
    note:
      "A repaint reading rows it already has. This is the path M2's renderer sits on, so " +
      "it has to be far below the 8 ms frame budget on its own.",
    measurement: await measure(
      async () => {
        for (let i = 0; i < 256; i++) await warm.read((i * 4096) % (BYTE_BUDGET / 2), 4096);
      },
      { samples: 7, bytes: 256 * 4096 }
    ),
  });

  rows.push({
    name: "Peek, 4 KB, resident",
    note:
      "The synchronous path a canvas repaint uses: no await, no promise, straight out of the " +
      "chunk cache. 256 peeks per sample.",
    measurement: await measure(
      () => {
        for (let i = 0; i < 256; i++) warm.peek((i * 4096) % (BYTE_BUDGET / 2), 4096);
      },
      { samples: 15, bytes: 256 * 4096 }
    ),
  });

  printTable(rows);
  console.log("");
  console.log("Budgets: Design/ANALYSIS.md § Performance budget. A row with no budget is a");
  console.log("baseline to watch, not a promise.");

  if (fixture.real && anyOverBudget(rows)) process.exitCode = 1;
}

await main();
