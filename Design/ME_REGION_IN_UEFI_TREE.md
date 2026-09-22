# ME region in the UEFI Structure tree

**Status.** Built (G57, closed 2026-09-22). The sections below are the design as
it was written; three of its decisions were overruled by upstream's own code
when the work was in front of them, and those are listed at the end.

A design for closing G57: bring the ME structure read-out into the UEFI
Structure tree, built by the **same** presentation code the ME Analyzer uses,
rather than re-parsing the ME bytes a second way. The driving ask, verbatim:
*«портировать разбор структуры ME в UEFI дереве общим кодом с ME парсером»*.

## Context

Upstream (`../ByteRipper`, `Design/ME_REGION_IN_UEFI_TREE_PLAN.md`) does exactly
this: it grafts the `MEANode` sub-tree under the ME region node (kind `region`,
subtype `0x02`); on expand it runs the **shared** ME analysis (cached in
`PaneUEFIState.cachedAnalysis`, shared by UEFI Structure *and* the ME
Analyzer); it presents via `MEACurator.present`; the detail renders the ME
`fields`; and mappable nodes publish zones. The rejected alternative — making ME
children into `UEFINode`s — is closed upstream (closed enum, `UEFIImage`→
`MEFirmware` pollution, synchronous materialisation, no `fields`).

Today in this port the two are separate: the ME Analyzer (`src/tools/me/`)
parses the ME region on its own and caches the result in its parked state keyed
by `document.contentGeneration` + database; the UEFI tree
(`src/tools/uefi/uefiStructureTool.tsx`) shows the ME region as a **leaf**
(`regionNode` sets `isExpandable: readsAsRawArea(type)`, and ME is not a raw
area — `descriptorParser.ts:254`). The ME region node is a `WireNode` with
`kind: "region"`, `subtype: FLASH_REGIONS.indexOf("meRegion")` = `2`
(`uefiTypes.ts:173`), `body` = the region's absolute `[start, end)`.

The ME analysis is already built with **absolute file offsets**
(`analyzer.ts`: `offset: baseOffset + partition.offset`, where `baseOffset` is
the region's base from `meRegionBytes()`), and the ME tool reveals
`node.range` straight onto the dump — so a grafted ME node's range needs **no
offset adjustment** to publish zones over the hex view.

Intended outcome: opening the ME region row in UEFI Structure reveals the ME
sub-tree (Firmware, Regions, $CPD, MFS, …), one shared analysis feeding both
panels, with detail and zones working on the grafted rows.

## Design

### 1. Move the shared ME presentation to shared code

The ME presentation is the web port of upstream's `MEPresentation` package and
is now needed by **two** tools, so it moves out of the ME tool's directory
(`src/tools/me/`) into shared code at the `src/tools/` top level — where
ToolModuleKit's shared code already lives (`zone.ts`, `toolRowMarks.ts`,
`toolDetail.ts`). The rule: *code two tools both need moves to shared code*; a
tool must not import another tool. `git mv` each file and rewrite its importers.

Move (top level of `src/tools/`):
- `me/meaTree.ts` → `meaTree.ts` (`presentMEA`, `MEANode`, `MEAField`, `meaZones`,
  `meaNodeAt`, `valueFields`, `manufactureDate`, `MEAChecksums`, `CHECKSUMS_TITLE`,
  `PENDING_VALUE`)
- `me/meaTreeMarks.ts` → `meaTreeMarks.ts` (`MEA_TREE_MARKS`, the `*Marks` builders)
- `me/meaText.ts` → `meaText.ts` (`hex`, `sizeText`, `rangeText`, `familyText`, …)
- `me/mfsFileNames.ts` → `mfsFileNames.ts`
- `me/efsFileNames.ts` → `efsFileNames.ts`
- `me/configRecordPaths.ts` → `configRecordPaths.ts`

The tone type. `MEASummaryTone` (currently in `me/meaSummary.ts`) is really
upstream's `ToolValueTone` (ToolModuleKit), and `meaTree.ts` imports it from
`meaSummary.ts` — a circular edge. Extract it to a new shared leaf
`src/tools/toolValueTone.ts` (`export type ToolValueTone = "standard" | "good" |
"caution" | "bad"`, `@upstream …/ToolValueTone.swift#ToolValueTone`); point both
`meaTree.ts` and `meaSummary.ts` at it.

The ME→detail conversion. `detailOf` (MEANode → `NodeDetail`, `meTool.tsx:198`,
maps `tone === "good"` → `isDone: true`) is what the graft needs and the ME tool
already uses; move it to the shared `meaTree.ts` (it only depends on `MEANode` +
`toolDetail`'s `field`/`EMPTY_DETAIL`). Both tools call the one function.

`me/meaSummary.ts` and `me/meTool.tsx` stay in the ME tool (they are
`Modules/MEATool`); their imports of the moved files become `@/tools/…`.

### 2. One shared ME analysis, cached in the firmware store

Upstream keeps the analysis on the pane (`PaneUEFIState.cachedAnalysis`) so both
panels share it. The web equivalent is the firmware store
(`src/state/firmwareStore.ts`), which already owns `analyzePaneMe`
(`firmwareStore.ts:674`, posts `meAnalyze`). The worker recomputes from scratch
on every `meAnalyze` (`firmware.worker.ts:887`), so the cache belongs on the main
thread, keyed by what the analysis depends on.

Add a module-level cache beside the existing waiters:
`meAnalysisCache: Map<PaneId, { generation: number; database: string | undefined;
response: MeAnalyzeResponse }>`. `analyzePaneMe` first checks it: a hit on
`generation` (=`paneState(pane)?.document?.contentGeneration`, the key the ME
tool already uses) **and** the database text returns the cached response with no
worker round trip; a miss asks the worker and stores the result. A content change
bumps the generation, so the cache invalidates itself; `closeFirmware` clears the
pane's entry. The ME tool's parked-state analysis cache (`meTool.tsx` `Parked.result`
/ `resultFor`) is subsumed — it reads through `analyzePaneMe` and the store cache
becomes the single source of truth (drop the per-session copy rather than keep two).

### 3. Graft the ME sub-tree into the UEFI tree (heterogeneous rows)

In `src/tools/uefi/uefiStructureTool.tsx`:

- **Row becomes a union.** `Row.node: WireNode | MEANode | undefined`
  (`uefiStructureTool.tsx:78`). The `undefined` case (the "Loading…" row) is
  unchanged.
- **Spot the ME region node.** A `WireNode` with `kind === "region"` and
  `subtype === 2`. Add a small `isMeRegion(node)` helper.
- **Expand trigger.** The ME region row shows a twist and is treated as
  expandable even though `node.isExpandable` is false — so `TreeRow`'s
  `hasChildren` (`uefiStructureTool.tsx:1029`) gets `|| isMeRegion(node)`.
  `toggle` on it does **not** call `expandFirmwareNode` (there are no worker
  children); it flips the row open and, on first open, kicks the shared analysis:
  `analyzePaneMe(pane, database, huffman, fileTable)` — the same fetch the ME tool
  does, reading the same lazy stores (`meDatabaseStore`, `huffmanDictionaryStore`,
  `fileTableStore`), which start their fetch on first read. The panel holds the
  result in state (`const [meAnalysis, setMeAnalysis] = …`, the way `meTool.tsx`
  holds `result`); while it is in flight the row shows the existing "Loading…"
  placeholder, and when it lands the sub-tree is presented and spliced in. A
  failed analysis shows the problem in the row's place (or a single "could not
  read the ME region" child), not a blank branch.
- **`rowsOf` splices the sub-tree.** When it reaches an open ME region node it
  recurses into the presented `MEANode[]` (depth + 1) instead of the node's
  (empty) `children`. The ME sub-tree comes from `presentMEA(analysis, checksums,
  names, efsNames, configPaths)` — the name tables default to `.none` initially
  and are filled by the same `fileNamesPaneMe` follow-up the ME tool makes, so a
  grafted FTBL/EFS volume names its files as the ME panel does.
- **`TreeRow` renders both.** For a `WireNode`, the existing Name/Type/Subtype
  row. For a `MEANode`, a ME row: title in the Name column, `subtitle`
  (offset · size) in the Subtype column, marks from `node.marks`, empty-section
  greying from `node.isEmptySection`. Reuse the ME tool's row painting
  (`RowMarksIcons`, `rowPaintAttrs`, `rowMarkTitle` — already shared in
  `ui/toolPanel/RowMarks`).
- **`choose` handles both.** `WireNode` → `askFirmwareDetail` + `uefiZones` (today).
  `MEANode` → detail from the shared `detailOf(node)`, zones from `meaZones(node)`,
  reveal `node.range`. Selection keys stay distinct: the ME sub-tree lives under
  the region node's path, so prefix its keys (e.g. `me/` + the ME `path`) to avoid
  colliding with the UEFI `pathKey`s.

### 4. Detail and zones for the grafted rows

- **Detail.** The UEFI panel's `ToolDetail` already renders `NodeDetail`. For a
  selected ME node it is fed `detailOf(node)` (the shared conversion) instead of
  the worker's `askFirmwareDetail`. No change to `DetailField` is required: the
  ME tree fields only use `standard`/`good`, and `detailOf` maps `good` →
  `isDone` (the green mark `ToolDetail` already draws). (If a future ME field
  needs `caution`/`bad`, add `tone: ToolValueTone` to `DetailField` then — not now.)
- **Zones.** `meaZones(node)` returns the node's absolute range as one focused
  zone; `publishZones(pane, …)` puts it on the dump and the minimap gutter, the
  same call the UEFI rows make. No offset adjustment (the analysis is already
  absolute). Zone→row picking (`zonePicked`) resolves UEFI `nodeIDOfZone` ids
  today; extend it to recognise the grafted ME zone ids and select that row.

### 5. Bookkeeping

- `Design/GAPS.md`: move the G57 row (ME structure in the UEFI tree) to **Closed**.
- `Skills/port-from-byteripper/reference/module-map.json`: the `Packages/MEPresentation`
  module's `files` now point at the new top-level paths (`src/tools/meaTree.ts`,
  `meaTreeMarks.ts`, `meaText.ts`, `mfsFileNames.ts`, `efsFileNames.ts`,
  `configRecordPaths.ts`); the `unported` entries (`MEANode.isExpandable`,
  `MEANode.init`) keep their `Packages/MEPresentation/…` paths. Add `meaText.ts`
  (it was folded into `meaTree.ts`'s mapping) and the new `toolValueTone.ts`
  (→ `Packages/ToolModuleKit/…/ToolValueTone.swift`). Keep the map current in the
  same change.
- Anchors: the moved files keep their `@upstream Packages/MEPresentation/…`
  anchors (paths unchanged — only the web file moved). Run
  `python3 Skills/port-from-byteripper/scripts/check_anchors.py` after.

## Critical files

- `src/tools/me/{meaTree,meaTreeMarks,meaText,mfsFileNames,efsFileNames,configRecordPaths}.ts`
  → move to `src/tools/` top level (git mv + import rewrites).
- `src/tools/toolValueTone.ts` (new, shared leaf).
- `src/tools/me/meaSummary.ts`, `src/tools/me/meTool.tsx` — re-point imports;
  drop the parked-state analysis cache in favour of the store cache.
- `src/state/firmwareStore.ts` — `meAnalysisCache` + cache check in `analyzePaneMe`;
  clear on `closeFirmware`.
- `src/tools/uefi/uefiStructureTool.tsx` — `Row` union, `isMeRegion`, ME expand
  trigger in `toggle`, ME splice in `rowsOf`, ME branch in `TreeRow`, ME branch in
  `choose`, ME zone ids in `zonePicked`.
- `src/ui/toolPanel/ToolDetail.tsx` — no change (renders `detailOf`'s output).
- `Design/GAPS.md`, `Skills/port-from-byteripper/reference/module-map.json`.

## Verification

- `npm run check` (typecheck + lint + `vitest run`). New/updated unit tests:
  - a pure test that `presentMEA` output spliced under a synthetic ME region
    `WireNode` yields the expected heterogeneous row list (reuse the region-node
    fixture pattern in `src/firmware/uefi/topLevelParse.test.ts`);
  - the store-cache test: a second `analyzePaneMe` at the same generation +
    database does not re-post `meAnalyze` (assert via a fake worker / spy on
    `send`), and a generation bump forces a re-ask.
- End-to-end in the browser (`npm run dev`): open an IFWI with an ME region;
  UEFI Structure → expand the ME region row → the ME sub-tree appears (Firmware,
  Regions, $CPD, MFS, …); select a ME row → its fields show in the detail and its
  range is outlined on the dump; open the ME Analyzer on the same pane → the same
  analysis is reused (no second parse), and an edit to the file invalidates both.
- `python3 Skills/port-from-byteripper/scripts/check_anchors.py` exits 0.

## What was built differently, and why

Three of the decisions above were overruled by upstream's own code, which is the
master (`CLAUDE.md`). Each is written as it now stands.

1. **The subtitle is not a column.** §3 put the ME row's `subtitle` (offset ·
   size) in the Subtype column. Upstream deliberately does not: the two columns
   beside the name are a UEFI node's kind and subtype, which an ME row is
   neither, and a hex range squeezed into 69 points reads as nothing
   (`UEFIToolViewController.text` returns the title for Name and `""` for both
   others). The subtitle lands in the **detail's heading** instead, and only for
   a row with no fields of its own — `UEFIToolSession.meDetailTitle`, ported as
   `meDetailTitle`. That is where "Regions (FPT) · 11 regions" is read.

2. **`detailOf` is not shared.** §1 moved the ME → `NodeDetail` conversion into
   `meaTree.ts` for both panels. Upstream's §5 decision 2 closed the other way —
   per-tool rendering over a shared model — and the two really do differ: the ME
   Analyzer's detail is titled `node.title` and falls back to "Nothing more to
   show for this row.", the UEFI Structure's is titled `meDetailTitle(node)`.
   So `meDetail` lives in `src/tools/uefi/meSubtree.ts` and the ME panel keeps
   its own `detailOf`.

3. **The ME plumbing is one module, not one panel.** §3 put the row union, the
   expand trigger, the splice and the branches straight into
   `uefiStructureTool.tsx`. Everything about *getting* the sub-tree — the shared
   analysis, the file names, the digests, the graft point, the row keys, the
   detail, the row that owns a byte — is in `src/tools/uefi/meSubtree.ts`
   instead, which is upstream's `// MARK: - The ME sub-tree` section of
   `UEFIToolModule` with a file of its own. The panel keeps what a panel does:
   the rows, the selection and the drawing.

And two things §2 and §4 left open, decided in the building:

- **`UEFIDetailField.tone` stayed unported**, as §4 allowed: the ME tree's
  fields carry only `standard` and `good`, and `good` is the detail's own
  `isDone`. The map records it as `later` with that reason, so the day an ME
  field needs `caution` or `bad` the entry is the ticket.
- **The digests are cached beside the analysis**, not inside it: upstream writes
  `checksums` into the cached `FirmwareAnalysis`, and here they are an argument
  to `presentMEA` rather than a field of the model, so `checksumPaneMe` caches
  them in the store by the same key. Both panels are answered from one reading
  either way.
