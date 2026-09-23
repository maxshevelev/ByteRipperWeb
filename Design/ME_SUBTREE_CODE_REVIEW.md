# Code review: the ME sub-tree in the UEFI tree

**Scope.** The commit series `4e0b9ca^..289cf52` — moving the ME presentation
to shared code, the one shared ME analysis in the firmware store, grafting the
ME sub-tree into the UEFI Structure tree, statused values, and re-reading the
ME region when the file under it is replaced. Reviewed 2026-09-23.

**Verdict.** Architecturally the series does what
`ME_REGION_IN_UEFI_TREE.md` says it would, and all three overrulings are
documented where they stand. Anchors pass
(`python3 Skills/port-from-byteripper/scripts/check_anchors.py`), the series'
tests are green (79/79 in `meAnalysisCache`, `meSubtree`, `meaTree`,
`uefiNodeDetail`). Two findings below are real, one is a recorded smell, and
two further findings from the review run checked out false — they are
documented here so they are not chased again.

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
  asks `analyzePaneMe(pane, databaseText, undefined, undefined)`
  (`meSubtree.ts:259`) and its effect's dependencies are
  `[wanted, ready, pane, databaseText]` (`meSubtree.ts:270`) — the two texts
  are read into `fileTableText` a few lines above but never asked with and
  never re-asked for. Scenario: open the ME region from the UEFI panel only;
  the first, dictionary-less analysis is cached. The ME Analyzer panel (whose
  effect includes `huffmanText` and `fileTableText` in its dependencies,
  `meTool.tsx:285`) re-asks when the dictionaries land — and is answered from
  the cache: same generation, same database. It shows `$CPD` modules without
  their decompressed size and marks. Two panels, two readings of the same
  bytes — the opposite of the "one shared analysis" the series exists to build.
- **The ME panel also does not catch up after an edit, on its own.** Its
  re-read effect depends on `[roots, status, firmwareProblem, analyze]`
  (`meTool.tsx:286-314`); after a byte edit the tree is re-read in place and
  `roots` is the same array of the same shape while the panel's `analyze`
  callback is stable, so the effect does not re-run and the superseding
  `request.current++` never happens. The panel keeps the previous file
  generation's analysis until the dictionaries or the table arrive — and
  those arrive only *after* an analysis exists (`meTool.tsx:328-334`), so for
  a dump with no MFS/EFS/FTBL the window is open indefinitely: the panel never
  re-reads the region after an edit at all.

Upstream keeps the analysis on `PaneUEFIState` and any content change is a
reparse that begins with a fresh reading; here the pane-level cache is only
dropped on a document replacement (`reloaded` → `forgetMeAnalysis`) and on
`closeFirmware`. Fix direction: key the cache on all four worker inputs — or
drop it on a reparse the way `reloaded` does — and make the ME panel's
re-read effect fire on a content generation it does not already hold.

### 2. "Does this analysis need the file table" is written twice

The `configIDs` memo and the `wantsMFS` / `wantsEFS` / `wantsConfig` guards
are copied verbatim into the two panels:
`src/tools/me/meTool.tsx:372-401` and `src/tools/uefi/meSubtree.ts:272-303`.
Any change to the naming policy — a new record stream contributing config
IDs, a new volume condition — must be made in both files or the two panels
name the same files differently. This is the exact case of the project rule
*code two tools both need moves to shared code*; it belongs beside
`fileTableWanted` in the shared ME presentation code.

### 3. `fileNamesPaneMe` has no pane-level cache — `later —`

`firmwareStore.ts:852` sends a full worker trip that re-parses FileTable.dat —
the largest of the three databases — once per panel mount, and the panels stay
mounted while parked. The analysis and the digests are each asked once per
pane; the names are asked once per panel. Record a `later —` row in GAPS.md:
cache the names beside the analysis, keyed the way the analysis is.

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
