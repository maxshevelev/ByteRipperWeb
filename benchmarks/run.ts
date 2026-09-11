/**
 * `npm run bench`.
 *
 * Each milestone adds its rows here as it lands them, down the budget table in
 * `Design/ANALYSIS.md`. M1 replaced the harness's own slicing loop with the
 * storage that ships: these numbers are `FileBackedStorage` over a real
 * `ChunkCache`, so a regression in either shows up here.
 */

import { applyEdit, scanDiff } from "@/core/diff/diffEngine";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { MatchSetBuilder } from "@/core/search/matchSet";
import { findOne, foldedPattern, scanAll } from "@/core/search/searchEngine";
import { foldingFor, parsePattern } from "@/core/search/searchPattern";
import { ChunkCache } from "@/core/storage/chunkCache";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryByteSource } from "@/core/storage/memoryByteSource";
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

  // What the piece table exists for: an edit costs the same wherever it lands
  // and whatever the file's size. Upstream's previous design rewrote the whole
  // file per typed byte — 25 ms on 8 MB, 87 ms on 32 MB, the same at either end
  // of the file. If that ever comes back, it comes back here first.
  for (const [where, at] of [
    ["near the start", 1024],
    ["near the end", Math.max(0, blob.size - 1024)],
  ] as const) {
    rows.push({
      name: `Type 100 bytes ${where}`,
      note: "One hundred single-byte inserts through the document, undo history and all.",
      measurement: await measure(
        async () => {
          const document = new BinaryDocument(new EditOverlayStorage(fresh()));
          document.beginSeries(1);
          for (let i = 0; i < 100; i++) {
            await document.insert(at + i, new Uint8Array([i & 0xff]));
          }
          document.endSeries();
        },
        { samples: 5 }
      ),
    });
  }

  // M3. The budget in ANALYSIS.md is 150 ms for 16 MB and 600 ms for 64 MB.
  // Two shapes, because they exercise opposite halves of the comparison loop:
  // two reads of the same chip match almost everywhere and the whole-chunk test
  // carries them, while two unrelated dumps differ almost everywhere and every
  // run boundary has to be found.
  const whole = new Uint8Array(await blob.arrayBuffer());
  const storageOf = (of: Uint8Array) =>
    new FileBackedStorage(new MemoryByteSource(of), new ChunkCache({ chunkSize: CHUNK_SIZE }));

  const nearlyIdentical = whole.slice();
  // A rewritten config region, which is what a real pair usually differs by.
  for (let i = 0x40000; i < 0x40400; i++) nearlyIdentical[i] = (nearlyIdentical[i] ?? 0) ^ 0xff;

  const left = storageOf(whole);
  rows.push({
    name: `Full diff, ${(blob.size / 1024 ** 2).toFixed(0)} MB, near-identical`,
    budgetMs: blob.size <= 20 * 1024 ** 2 ? 150 : 600,
    note: "Two reads of the same chip, differing in one 1 KB region.",
    measurement: await measure(
      () => scanDiff(left, storageOf(nearlyIdentical)).then(() => undefined),
      {
        samples: 5,
        bytes: blob.size,
      }
    ),
  });

  const unrelated = whole.map((byte) => byte ^ 0x5a);
  rows.push({
    name: `Full diff, ${(blob.size / 1024 ** 2).toFixed(0)} MB, wholly different`,
    budgetMs: blob.size <= 20 * 1024 ** 2 ? 150 : 600,
    note: "The worst case for run-finding: every byte differs, so nothing can be skipped whole.",
    measurement: await measure(() => scanDiff(left, storageOf(unrelated)).then(() => undefined), {
      samples: 5,
      bytes: blob.size,
    }),
  });

  const bigSize = 64 * 1024 * 1024;
  const bigLeft = new Uint8Array(bigSize);
  for (let at = 0; at < bigSize; at += whole.length) {
    bigLeft.set(whole.subarray(0, Math.min(whole.length, bigSize - at)), at);
  }
  const bigRight = bigLeft.slice();
  for (let i = 0x1000000; i < 0x1000400; i++) bigRight[i] = (bigRight[i] ?? 0) ^ 0xff;
  rows.push({
    name: "Full diff, 64 MB, near-identical",
    budgetMs: 600,
    note: "The larger budget in ANALYSIS.md, against a fixture tiled up to 64 MB.",
    measurement: await measure(
      () => scanDiff(storageOf(bigLeft), storageOf(bigRight)).then(() => undefined),
      { samples: 3, bytes: bigSize }
    ),
  });

  const baseIndex = await scanDiff(left, storageOf(nearlyIdentical));
  const typed = nearlyIdentical.slice();
  rows.push({
    name: "Re-diff after one typed byte",
    note:
      "What incremental invalidation buys: an overwrite rescans its own window, " +
      "not the file. This is the number a full rescan would replace with the row above.",
    measurement: await measure(
      () =>
        applyEdit(
          { kind: "overwrite", start: 0x800000, end: 0x800001 },
          baseIndex,
          left,
          storageOf(typed)
        ).then(() => undefined),
      { samples: 15 }
    ),
  });

  // M5. The budget in ANALYSIS.md is 100 ms to the first hit on 16 MB, and it
  // has to hold for a pattern as common as FF — which is most of an erased
  // flash chip, so the first hit is immediate and the *index* is the work.
  const exact = foldingFor("hex", true);
  const patternOf = (text: string) => {
    const parsed = parsePattern(text, "hex");
    if (!parsed.ok) throw new Error(`the benchmark's own pattern did not parse: ${text}`);
    return parsed.pattern;
  };

  for (const [name, text] of [
    ["a signature", "DEADBEEF"],
    ["one common byte", "FF"],
  ] as const) {
    const pattern = patternOf(text);
    rows.push({
      name: `First hit, ${(blob.size / 1024 ** 2).toFixed(0)} MB, ${name}`,
      budgetMs: 100,
      note: `Scanning from the caret, which is what shows a user their match.`,
      measurement: await measure(
        () =>
          findOne(foldedPattern(pattern.bytes, exact), left, { folding: exact }).then(
            () => undefined
          ),
        { samples: 7 }
      ),
    });
  }

  {
    // The index behind it: every occurrence of a byte that is most of the file.
    const pattern = patternOf("FF");
    rows.push({
      name: "Index every FF, whole file",
      note:
        "The full scan that streams in behind the first hit. Its matches go into a bitmap " +
        "once they pass extent/64, so the count stays exact however common the pattern is.",
      measurement: await measure(
        async () => {
          const builder = new MatchSetBuilder(pattern, exact, blob.size);
          await scanAll(foldedPattern(pattern.bytes, exact), left, {
            folding: exact,
            onMatches: (starts) => builder.add(starts),
          });
          builder.finish();
        },
        { samples: 3, bytes: blob.size }
      ),
    });
  }

  printTable(rows);
  console.log("");
  console.log("Budgets: Design/ANALYSIS.md § Performance budget. A row with no budget is a");
  console.log("baseline to watch, not a promise.");
  console.log("");
  console.log("The frame cost of a repaint and of a scroll is not measurable here — Node has no");
  console.log("canvas, and a software one would measure the shim. Those rows live in a page:");
  console.log("  npm run dev, then open /benchmarks/paint/");

  if (fixture.real && anyOverBudget(rows)) process.exitCode = 1;
}

await main();
