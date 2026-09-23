# Code review: the ME sub-tree in the UEFI tree

**Scope.** The commit series `4e0b9ca^..289cf52` — moving the ME presentation
to shared code, the one shared ME analysis in the firmware store, grafting the
ME sub-tree into the UEFI Structure tree, statused values, and re-reading the
ME region when the file under it is replaced. Reviewed 2026-09-23.

**Verdict.** Architecturally the series does what
`ME_REGION_IN_UEFI_TREE.md` says it would, and all three overrulings are
documented where they stand. Anchors pass
(`python3 Skills/port-from-byteripper/scripts/check_anchors.py`), the series'
tests are green. Finding #1 — the analysis cache not counting the data files
the worker reads — was real and is **fixed** (2026-09-23), the record below
updated to say how. Finding #2 (the file-table naming policy written twice)
both **fixed** (2026-09-24), #3 recorded as G58 in GAPS.md. Two further
findings from the review run checked out false — they are documented here so
they are not chased again.

## Findings

### 1. The analysis cache does not know about Huffman.dat and FileTable.dat

`firmwareStore.ts` — `analyzePaneMe` keys `meAnalysisCache` on
`(contentGeneration, databaseText)` only, while the worker's `meAnalyze`
consumes `huffmanText` and `fileTableText` as well
(`firmware.worker.ts`, `meAnalyze` case: `parsedDictionaries(request.huffmanText)`,
`parsedFileTable(request.fileTableText)` — both change what the analysis says
about the same bytes: decompressed sizes, checksum marks, FTBL file splitting).

Consequences, both verified against the code:

- **The grafted sub-tree never catches up to the ME panel.** `useMeSubtree`
  asked `analyzePaneMe(pane, databaseText, undefined, undefined)`
  (`meSubtree.ts`) and its effect's dependencies were
  `[wanted, ready, pane, databaseText]` — the two texts were read into
  `fileTableText` a few lines above but never asked with and never re-asked
  for. Scenario: open the ME region from the UEFI panel only; the first,
  dictionary-less analysis is cached. The ME Analyzer panel (whose effect
  includes `huffmanText` and `fileTableText` in its dependencies,
  `meTool.tsx:285`) re-asks when the dictionaries land — and was answered from
  the cache: same generation, same database. It showed `$CPD` modules without
  their decompressed size and marks. Two panels, two readings of the same
  bytes — the opposite of the "one shared analysis" the series exists to build.
- **The grafted sub-tree did not re-read after an in-region edit.** The ME
  tool re-reads because its re-read effect depends on `roots`, which a byte
  edit replaces (`firmwareInvalidate` drops the subtrees the edit made stale
  and hands a fresh array, `firmwareStore.ts`); the sub-tree's analyze effect
  had no content-change signal — `ready` (status) stays `ready` across an
  in-place edit — so the grafted tree held the previous reading while the ME
  panel was fresh. (The original draft of this review blamed the ME panel here;
  the panel was the one that re-read. The sub-tree was the laggard.)

**Fixed (2026-09-23).** The cache key in `analyzePaneMe` now counts all four
worker inputs — `(generation, database, huffman, fileTable)` — so a reading
made before one of the data files landed is not the answer to the question
that now includes it, and the in-flight dedup matches on the same four.
`useMeSubtree` now asks for the complete analysis: it reads the Huffman
dictionary store, loads `Huffman.dat` when the analysis wants it (the same
`huffmanDictionariesWanted` the ME tool uses), passes all four texts, and
depends on the UEFI `roots` — so an in-region edit re-reads it the way the ME
tool does. A `shown` ref guards the digest reset the way the ME tool's does:
adding `roots` to the dependencies makes the effect re-run on every unrelated
branch expansion (the store hands a fresh array for that too), and without the
guard each would throw the digests away and send the Checksums row back to
"Loading…". Covered by three new cases in `meAnalysisCache.test.ts`
(dictionaries land → re-read; table lands → re-read; the same four inputs →
one reading for both panels).

Upstream keeps the analysis on `PaneUEFIState` and any content change is a
reparse that begins with a fresh reading; here the pane-level cache is dropped
on a document replacement (`reloaded` → `forgetMeAnalysis`) and on
`closeFirmware`, and a byte edit is answered by the key missing — an edit bumps
the file's content generation, so the cached answer, keyed on the old one, is
not the answer to the new question.

### 2. "Does this analysis need the file table" is written twice

The `configIDs` memo and the `wantsMFS` / `wantsEFS` / `wantsConfig` guards
were copied verbatim into the two panels:
`src/tools/me/meTool.tsx:372-401` and `src/tools/uefi/meSubtree.ts:272-303`.
Any change to the naming policy — a new record stream contributing config
IDs, a new volume condition — had to be made in both files or the two panels
would have named the same files differently. This is the exact case of the
project rule *code two tools both need moves to shared code*.

**Fixed (2026-09-24).** The policy is the shared `meConfigIDs` and
`meFileNamesAsk` in `src/tools/mfsFileNames.ts`, beside `fileTableWanted`,
which now takes the analysis alone — the IDs it is asked about come out of the
analysis too, which is what makes the question a function of the analysis
alone. The two panels ask the one function and send what it answers. Upstream
spells this in its private `loadFileNames` in each tool, so the shared
declarations are `@web-only` (no single anchor names it). `mfsFileNames.test.ts`
covers the ID gathering from both streams and the ask's selection of the
halves the analysis has.

### 3. `fileNamesPaneMe` has no pane-level cache — G58

`firmwareStore.ts` sends a full worker trip that re-parses FileTable.dat —
the largest of the three databases — once per panel mount, and the panels stay
mounted while parked. The analysis and the digests are each asked once per
pane; the names are asked once per panel. Recorded as G58 in GAPS.md (P3,
open): cache the names beside the analysis, keyed the way the analysis is.
Upstream never re-parses — its `MEReads.fileNames` reads the table from the
data source's in-memory cache, and its private `loadFileNames` re-asks only a
half whose lookup it does not already hold.

## Checked and found not to be

From the same review run, two findings were verified false against the code
and are noted so they are not re-reported:

- **"`meOpening` is stuck when the file under an in-flight region open is
  replaced."** It is not. `openFirmware` sets `status: "parsing"` before the
  read starts (`firmwareStore.ts:350`), so `useMeSubtree(pane, status ===
  "ready")` takes its `!ready` branch, which drops the reading and sets
  `isReading` false (`meSubtree.ts:242-255`); the settle effect
  (`uefiStructureTool.tsx:530-563`) then clears `meOpening` and shuts the row.
  There is no dead end.
- **"The digests cache goes stale when FileTable.dat lands."** It does not.
  `meChecksums` reads the region's bytes through `meRegionBytes()`
  (`firmware.worker.ts:403`) and `meRegion` (`flashDescriptor.ts`) resolves
  the region from the flash descriptor alone — the digests describe the same
  bytes the analysis reads, and the cache is dropped with the document.

## What was checked clean

- `Design/ME_REGION_IN_UEFI_TREE.md` matches what was built, including the
  three overrulings (the subtitle in the detail's heading, per-tool `detailOf`
  / `meDetail`, the ME plumbing in `meSubtree.ts`).
- Stale replies are dropped by job number on both the analysis and the
  checksums asks; a superseded waiter is told *nothing was analysed* rather
  than left hanging.
- A problem (`"no ME region"`) is deliberately uncached, so a pane that gains
  an ME region re-asks rather than being answered with a failure.
