# ByteRipperWeb — analysis and plan

ByteRipperWeb brings [ByteRipper](https://github.com/maxshevelev/ByteRipper) —
a macOS hex editor and firmware-dump comparator — into the browser, so that any
bench in a repair shop can open two dumps and answer *is this chip's content the
same as the one that works?* without installing anything, on whatever operating
system happens to be on that workbench.

This document records what the web edition will do, how, and what the browser
takes away from us. It is the document to argue with before code is written.

## The point of the exercise

The macOS app is ~103k lines of Swift. It is not being replaced — it stays the
reference implementation, and this project tracks it (see
[Relationship to ByteRipper](#relationship-to-byteripper)). What the web
edition buys is reach: a URL instead of a `.dmg`, Windows and Linux benches
instead of Macs, and a tool that a shop can put on every machine at once.

What it must *not* buy is a worse answer to the same question. A web hex editor
that chokes on a 32 MB SPI dump, or that cannot write the patch back to the
file, is not a smaller version of the app — it is a different, useless thing.
The constraints below are therefore listed honestly, including the ones we
cannot engineer around.

## Decisions taken

| Question | Decision | Why |
| --- | --- | --- |
| Where the data lives | **Browser-only. Static hosting, no backend.** | Shop dumps are customers' BIOS images. A dump that never leaves the machine cannot be leaked by us, and a static site costs nothing to run and nothing to be responsible for. |
| Core and parsers | **Plain TypeScript**, logic in Web Workers | One language, one debugger, no JS↔WASM boundary. Measured budgets below; the two genuinely compute-bound spots are isolated so WASM can be dropped in later *if a measurement asks for it*. |
| UI framework | **React 19 + Vite** | The bytes are drawn on canvas, so the framework's runtime is not on the hot path. What it has to supply is desktop chrome — virtualised trees, splitters, accessible menus and dialogs — and React's ecosystem supplies the most of it. |
| Browser support | **Chromium first-class; Firefox and Safari usable, saving via download** | The File System Access API is what makes *Save* mean *save*, and only Chromium has it. Elsewhere the app works fully but writes a copy through the download flow, and says so in the UI rather than pretending. |
| Offline | **Plain web page, no service worker for now** | The shop has network. A PWA is a later decision, and the one feature it would unlock (file-type association) is noted where it belongs. |
| Workspace | **One workspace per browser tab. No in-app tabs, no window management.** | The desktop app's tabs, pane dragging and multi-window handling are its single most expensive UI subsystem. The browser already has tabs; a second comparison is a second browser tab. |
| MVP scope | **Core plus all three firmware tools** | Parity with the desktop, including UEFI, FIT and ME Analyzer. Longest path, chosen deliberately. |

## Feature inventory

How every part of the desktop app lands here. Four verdicts:

- **Same** — ports across with no change in behaviour.
- **Adapted** — the feature survives, the mechanism changes.
- **Reduced** — part of it survives; what is lost is named.
- **Dropped** — does not apply to a web app, or the browser forbids it.

### Comparison

| Feature | Verdict | Notes |
| --- | --- | --- |
| Two panes, A and B; single-file mode when only A is open | Same | |
| Byte-for-byte comparison by absolute offset, no alignment | Same | The rule that makes the app simple stays the rule. |
| Orange fill on differing bytes; shorter file's EOF tail counts as differing | Same | |
| Live `12 differing · 2048 same` summary | Same | Computed incrementally in a worker. |
| Next/Previous Difference and Same Block, with grouping distance | Same | |
| Selection in one pane outlined in the other | Same | |
| Side-by-side ⇄ stacked layout, Swap Panels | Same | |

### Hex grid

| Feature | Verdict | Notes |
| --- | --- | --- |
| 16 bytes per row, two 8-byte groups, address / hex / decoded text columns | Same | |
| Word size 1/2/4/8 | Same | |
| Muted `0x00`/`0xFF`, hatching past EOF | Same | Colour *and* form, as on the desktop. |
| Keyboard navigation: arrows, Home/End, PageUp/Down, direct hex typing | Same | The keys and what they move are the same, including ⇧-extension and where a plain arrow collapses a selection. One reveal mode is not: upstream centres a caret an arrow brings back from off screen, and the web edition's reveal is a minimum scroll only (GAPS.md G37). A click places the caret where the pointer is, mid-byte included, and the web edition has no nibble to place it on yet (G19). |
| Editing in the decoded-text column | Same | |
| Zoom In / Zoom Out (font size stepping) | Dropped | The browser's page zoom (`Ctrl/Cmd +` / `−`) is the zoom. It scales the whole interface and the canvas re-measures on it, so the web edition has no zoom commands of its own: two zooms side by side would not agree about what "bigger" means. The hex font's size stays a setting (Settings, below). |
| Text decoding tables (Windows-1252 default, live 256-value grid) | Same | Pure table lookup, ports directly. |

### Editing

| Feature | Verdict | Notes |
| --- | --- | --- |
| Overwrite typing, red until saved, per-pane undo/redo | Same | |
| Insert mode, tail shifting, `OVR`/`INS` in the status bar | Same | |
| Segmented undo for typed runs | Same | Time-based grouping ports as-is. |
| Paste Insert, Delete Bytes, Fill Selection | Same | |
| New empty in-memory document | Same | |
| Revert to Saved | Adapted | Re-reads from the `File`/handle; in non-Chromium this means re-picking the file if the original `File` object has gone stale. |
| Duplicate (APFS clone, no bytes copied) | Adapted | The copy-on-write trick is a filesystem feature we do not have. The duplicate shares the same chunk source in memory and only diverges on edit — same user-visible behaviour, different mechanism. |

### Search

| Feature | Verdict | Notes |
| --- | --- | --- |
| Find with hex / ASCII / UTF-8 / UTF-16 LE+BE, case toggle | Same | |
| Smart Search (bytes first, then encodings in turn) | Same | |
| Every occurrence highlighted, current one raised, exact `3 of 128` count | Same | |
| First match before the full index; background indexing with cancel | Same | Worker with a cancellation token. |
| Search Results panel, live excerpts, refusal past 1000 matches | Same | |
| Recent queries and named favourites | Same | Stored in IndexedDB. |
| Pattern library synced through a cloud folder | Reduced, then restored | **Chromium syncs in the Mac app's own folder**: `showDirectoryPicker()` plus a handle kept in IndexedDB gives the one-file-per-machine merge model, in upstream's file format, so a browser and a Mac share one library. Firefox and Safari can take what is in a folder (a read-only merge from a picked folder) and export the other way. Plan: `Design/FAVORITES_SYNC_WEB.md`. |

### Minimap

| Feature | Verdict | Notes |
| --- | --- | --- |
| Local mode (miniature hex around the caret) | Same | |
| Overview mode (whole file, shaded by content density) | Same | One background pass, result cached per file version. |
| Differences and edits drawn at least two pixels tall | Same | |
| Two maps mirroring the panes, one shared scale | Same | |
| Drag the viewport marker, click to jump, wheel to scroll | Same | |
| Background rebuild with progress, rescale-in-hand on resize | Same | |

### Bookmarks and navigation

| Feature | Verdict | Notes |
| --- | --- | --- |
| Go To Position, hex or decimal, with the last ten addresses | Same | |
| Bookmark the caret's row, name it, purple arrow in the offset column and minimap | Same | |
| Drag a mark to another row | Same | |
| Unnamed marks described by the bytes at them | Same | |
| Bookmarks belong to the workspace and outlive the file | Adapted | The desktop scopes them to a window; here the scope is the browser tab's workspace, persisted in IndexedDB so a reload keeps them. |

### Segments and joining

| Feature | Verdict | Notes |
| --- | --- | --- |
| Partition into contiguous named segments, `S0`/`S1`/…, tints on rows and minimap | Same | |
| Split Here, Add Cut, Merge | Same | |
| Cuts travel with content; undoable with the edits that move them | Same | |
| Segments dialog with the row editor | Same | |
| Save Segment to a file | Adapted | Chromium: save picker. Elsewhere: download. |
| Save All as Separate Files into a folder | Adapted | Chromium: `showDirectoryPicker()` and one write per segment. Elsewhere: a ZIP download, because a browser cannot be handed a folder. |
| Replace Segment from File | Same | |
| Append File / Insert File at Start, with the seam becoming a cut | Same | |
| Joining one **pane** into another by dragging its header | Reduced | The operation stays, as a command in the pane header menu (*Insert at Start* / *Append at End*), not as a header drag. Pane dragging is the desktop UX we agreed not to rebuild. |
| Drop a file on a pane's top/bottom band to insert or append | Same | HTML5 drag-and-drop handles this well. |

### Tabs, windows, panes

| Feature | Verdict | Notes |
| --- | --- | --- |
| In-app tabs (⌘T), each a whole comparison | Dropped | A second comparison is a second browser tab. |
| Multiple windows, dragging a tab out | Dropped | Same reason. |
| ⌘W stepping down pane → tab → window | Dropped | Replaced by an explicit Close Pane control. |
| "This file is already open" arbitration, moving a pane between tabs | Dropped | Meaningless once there is one workspace per tab. Two browser tabs holding the same dump are two independent workspaces, and the app cannot know. **This is a real loss** — the desktop guarantees a file is open in one place at a time, and we cannot make that guarantee. |
| Pane header drag: swap, join, move | Reduced | Swap stays as a toolbar command. Join stays as a menu command. The drag itself goes. |
| Duplicate Here in the free half in single-file mode | Same | As a button in the empty pane. |

### The tool panel

| Feature | Verdict | Notes |
| --- | --- | --- |
| Panel on the left, one tool at a time, bound to one pane, says which | Same | |
| A row picked in a tool takes the dump to those bytes and draws the extent in the minimap | Same | |
| Everything a tool writes goes through the editor's undo stack | Same | |
| **UEFI Structure**: descriptor, regions, volumes, FFS files, sections, NVRAM, microcode, padding | Same | Port of `UEFIImage` (10.4k lines). |
| Lazy tree reading, one tree shared by all three tools | Same | The reason a 32 MB image opens instantly; ports directly. |
| Checksum verification during the build, Fix Checksum as an undoable edit | Same | |
| CPU-visible addresses anchored at the reset vector | Same | |
| GUID catalogue from UEFITool's `guids.csv` | Same | Shipped as a static asset, generated at build time. |
| **FIT Table**: entries with type, version, size, checksum, and what they point at | Same | Port of `FITTool` (7.2k lines). |
| Microcode Add / Replace / Remove with table bookkeeping, one undo | Same | |
| Microcode catalogue by CPUID, revision, date | Same | Fetched live from `api.github.com/.../CPUMicrocodes/git/trees` plus `raw.githubusercontent.com`, as upstream does. Both answer with `Access-Control-Allow-Origin: *`, so a browser can read them. |
| **ME Analyzer**: family, version, SKU, chipset, stepping, dates, stock/update/extracted | Same | Port of `MEFirmware` (17.4k lines). |
| Health rows: RSA signature, partition tables, EFS, MFS, filesystem state | Same | Includes the RSA modpow and CSE Huffman decompression — see the performance budget. |
| Full Tree view | Same | |
| Copy summary as rich text | Adapted | Clipboard API writes `text/html` plus `text/plain`. |
| Screenshot the summary as a picture | Same | Rendered to a canvas and downloaded, which is what a forum post needs anyway. |
| `MEA.dat` / `Huffman.dat` databases, live-fetched as upstream publishes | Same | Same policy as the desktop: lazy, single-flight, no cache. See [Third-party data](#third-party-data). |

### Files, settings, system integration

| Feature | Verdict | Notes |
| --- | --- | --- |
| Open via picker or drag-and-drop | Same | Chromium's `getAsFileSystemHandle()` on a drop even yields a writable handle, so a dragged-in file can be saved back. |
| Chunked reading, never loading whole | Same | `Blob.slice()` is the chunk source; `ChunkCache` ports almost unchanged. |
| Save in place | Chromium only | `FileSystemWritableFileStream`. Firefox and Safari download a copy, and the button says *Download* there rather than *Save*. |
| Save As | Same | Picker in Chromium, download elsewhere. |
| External change detection with a reload offer | Adapted | Detected on access (`NotReadableError`) and by a `lastModified` check, not by a filesystem watcher. |
| Security-scoped bookmarks across launches | Adapted | Handles kept in IndexedDB; the browser re-asks for permission on the next visit, which is one click rather than nothing. |
| Register as the handler for `.bin` / `.rom` | Dropped for now | The File Handling API needs an installed PWA. Available to us the day we decide to become one. |
| Document icons in the file manager | Dropped | |
| Settings: font, size, row density, theme, grouping distance, decoding table | Same | Persisted in IndexedDB. |
| Light and dark themes, colour *and* form for every state | Same | Follows `prefers-color-scheme` with a manual override. |
| Sandbox, entitlements, notarisation, Gatekeeper | Dropped | The browser *is* the sandbox. This is the point of the project. |
| Menu bar | Adapted | A toolbar plus a command palette. See below. |

## Browser constraints, stated plainly

### File access

`showOpenFilePicker()` returns a handle that can be re-opened for writing; it is
Chromium-only. Everywhere else we get a `File` from an `<input>` or a drop —
readable in chunks via `slice()`, never writable. A `File` also goes stale if
the file changes underneath it, which surfaces as `NotReadableError` on the next
chunk read. That is a worse failure mode than the desktop's, and the UI has to
name it rather than show an empty row.

Write permission on a handle does not survive a reload. A handle stored in
IndexedDB comes back, but the browser re-prompts, once, per visit.

### Memory

A 16–64 MB dump is comfortable. Chunked storage plus a piece list for the edits
means the working set is the cache plus the edits, not the file — so a 1 GB
image is a matter of the cache's bound rather than of the file's size. Safari
is the tightest of the three and the one to measure against; a single
`ArrayBuffer` of hundreds of MB is off the table everywhere, which the chunked
design already avoids.

### Keyboard

The browser keeps some shortcuts and will not give them up: `Cmd/Ctrl+T`,
`Cmd/Ctrl+N`, `Cmd/Ctrl+W`, `Cmd/Ctrl+Shift+N` never reach the page. That is
survivable precisely because we dropped in-app tabs and windows. What the page
*can* take (with `preventDefault`) and will use: `Cmd/Ctrl+O` open, `Cmd/Ctrl+S`
save, `Cmd/Ctrl+F` find, `Cmd/Ctrl+L` go to, `Cmd/Ctrl+D` bookmark,
`Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` undo, `Cmd/Ctrl+A`, `Cmd/Ctrl+C`,
`Cmd/Ctrl+V`. Modifiers are normalised so a Windows bench presses Ctrl and a Mac
bench presses Cmd for the same command.

`Cmd/Ctrl+K` opens a command palette — the honest web replacement for a menu
bar, and a better one for a tool with this many commands.

### Clipboard

Plain text and HTML are easy. Raw bytes are not: the async clipboard carries
custom types only under a `web ` prefix, and only in Chromium. So **Copy** puts
hex text on the clipboard everywhere (which is what gets pasted into a ticket),
plus the raw bytes as a custom type where the browser allows it, so a
copy-paste between two ByteRipperWeb tabs is byte-exact rather than
round-tripped through hex.

### Fonts

The hex grid needs a monospaced face whose advance width we can measure
exactly. We self-host one rather than relying on each OS having something
suitable, and measure metrics through `measureText` at load, so a font that
fails to load degrades to the system stack instead of to a misaligned grid.

### Third-party data

Three catalogues come from other people's repositories, and the desktop fetches
all three live from `raw.githubusercontent.com` and `api.github.com`:
UEFITool's `guids.csv`, MEAnalyzer's `MEA.dat` and `Huffman.dat`, and platomav's
microcode catalogue.

**The web edition fetches them live too**, keeping the desktop's policy where it
applies: lazy (nothing fetched at startup) and single-flight (concurrent callers
share one request). Being online is a dependency the desktop accepted
deliberately, and the trade it buys — always current data, nothing to update by
hand — is the same trade here.

It departs from the desktop in one place, and gains something by it: **the
fetched bodies are cached for 24 hours.** The desktop keeps nothing, so no
network means no ME Analyzer. Here the bodies live in the Cache API (which works
without a service worker) with the time they were fetched beside them:

- Fresher than a day: used straight from the cache; no request is made at all.
- Older: re-fetched. Success replaces body and timestamp; failure keeps the old
  body and the tool's header states its date — `MEA.dat · 10 Sep` — so
  yesterday's data cannot be mistaken for today's.
- A *Refresh now* control drops the TTL, for the bench that knows an update
  landed this morning.
- Nothing cached and no network: the tool says the databases are unavailable,
  which is what the desktop does today.

Revalidation costs almost nothing, though not through our code. The three files
carry `ETag`s and GitHub honours `If-None-Match` with a `304` and an empty body —
but a cross-origin response exposes only `cache-control`, `content-length`,
`content-type` and `expires` to a script (GitHub sends no
`Access-Control-Expose-Headers`, and no `Last-Modified`), so `response.headers.
get('etag')` is `null` and we cannot make that request ourselves. The browser's
own HTTP cache does: it stores the `ETag`, and the `max-age=300` on these files
means a later `fetch` goes out conditional and usually comes back `304`. The
three bodies are about 1.2 MB together in the worst case.

Both hosts answer cross-origin requests with `Access-Control-Allow-Origin: *`,
so a page on any origin may read them. Two things differ from the desktop and
are worth knowing rather than engineering around:

- **A CORS failure is indistinguishable from being offline.** If GitHub ever
  stops sending that header, `fetch` fails without telling the script why. The
  desktop's error vocabulary — `offline`, `badResponse(status:)`, `rateLimited`
  — still describes the situation truthfully, so the messages port as they are.
- **`api.github.com` allows 60 unauthenticated requests per hour per IP**, and a
  shop behind one NAT shares that budget across its benches. The desktop already
  has a `rateLimited` case for this; in the shop it will simply come up more
  often. Only the microcode catalogue uses the API, and only when the FIT tool
  is opened, so the budget is unlikely to bind in practice.

**A fetch anybody is waiting on is shown, with a cancel.** On the desktop this
was learned the hard way: the analysis stops mid-flight on `await
data.database()`, and a bench reported it as a random pause before ME Analyzer
produced anything — a silent 350 KB download. Here every wait on the network
reports progress in the status bar, names what it is fetching, and can be
cancelled into the tool's "databases unavailable" state.

As on the desktop, each source sits behind an interface (`GuidsSource`,
`MEADataSource`) so that tests install their own: a suite that reaches GitHub is
a suite that fails on a train.

## Architecture

The desktop's layering is good and survives the move:

```
storage  →  model  →  presentation state  →  view
```

Concretely:

```
src/
  core/        pure TS, no DOM: chunked storage, piece table, edit overlay,
               diff, search, segments, bookmarks, undo, offset parsing,
               text decoding
  firmware/    pure TS: UEFI image parser, FIT, ME analysis
  workers/     diff, search, minimap build, firmware parsing
  render/      canvas renderers: hex grid, minimap — imperative, no React
  state/       stores bridging workers and React
  ui/          React components: toolbar, panels, dialogs, tool panel, settings
```

Rules carried over from the desktop, because they earned their place there:

- `core/` and `firmware/` import nothing from `ui/`, `render/` or the DOM. They
  are the unit-tested half of the project.
- Anything that walks the whole file runs in a worker, reports progress, and can
  be cancelled.
- Byte ranges are half-open `[start, end)` internally. Dialogs may show an
  inclusive end and convert at the edge.
- Difference state is background colour; unsaved modification is red foreground;
  a byte that is both shows both.
- A tool module depends on the firmware layer and on shared code, never on the
  app or on another tool module.

### Rendering

The hex grid is a canvas, not DOM. Two things decide whether it feels like an
editor or like a web page:

1. **Glyph atlas.** `fillText` costs ~2–5 µs a call, and a screen is ~1600
   cells. The 256 two-character hex pairs and the printable ASCII glyphs are
   pre-rendered once into an offscreen canvas per font/size/theme; drawing a
   cell is then a `drawImage` blit, 5–10× cheaper.
2. **Dirty regions.** A caret move repaints two rows, not the grid. A scroll
   blits the overlap and paints the newly exposed band. This is the same lesson
   the desktop learned: fix what is repainted, do not cache what was painted.

`devicePixelRatio` is honoured, so the grid is sharp on a shop's 4K monitor and
on a laptop alike.

## Performance budget

Targets, to be enforced by a benchmark harness that exists from the first
milestone and runs against a real 16 MB dump. These are the numbers to argue
with when something feels slow:

| Operation | Budget | Note |
| --- | --- | --- |
| Open a 16 MB file to first painted row | < 100 ms | Only the visible chunks are read. |
| Scroll frame (grid repaint) | < 8 ms | Leaves the frame budget half empty. |
| Full diff, 16 MB | < 150 ms | Worker; `Uint32Array` comparison, ~4–8 GB/s. |
| Full diff, 64 MB | < 600 ms | Incremental, with progress. |
| Search, 16 MB | < 100 ms to first hit | Full index streams in behind it. |
| Overview minimap build, 16 MB | < 200 ms | Worker, cached per file version. |
| UEFI top level parsed | < 50 ms | Lazy; branches on demand. |
| ME analysis, whole region | < 2 s | Dominated by RSA modpow and Huffman. |

The last row is the only genuinely compute-bound one. `Crypto/RSA.swift` is a
hand-rolled 32-bit-limb Montgomery exponentiation (Swift has no bignum);
JavaScript's native `BigInt` does the same 2048-bit modpow in ~20–80 ms against
Swift's 2–5 ms, and an image carries several manifests. `Decompress/Huffman.swift`
is a bit-level decoder over 0x1000 chunks, 3–5× slower in TS. Both sit behind a
narrow interface. If the measured total exceeds the budget, a small WASM module
replaces those two functions and nothing else moves.

## Relationship to ByteRipper

The macOS app keeps evolving, and the web edition has to be able to follow it
without someone re-reading a year of commits.

`Skills/port-from-byteripper/` is the mechanism, built to this repository's
skill rules: `SKILL.md`, a stdlib-only script, and reference documents it ports
against.

- `PORT_STATE.json` records the last ByteRipper commit whose changes have been
  considered here, plus per-module notes.
- The script reads `git log` from a ByteRipper clone — found at `../ByteRipper`
  or wherever `BYTERIPPER_REPO` points — since that commit.
- Changes are grouped by Swift module and mapped through
  `reference/module-map.json` to the TypeScript files that correspond to them.
- Paths with no web counterpart (sandbox, entitlements, AppKit view code,
  tabs and window management, file-type registration) are classified as
  *not applicable* and stay out of the report instead of resurfacing every run.
- The output is a report to act on and a diff to review. The skill never
  rewrites code blindly; that is the same rule ByteRipper's own skills follow.

The macOS repository stays the source of truth for firmware knowledge. A fix to
a parser belongs there first, and arrives here through this path.

## Milestones

Each one ends with something a bench could actually use.

1. **Skeleton and grid.** Vite + React + TS strict, layout, canvas hex grid with
   glyph atlas and dirty-region repaint, chunked file reading, caret and
   selection, go-to-offset. Benchmark harness. One file, read-only.
2. **Comparison.** Second slot, diff engine in a worker, orange fill, difference
   navigation with grouping, status-bar summary, layout toggle and swap.
3. **Editing and saving.** Piece table, edit overlay, undo with typed-run
   grouping, insert mode, fill/delete/paste, save in place on Chromium and
   download elsewhere.
4. **Search and minimap.** Search engine and worker, results panel, both minimap
   modes, marks for matches and edits.
5. **Bookmarks and segments.** Bookmark model and UI, segments partition, split
   and merge, segment export, append and insert of files.
6. **Tool panel and UEFI.** Tool-module contract, panel chrome, the lazy image
   tree, checksums and Fix Checksum, GUID catalogue.
7. **FIT.** Table, resolution of entry targets against the tree, microcode
   add/replace/remove with a CI-built catalogue.
8. **ME Analyzer.** `MEFirmware` port, health rows, full tree, copy and
   screenshot, CI-built databases.
9. **Settings and pattern library.** Preferences, themes, decoding tables,
   favourites with directory-based sync on Chromium and import/export elsewhere.
10. **Hardening.** Benchmarks against the budget, cross-browser pass, empty and
    error states, accessibility.

Rough size, for expectation-setting rather than estimation: ~41k lines of pure
Swift become perhaps 30k lines of TypeScript, and 35k lines of AppKit become
perhaps 12k lines of React and canvas, since the tab, window and pane-drag
subsystems are not coming.

## Open questions

- **Hosting.** GitHub Pages from CI is the default. Anything else — a shop's own
  server, a custom domain — is a deployment detail, not an architectural one.
- **Session restore.** Handles can be kept in IndexedDB so a reload offers to
  re-open yesterday's pair with one permission click. Worth doing, but not
  before milestone 3.
- **Telemetry.** None. Worth stating in the README so a shop knows.
