/**
 * `npm run bench`.
 *
 * M0 measures chunked reads and nothing else, because chunked reads are all
 * that exists. Each milestone adds its rows here as it lands them: M1 the real
 * `ChunkCache`, M2 a repaint, M3 a diff, and so on down the budget table in
 * `Design/ANALYSIS.md`.
 */

import { resolveFixture } from "./fixture.ts";
import { anyOverBudget, measure, printTable, type Row } from "./harness.ts";

/** Upstream's `ChunkCache` defaults, which M1 ports as they stand. */
const CHUNK_SIZE = 64 * 1024;

/**
 * Roughly what a first screen costs: the chunks covering the rows a pane shows
 * plus the read-ahead window around them. A pane is some tens of rows at 16
 * bytes each, so this is one chunk of content and its neighbours.
 */
const FIRST_SCREEN_CHUNKS = 3;

async function readChunk(blob: Blob, index: number): Promise<number> {
  const start = index * CHUNK_SIZE;
  const slice = blob.slice(start, Math.min(start + CHUNK_SIZE, blob.size));
  return (await slice.arrayBuffer()).byteLength;
}

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

  rows.push({
    name: "Open to first screen",
    budgetMs: 100,
    note:
      `${FIRST_SCREEN_CHUNKS} × ${CHUNK_SIZE / 1024} KB read from a cold offset. ` +
      "The budget in ANALYSIS.md is to the first *painted* row; the painting half " +
      "arrives in M2 and its cost is not in this number yet.",
    measurement: await measure(
      async () => {
        const base = Math.floor(Math.random() * Math.max(1, chunkCount - FIRST_SCREEN_CHUNKS));
        for (let i = 0; i < FIRST_SCREEN_CHUNKS; i++) await readChunk(blob, base + i);
      },
      { samples: 15 }
    ),
  });

  rows.push({
    name: `Sequential read, whole file, ${CHUNK_SIZE / 1024} KB chunks`,
    note: "What a full-file pass — a diff, a search, a minimap build — pays just to see the bytes.",
    measurement: await measure(
      async () => {
        for (let index = 0; index < chunkCount; index++) await readChunk(blob, index);
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
        for (const index of scatter) await readChunk(blob, index);
      },
      { samples: 7, bytes: scatter.length * CHUNK_SIZE }
    ),
  });

  printTable(rows);
  console.log("");
  console.log("Budgets: Design/ANALYSIS.md § Performance budget. A row with no budget is a");
  console.log("baseline to watch, not a promise.");

  if (fixture.real && anyOverBudget(rows)) process.exitCode = 1;
}

await main();
