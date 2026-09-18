# ByteRipperWeb — Implementation Plan

Step-by-step plan to build the browser edition of
[ByteRipper](https://github.com/maxshevelev/ByteRipper), described in
[`ANALYSIS.md`](ANALYSIS.md). Every milestone ends with a testable definition of
done, and the file paths here are the ones
`Skills/port-from-byteripper/reference/module-map.json` already maps upstream
Swift onto — keep the two in step.

**Read first, in this order:** `CLAUDE.md` (the rules), `ANALYSIS.md` (what is in
scope and what the browser forbids), then this file (how it gets built).

**The reference implementation is a sibling clone.** The macOS app lives at
`../ByteRipper` (or `$BYTERIPPER_REPO`) — ~103k lines of Swift that already
answer most design questions this project will run into. Read the Swift before
inventing a mechanism; its `Design/` directory records why each feature came out
the way it did, and its unit tests are the cheapest verification that a port is
faithful.

---

## 1. Target architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ View (React 19, main thread)                                        │
│   App shell · Toolbar · Command palette · Pane chrome · Dialogs ·   │
│   Tool panel · Search bar & results · Settings · Status bar         │
├────────────────────────────────────────────────────────────────────┤
│ Render (imperative canvas, no React)                                │
│   HexGridRenderer (glyph atlas, dirty regions) · MinimapRenderer    │
├────────────────────────────────────────────────────────────────────┤
│ State (stores bridging workers and React)                           │
│   WorkspaceStore · PaneStore · DiffStore · SearchStore ·            │
│   ToolStore — plain objects + useSyncExternalStore                  │
├────────────────────────────────────────────────────────────────────┤
│ Workers (cancellable, progress-reporting)                           │
│   diff · search · minimap · firmware                                │
├────────────────────────────────────────────────────────────────────┤
│ Domain (pure TS, no DOM: src/core, src/firmware)                    │
│   storage · document · diff · search · segments · bookmarks · undo  │
│   uefi · fit · me                                                   │
├────────────────────────────────────────────────────────────────────┤
│ Platform (the only browser-API surface)                             │
│   src/platform/files · dragDrop · clipboard · persistence · net     │
└────────────────────────────────────────────────────────────────────┘
```

Rules the layering exists to enforce:

- `src/core/` and `src/firmware/` import nothing from `src/ui/`, `src/render/`,
  `src/platform/`, or the DOM. They are the half that is unit-tested headlessly
  and the half that ports from Swift.
- Every browser API is reached through `src/platform/`, behind an interface with
  a test double. Nothing else calls `showOpenFilePicker`, `caches`, `fetch`,
  `indexedDB` or `navigator.clipboard` directly. This is what keeps the
  Chromium/Firefox/Safari differences in one place instead of scattered through
  features.
- Anything that walks the whole file runs in a worker, reports progress, and is
  cancellable.

---

## 2. Key technical decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **TypeScript, `strict` everywhere**, one package, no monorepo tooling. Layer boundaries enforced by an ESLint `no-restricted-imports` rule, not by convention. | The Swift side gets this from package boundaries; in TS a lint rule is the equivalent that actually fails a build. A monorepo would be ceremony for one deliverable. |
| D2 | **Vite + React 19**, hex grid on a `<canvas>`. React never renders a byte. | Confirmed with the user. The framework's job is desktop chrome — trees, splitters, dialogs — and it is off the hot path entirely. |
| D3 | **Offsets are `number`, not `bigint`.** | `Number.MAX_SAFE_INTEGER` is 9 PB; a flash dump is at most gigabytes. `bigint` arithmetic is several times slower and infects every signature. Document the limit and assert it once when a file is opened. |
| D4 | **Storage: chunked reads over `Blob.slice()` through a bounded LRU cache, plus a piece table for edits.** | Ports `ChunkCache` and `PieceTable` from `ByteRipperCore` nearly unchanged. Reads are `async` here (a `Blob` slice is a promise), unlike the Swift side where they are synchronous — see M1 for what that costs the renderer. |
| D5 | **Workers speak a small typed request/response protocol written by hand**, with `ArrayBuffer` transfers. No RPC library. | The protocol is ~100 lines and the shape of cancellation and progress is exactly what this app needs. A dependency would hide the part worth controlling. |
| D6 | **The hex grid draws through a glyph atlas and repaints dirty regions only.** | `fillText` costs ~2–5 µs; a screen is ~1600 cells, which is most of a frame budget. Pre-rendered glyph tiles blitted with `drawImage` are 5–10× cheaper. Decided before the first line of the renderer because retrofitting it means rewriting it. |
| D7 | **File access behind `FileSource` / `FileSink` interfaces** with two implementations each: File System Access (Chromium) and `File` + download (elsewhere). Capability is detected once and exposed to the UI. | The difference between *Save* and *Download a copy* is a fact about the browser the user must see; everything else in the app stays ignorant of it. |
| D8 | **State in hand-written stores consumed through `useSyncExternalStore`.** No state library. | State lives outside the React tree anyway — workers and an imperative renderer own most of it. A store is ~40 lines; a library would be a dependency for less. |
| D9 | **Vitest for `core`/`firmware`, Playwright for flows.** Upstream's Swift unit tests are ported *with* the code they cover. | A ported parser with upstream's own cases behind it is a ported parser that can be trusted. The Swift tests are the specification. |
| D10 | **Third-party databases: fetched live from GitHub, re-checked by `Freshened`'s rules and kept in the Cache API**, behind the same source interfaces the desktop uses, and **a fetch anyone is waiting on is visible with a cancel**. | Freshness with no manual updating, as upstream chose — plus the offline case the desktop lacks. Bodies carry their fetch date and the UI shows it. Visibility is the desktop's own lesson: a reported "random pause" before ME Analyzer turned out to be a silent 350 KB download of `MEA.dat` mid-analysis, which is why it must never be silent here. See `ANALYSIS.md` § Third-party data. |
| D11 | **One workspace per browser tab.** No in-app tabs, no window management. Dragging a pane by its header is ported, but stops at the window's edge: a pane cannot be reparented into another tab, and the New Tab strip is left out by the owner's decision. **A part of a file is not a tab:** a zone, a decompressed body or a node opens in a panel over the file it came out of, folded into a pill in a dock along the bottom edge — upstream's answer to where a part goes when there is no tab to open it into (`Design/FRAGMENT_PANELS_PLAN.md` there, G4 and G47–G51 in `GAPS.md` here). | Confirmed with the user, and amended when pane dragging was ported (GAPS §3): the browser refuses the tab and window commands, so `Cmd+T` / `Cmd+N` / `Cmd+W` stay the browser's. |
| D12 | **A command palette (`Cmd/Ctrl+K`) replaces the menu bar**, with a toolbar for the handful of commands worth a permanent button. | A web page has no menu bar, and this app has more commands than a toolbar can hold honestly. |
| D13 | **Ranges are half-open `[start, end)` internally**, inclusive ends converted at dialog edges only. | Same rule as upstream; the bugs it prevents are the same bugs. |
| D14 | **A benchmark harness exists from M0** and runs against a real 16 MB dump kept out of git. | The performance argument for plain TypeScript is only honest if it is measured. Regressions should fail a number, not a feeling. |

---

## 3. Milestones and ordering

```
M0 Scaffolding & benchmarks
   └─▶ M1 Storage & document ─▶ M2 Hex grid (read-only, one file)
                                   └─▶ M3 Comparison
                                         └─▶ M4 Editing & saving
                                               ├─▶ M5 Search
                                               ├─▶ M6 Minimap
                                               └─▶ M7 Bookmarks & segments
                                                     └─▶ M8 Tool panel & UEFI
                                                           ├─▶ M9 FIT
                                                           └─▶ M10 ME Analyzer
                                                                 └─▶ M11 Settings & pattern library
                                                                       └─▶ M12 Hardening
```

M5, M6 and M7 are independent of each other and can be reordered freely. M9 and
M10 both need M8's tree and nothing of each other.

---

## 4. Milestone 0 — Scaffolding and the benchmark harness

**Goal:** an empty app that builds, tests, lints and benchmarks.

1. `npm create vite@latest` — React + TypeScript. Node 20+.
2. `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`. Path alias `@/` → `src/`.
3. Biome for formatting and linting (one dev dependency rather than the
   ESLint+Prettier pair), plus the layer rule from D1: `src/core` and
   `src/firmware` may not import `src/ui`, `src/render`, `src/platform`, or DOM
   globals.
4. Vitest wired; one trivial test proves the runner.
5. Directory skeleton, empty but present, matching D1 and the module map:
   `src/core/{storage,document,diff,search,segments,bookmarks,edit,text}`,
   `src/firmware/{uefi,me}`, `src/workers`, `src/render`, `src/state`,
   `src/platform`, `src/ui`, `src/tools`, `tests/e2e`, `benchmarks`.
6. App shell: header, empty state ("Open a file, or drop one here").
   Light and dark from `prefers-color-scheme`.
7. **Benchmark harness** (`npm run bench`): loads a dump from
   `benchmarks/fixtures/` (gitignored), times the operations in `ANALYSIS.md`'s
   budget table, prints a table of measured vs budget. At M0 it measures only
   chunked reads; each later milestone adds its own rows.
8. GitHub Actions: typecheck, lint, unit tests on push. Deployment to Pages
   comes later — there is nothing to deploy yet.

**Definition of done:** `npm run check` (types + lint + tests) is green; the
empty shell renders in both themes; `npm run bench` runs and prints a table.

---

## 5. Milestone 1 — Storage and document (pure TS, test-first)

Ports `Packages/ByteRipperCore` storage and document files. Read the Swift
first; the piece-table design in particular is documented in
`../ByteRipper/Design/PIECE_TABLE_PLAN.md`.

1. `src/core/storage/byteStorage.ts` — the interface: `size`,
   `read(at, length): Promise<Uint8Array>`, clamped at EOF.
2. `src/core/storage/chunkCache.ts` — bounded LRU by chunk index, byte budget,
   eviction. Keyed by chunk index *only*, so one cache can never serve two
   files (a bug upstream already found and recorded).
3. `src/core/storage/fileBackedStorage.ts` — over a `Blob`/`File`, reads through
   the cache.
4. `src/core/storage/memoryBackedStorage.ts` — for new documents and tests.
5. `src/core/storage/pieceTable.ts` + `editOverlayStorage.ts` — edits as a piece
   list over the base; overwrite, insert, delete, append.
6. `src/core/document/binaryDocument.ts` — the document: storage, dirty state,
   length, the edit operations, and the events the UI listens to.
7. `src/core/document/selectionModel.ts`, `src/core/text/offsetParser.ts`
   (`0x` hex or decimal, validating), `src/core/text/byteDecoder.ts`
   (Windows-1252 and friends, table-driven).
8. `src/core/edit/undoHistory.ts` — op stack with the typed-run grouping rule.
9. Tests ported from `Packages/ByteRipperCore/Tests`.

**Async reads are the one real divergence from Swift** and they land here: a
`Blob` slice is a promise, so the renderer cannot pull bytes synchronously
during paint. The answer is a read-ahead window — the rows around the viewport
are resident before they are needed, and a miss paints a placeholder row and
repaints when the chunk lands. Design it now; M2 depends on it.

**Definition of done:** storage tests green; a 1 GB `File` can be opened and
read at arbitrary offsets with a bounded working set; edits read back correctly;
`npm run bench` reports chunked-read throughput.

---

## 6. Milestone 2 — Hex grid, read-only, one file

1. `src/render/hexGrid/glyphAtlas.ts` — pre-render 256 hex pairs and the
   printable ASCII set per font, size, theme and `devicePixelRatio`; rebuilt
   when any of those change.
2. `src/render/hexGrid/hexGridRenderer.ts` — 16 bytes per row in two 8-byte
   groups; address, hex and decoded-text columns; pinned header; muted
   `0x00`/`0xFF`; hatching past EOF; dirty-region repaint; scroll by blit.
3. `src/ui/pane/` — the pane: canvas host, scrollbar, header with the file name,
   and the empty state.
4. Keyboard: arrows, Home/End, PageUp/PageDown, `Cmd/Ctrl+L` go-to,
   `Cmd/Ctrl+A`. Modifier normalisation (Cmd on macOS, Ctrl elsewhere) lives in
   one place.
5. Mouse selection, including drag beyond the viewport edge.
6. `src/platform/files/` — `FileSource` with both implementations (D7),
   capability detection, drag-and-drop of a file onto the window
   (`getAsFileSystemHandle()` where available).
7. Word size 1/2/4/8 regrouping.

**Definition of done:** a 16 MB dump opens and scrolls at 60 fps; the benchmark
reports the frame cost of a repaint and of a scroll; selection and keyboard
navigation match the desktop's behaviour; nothing in `src/render` imports React.

---

## 7. Milestone 3 — Comparison

1. `src/core/diff/{diffEngine,diffBlock,diffHunkIndex}.ts` — ported, with the
   `Uint32Array` comparison loop as the hot path.
2. `src/workers/diff.worker.ts` — full-file scan, incremental invalidation,
   progress, cancellation.
3. Second pane; side-by-side and stacked layouts; swap.
4. Orange difference fill, including the shorter file's EOF tail.
5. Difference and same-block navigation with the grouping distance.
6. Selection in one pane outlined in the other.
7. Status bar: the live `12 differing · 2048 same` summary.

**Definition of done:** two 16 MB dumps diff within the budget in
`ANALYSIS.md`; navigation steps by change, not by byte; the summary updates as
edits arrive; benchmark rows for 16 MB and 64 MB.

---

## 8. Milestone 4 — Editing and saving

1. Hex typing and text-column typing, overwrite mode; modified bytes red until
   saved.
2. Insert mode, with the tail shift and the per-pane `OVR`/`INS` state.
3. Undo/redo with segmented typed runs.
4. Fill Selection, Delete Bytes, Paste Insert; confirmations for the operations
   that shift the file, with the preference to turn them off.
5. `src/platform/files/fileSink.ts` — save in place (Chromium) and download a
   copy (elsewhere); the UI names the one it is offering.
6. New empty document; Revert to Saved; Duplicate into the other pane.
7. Clipboard: hex text everywhere, raw bytes as a custom type where supported.

**Definition of done:** a patch typed into a dump saves back to the same file in
Chromium and downloads in Firefox and Safari; undo returns the document to the
saved state and clears dirty; no operation blocks the frame on a 64 MB file.

---

## 9. Milestone 5 — Search

1. `src/core/search/{searchEngine,smartSearch}.ts` and
   `src/workers/search.worker.ts`: first match from the caret immediately, full
   index streaming behind it, cancellable.
2. Encodings: hex bytes, ASCII, UTF-8, UTF-16 LE and BE; case toggle; Smart
   Search order.
3. Find bar with query history; every occurrence greyed, the current one raised;
   exact `3 of 128`; wrap-around notice.
4. Search Results panel with offsets, hex excerpt and decoded text, read from
   live bytes; refusal past 1000 matches.

**Definition of done:** first hit on a 16 MB dump inside the budget even for a
pattern as common as `FF`; the count is exact; results follow later edits.

---

## 10. Milestone 6 — Minimap

1. `src/render/minimap/` — Local (one cell per byte around the caret) and
   Overview (whole file, shaded by content density) modes.
2. `src/workers/minimap.worker.ts` — the density pass, cached per file version,
   its progress bar shown in the panel's own header, rescale-in-hand on resize.
3. Differences, edits and search matches drawn over the shading, at least two
   device pixels tall.
4. Two maps mirroring the panes on one shared scale; drag the viewport marker,
   click to jump, wheel to scroll.

**Definition of done:** an overview of a 16 MB dump builds within budget without
dropping frames; a single changed byte among millions is visible; the same
height is the same offset in both maps.

---

## 11. Milestone 7 — Bookmarks and segments

1. `src/core/bookmarks/` — absolute offsets, one per row, named or described by
   the bytes at them; persisted per workspace in IndexedDB.
2. Go To Position as the bookmark list too, with the last ten addresses.
3. Marks in the offset column and in both minimap modes; drag a mark to another
   row; hover and click behaviour.
4. `src/core/segments/` — the partition: contiguous pieces, `S0`/`S1`/…, names,
   tints on rows and beside the minimap.
5. Split Here, Add Cut, Merge; cuts travel with content and are undoable.
6. Segments dialog; Save Segment; Save All as Separate Files (directory picker
   in Chromium, ZIP download elsewhere); Replace Segment from File.
7. Append File / Insert File at Start, the seam becoming a cut; the join
   detaches the pane from its file; drop bands at the top and bottom of a pane.

**Definition of done:** a joined image splits back at exactly the seam it was
joined at; a cut survives an insertion before it; bookmarks survive closing and
reopening a dump within the session.

---

## 12. Milestone 8 — Tool panel and UEFI Structure

1. `src/tools/` — the tool-module contract: a tool is bound to one pane, says
   which in its header, writes only through the document's undo stack, and can
   ask the pane to reveal a range and draw its extent in the minimap margin.
2. `src/tools/registry.ts`, `src/ui/toolPanel/` — panel chrome, one tool at a
   time, a virtualised tree.
3. `src/firmware/uefi/` — the port of `Packages/UEFIImage` (10.4k lines):
   descriptor and regions, volumes, FFS files, sections, NVRAM stores and
   variables, microcode, padding, free space. **Lazy**: the top level is parsed
   on open, a branch when it is opened, and one tree serves all three tools.
4. `src/workers/firmware.worker.ts` — parsing off the main thread;
   `src/firmware/contentSource.ts` bridges the document's bytes to the parser.
5. Checksums verified as the tree builds; Fix Checksum as one undoable edit.
6. CPU-visible addresses anchored at the reset vector.
7. The GUID catalogue from `LongSoft/UEFITool`, behind the cached source (D10).
8. Tests ported from `Packages/UEFIImage/Tests`.

**Definition of done:** a 32 MB image's top level parses within budget; a branch
opens on demand; upstream's parser tests pass; a wrong checksum is flagged on
the node that carries it and fixing it is one `Cmd/Ctrl+Z` away.

---

## 13. Milestone 9 — FIT Table

1. `src/tools/fit/` — the port of `Modules/FITTool` (7.2k lines): entries with
   type, version, size, checksum, and what they point at, named from the tree.
2. Microcode Add, Replace and Remove, rewriting the entry count and header
   checksum, all as a single undo.
3. The microcode catalogue from `platomav/CPUMicrocodes` behind the cached
   source (D10) — this one uses `api.github.com`, whose 60-per-hour limit is
   shared by everyone behind a shop's NAT, so the `rateLimited` state must be a
   real, readable state and not a silent empty list.

**Definition of done:** the table reads as things rather than addresses;
replacing a microcode is one undo; the catalogue's rate-limited and offline
states are visible and accurate.

---

## 14. Milestone 10 — ME Analyzer

1. `src/firmware/me/` — the port of `Packages/MEFirmware` (17.4k lines):
   family, version, SKU, chipset, stepping, dates, and whether the image is
   stock, an update, or extracted. Stitched firmware analysed in its own right.
2. The two compute-bound pieces, kept behind a narrow interface so a WASM
   replacement stays a local change: `Crypto/RSA.swift` (2048-bit modpow —
   use native `BigInt`) and `Decompress/Huffman.swift` (CSE Huffman).
3. Health rows as plain Yes/No or coloured words: RSA signature, partition
   tables, EFS and its page bookkeeping, MFS dictionary, filesystem state.
4. Full Tree; Copy as rich text; Screenshot as a picture.
5. `MEA.dat` and `Huffman.dat` behind the cached source (D10), with their date
   shown in the panel header.
6. Tests ported from `Packages/MEFirmware/Tests`, including `RSATests` and
   `HuffmanTests`.

**Definition of done:** upstream's ME tests pass; a real image analyses within
the 2 s budget in a worker with progress; if it does not, the measurement — not
an opinion — decides whether WASM enters the project.

---

## 15. Milestone 11 — Settings and the pattern library

1. Settings: monospaced font, size, row density, theme (system / light / dark),
   diff grouping distance, decoding table with the live 256-value grid.
   Persisted in IndexedDB. No Zoom In / Zoom Out: the browser's page zoom is
   the zoom (ANALYSIS.md), so the size is a setting and nothing more.
2. Favourites and recent queries; a favourite is a recent with a name.
3. Library sync: in Chromium, `showDirectoryPicker()` plus a handle kept in
   IndexedDB gives upstream's one-file-per-machine merge model — ported from
   `PatternLibrary.swift`, `SyncMerge.swift` and `VersionVector.swift`, conflict
   sheet included — in the Mac app's own file format and folder, so the two
   share one library. Firefox and Safari fetch from a folder read-only; export
   and import everywhere. Stages and decisions: `Design/FAVORITES_SYNC_WEB.md`.

**Definition of done:** twelve patterns on one machine and three on another make
fifteen; a conflict is asked about rather than resolved silently; the library
file is readable JSON.

---

## 16. Milestone 12 — Hardening

1. The full benchmark table against the budget, on a low-end machine as well as
   a fast one.
2. Cross-browser pass: Chromium, Firefox, Safari — every place where the
   capability differs must say so in the interface.
3. Error and empty states end to end: offline with no cached database, a stale
   `File` handle, a file that changed on disk, a permission the user declined.
4. Accessibility: keyboard reachability for every command, the canvas's
   accessible description of the caret position and document state, contrast in
   both themes, state carried by form as well as colour.
5. Playwright flows for the paths a bench actually walks: open two dumps, find a
   difference, patch it, save; open an image, read its UEFI tree, fix a
   checksum; analyse an ME region offline.
6. Deploy to GitHub Pages from CI.

**Definition of done:** every budget met or consciously renegotiated in writing;
no capability difference discovered by a user rather than announced by the app.

---

## 17. Build and run

```bash
npm install
npm run dev        # Vite dev server
npm run check      # types + lint + unit tests
npm run bench      # performance table against benchmarks/fixtures/
npm run build      # production bundle
```

Benchmark fixtures are real firmware dumps and are gitignored. Put at least one
16 MB dump in `benchmarks/fixtures/` before trusting a number.

---

## 18. Staying level with ByteRipper

The macOS app keeps moving. Before starting a milestone that ports a module,
and after finishing one:

```bash
python3 Skills/port-from-byteripper/scripts/port_report.py
```

It reports what changed upstream since the commit in `PORT_STATE.json`, mapped
onto this repository. Update `reference/module-map.json` as modules move from
`planned` to `ported` — a stale map makes every future run lie. Full procedure
in `Skills/port-from-byteripper/SKILL.md`.

---

## 19. Open questions

- **Session restore.** Handles kept in IndexedDB would let a reload offer
  yesterday's pair back with one permission click. Wanted, not before M4.
- **Hosting.** GitHub Pages from CI is the default; a shop's own server changes
  nothing architecturally.
- **Telemetry.** None, and the README says so.
- **WASM.** Not in the project, and now settled rather than deferred. M10's
  measurement was the condition, and it has been taken: a 16 MB region analyses
  in ~22 ms against a 2 s budget, and the three real manifests — one 2048-bit
  PKCS #1 and two 3072-bit PSS over SHA-384 — check in 3.3 ms between them. The
  modular exponentiation the budget was written around costs about a
  millisecond, because the language has a `bigint` and upstream's Swift did not.
  Both rows are in `npm run bench`. WASM does not enter.
