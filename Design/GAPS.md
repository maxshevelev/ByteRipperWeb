# ByteRipperWeb — gaps with ByteRipper

What is still left to port from the macOS app, and what the web edition will
not support, as tables to prioritise from.

The module map (`Skills/port-from-byteripper/reference/module-map.json`) is the
symbol-level truth: every upstream declaration left out carries a `later —` or
`n/a —` reason there. This file groups those reasons into things a person can
decide about. `Design/ANALYSIS.md` remains the record of *why* a feature is
dropped or adapted; this file is the list.

## Keeping it current

This file is updated in the same change that:

- **closes a gap** — the row moves to [Closed](#3-closed) with the date;
- **leaves something out** — a new `later —` entry in the module map belongs to
  a row here (an existing one, or a new ID);
- **drops or adapts a feature** — a row in [section 2](#2-not-supported-in-the-web-edition),
  and the verdict in `Design/ANALYSIS.md`.

To check the tables against the map:

```bash
python3 Skills/port-from-byteripper/scripts/unported_summary.py --later --no-tests
python3 Skills/port-from-byteripper/scripts/unported_summary.py --na --no-tests
```

Columns:

- **ID** — stable, never reused, so a conversation can say "G4".
- **Size** — upstream declarations still unported for the gap, from the summary.
  A measure of weight, not of effort: one C decoder counts as a handful.
- **Priority** — P1 first. A proposal until the owner changes it.
- **Status** — `open`, `in progress`, or `decision` when it waits on a choice
  nobody has made yet (named in *Depends on*).

---

## 1. Open gaps

### 1.1 Firmware analysis and editing

| ID | Gap | Upstream | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|---|
| G1 | **Compressed UEFI sections.** Nodes inside a compressed section are not opened, so the whole tree is in the file's own address space. | `ByteSpace.swift`, `CompressedSection.swift`, `DecompressedBuffers.swift`, `SpaceReaders.swift`, `TreeMaterialization.swift`, `UEFIDiagnostic.swift` | ~23 | G2 for Tiano-compressed sections | P1 | open |
| G2 | **Tiano / EFI 1.1 decoder.** Only LZMA is decoded today. | `EfiTianoDecompress.c`, `CTiano.c`, `FirmwareDecompression.swift` | 7 | — | P1 | open |
| G3 | **Boot Guard protected ranges** — marked in the FIT table and the UEFI tree, and edits inside them refused. | `ProtectedRanges.swift`, `FITEditor.swift`, `FITRowMarks.swift`, `FITDisplay.swift`, `UEFIImage.swift` | ~22 | — | P1 | open |
| G4 | **A decompressed or copied part opened as its own document, and Update in Parent.** | `DocumentOrigin.swift`, `RootLayout.swift`, `UEFIRebuild.swift`, `PaneViewModel.swift` | ~78 | G1, G5; where a part opens without in-app tabs (a browser tab, or a pane) | P2 | decision |
| G5 | **Compressors** (LZMA and Tiano encoders). The web edition only decompresses. | `CLZMAEncoder.c`, `CTianoEncoder.c`, `EfiTianoCompress.c`, `FirmwareCompression.swift` | 8 | — (needed by G4 only) | P2 | open |
| G6 | **Insyde flash device map stores** — typed, not parsed. | `FlashDeviceMapParser.swift` | 1 | — | P3 | open |
| G30 | **ME FileTable.dat naming** of MFS files. Upstream has not ported it either, so it waits on upstream first. | `MEADataSource.swift` | 2 | Upstream | P3 | open |
| G31 | **Structural leftovers with no visible effect:** FIT's display row and display fields, an edit's outcome kind and placement not modelled as values of their own, the MFS backup's size not named as a constant. Worth doing only alongside G3 or G10, which touch the same code. | `FITDisplay.swift`, `FITEditor.swift`, `MFSBackup.swift` | 5 | G3, G10 | P3 | open |

### 1.2 Search

| ID | Gap | Upstream | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|---|
| G7 | **The pattern library (M11):** favourites, named patterns, keeping a pattern from the find bar, the shared library folder with its merge and conflict sheet; outside Chromium, JSON export and import. | `FavoritePatternStore.swift`, `FavoritesFile.swift`, `FolderSync.swift`, `PatternLibrary.swift`, `SyncMerge.swift`, `VersionVector.swift`, `LibraryConflictSheetController.swift`, `FavoritePatternsSettingsViewController.swift` | ~270 + ~160 tests | Where the library lives without a directory picker | P2 | decision |

### 1.3 Tool panels

| ID | Gap | Upstream | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|---|
| G10 | **Row marks:** tints, rails, badges and the legend in the UEFI, ME and FIT panels. Only the problem mark (and FIT's latest mark) exist. | `ToolRowMarks.swift`, `ToolRowMarkStyle.swift`, `ToolRowMarksLegend.swift`, `MEATreeMarks.swift`, `UEFITreeMarks.swift`, `FITRowMarks.swift` | ~20 | — | P2 | open |
| G11 | **Zones both ways:** a zone picked in the dump handed back to its tool, zone kinds, Save Zone as…, a click on the minimap's strip selecting the piece and on a bracket focusing the zone. | `ToolController.swift`, `ToolSession.swift`, `Zone.swift`, `UEFIPresenter.swift`, `MainViewController.saveZone`, `MinimapView.swift` | ~15 | — | P2 | open |
| G12 | **Parked tool state** across switching tools (only the ME panel keeps its own). | `ToolSession.swift`, `ToolController.swift`, `FITToolModule.swift`, `UEFIToolModule.swift` | ~13 | — | P3 | open |
| G13 | **Content changes delivered to a tool** as a change rather than a re-parse, with a stale-session guard and a scroll to a newly focused zone. | `ToolController.swift`, `ToolSession.swift` | ~5 | — | P3 | open |
| G14 | **Drops on the tool panel** (a file replacing the bound pane's). | `ToolPanelView.swift` | 5 | — | P3 | open |
| G15 | **Selecting the folded title row** in the UEFI panel. | `UEFIToolViewController.swift` | 2 | — | P3 | open |
| G16 | **Third-party data freshness by hand:** marking a catalogue or a body stale; ETag revalidation instead of the Cache API's 24-hour lifetime; a failed catalogue fetch as a typed error rather than a worded one. | `Freshened.swift`, `GuidsSource.swift` | ~13 | — | P3 | open |

### 1.4 Dump and minimap

| ID | Gap | Upstream | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|---|
| G17 | **Minimap tooltips** over its marks, strip and brackets. | `MinimapView.swift` | 6 | — | P3 (postponed) | open |
| G18 | **Minimap click details:** a click near a bookmark snaps to its row; a gutter between side-by-side maps proportional to the panel. | `MinimapView.swift` | 2 | — | P3 | open |
| G19 | **While a context menu is open:** the byte or address it is about is framed, a marked row becomes the dashed ring; a right-click places the caret on the byte's high nibble. | `HexView.swift` | ~6 | — | P3 | open |
| G20 | **Drawing details:** the zeros of a marked address muted, a hovered segment band saturated, the dim `_` in a half-typed insert byte's low nibble, hysteresis when a bookmark is dragged across a row boundary. | `HexView.swift`, `PaneViewModel.swift` | ~5 | — | P3 | open |
| G21 | **The status line names the piece under the caret.** | `PaneViewModel.swift` | 1 | — | P3 | open |
| G22 | **Fill Selection starts from the last pattern used.** | `SheetControllers.swift` | 1 | — | P3 | open |

### 1.5 Accessibility

| ID | Gap | Upstream | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|---|
| G23 | **The dump announces** its title, the caret's address and the byte's value (today a fixed label); the minimap more than an `aria-label`. | `HexView.swift`, `MinimapView.swift` | ~5 | — | P2 | open |

### 1.6 Tests, hardening and delivery (M12)

| ID | Gap | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|
| G24 | **App flow tests.** Upstream's UI flow tests have no counterpart: the project has no component or end-to-end tests. | ~1000 upstream tests | A test dependency (Playwright, or a DOM test runner) — needs its reason written down | P2 | decision |
| G25 | **Modules without tests of their own:** `fileSink`, `duplicatePane`, attaching a join's file on undo and redo, `efiGuid`, `nvramGuids`, `ProgressSink`, the lazy UEFI tree, `firmwareTypeClassifier`, `manifestSelection`, the ME database stores, `BlobByteSource`, the UEFI checksum check, the seam. | ~15 upstream test files | — | P2 | open |
| G26 | **Cross-browser pass and error states end to end:** Chromium, Firefox, Safari; offline with no cached database, a stale `File`, a file changed on disk, a declined permission — every capability difference announced by the app. | — | — | P1 | open |
| G28 | **The benchmark table on a low-end machine** as well as a fast one. | — | — | P2 | open |
| G29 | **Session restore:** a reload offers yesterday's pair back from handles kept in IndexedDB, with one permission click. An open question in both plans. | — | Whether to do it | P2 | decision |

---

## 2. Not supported in the web edition

### 2.1 Dropped

| Feature | Why | Recorded in |
|---|---|---|
| In-app tabs (⌘T), several windows, tearing a tab off | One workspace per browser tab (D11): a second comparison is a second browser tab. | ANALYSIS.md § Tabs, windows, panes |
| ⌘W stepping down pane → tab → window | Nothing to step down through; each pane has its own close control. | ANALYSIS.md |
| "This file is already open" arbitration, moving a pane between tabs | Two browser tabs cannot know about each other. **A real loss:** the desktop guarantees a file is open in one place at a time. | ANALYSIS.md |
| Dragging panes, reparenting a pane into another window | Same reason. | module map (`n/a — panes are not dragged`) |
| Zoom In / Zoom Out, Zoom to Fit | The browser's page zoom is the zoom; the hex font size stays a setting. | ANALYSIS.md § Hex grid |
| Sizing the window to fit the dump, fitting a pane to its header | The browser owns the window's size. | module map |
| The macOS menu bar, the Tools menu, Word Size in a menu, the title bar menu | The toolbar and its commands menu carry the commands. | ANALYSIS.md § Files, settings, system integration |
| ⌘/Ctrl+T, N, W, Shift+N | The browser keeps them and never passes them to the page. | ANALYSIS.md § Keyboard |
| Show in Finder, Copy Full Path, file identity by inode | A browser is told a file's name and nothing about where it is. | module map |
| Watching a file on disk for changes | No filesystem watcher in a browser (see the adapted row below). | module map |
| Registering as the handler for `.bin` / `.rom`, the File Types settings tab, document icons | The operating system's choice; the File Handling API needs an installed PWA — possible the day the app becomes one. | ANALYSIS.md |
| Sandbox, entitlements, notarisation, security-scoped bookmarks | The browser is the sandbox. | ANALYSIS.md |
| The About panel, the app icon | The credits are in the README. | module map |
| The system beep on a refused key | A browser has none; the field already says what is wrong. | module map |
| Raw bytes on the pasteboard everywhere | The web clipboard carries text; see the adapted row below. | ANALYSIS.md § Clipboard |
| Zone Sketch | Upstream's debug-only demonstration module. | module map |
| The command-line front end | The web edition has no CLI. | module map |

### 2.2 Adapted — supported, differently

| Feature | How the web edition does it | Recorded in |
|---|---|---|
| Save in place | Chromium writes back through the file handle; Firefox and Safari save by download, and the interface says so. | ANALYSIS.md, D7 |
| Save All segments into a folder | Chromium: a directory picker and one write per segment. Elsewhere: a ZIP download. | ANALYSIS.md § Segments and joining |
| Save Segment / Save Selection | Chromium: save picker. Elsewhere: download. | ANALYSIS.md |
| Revert to Saved | Re-reads the `File` or handle; outside Chromium a stale `File` means picking the file again. | ANALYSIS.md § Editing |
| External change detection | On access (`NotReadableError`) and by `lastModified`, not by a watcher. | ANALYSIS.md |
| Access to files across launches | Handles kept in IndexedDB; the browser asks for permission once per visit. | ANALYSIS.md |
| Duplicate | The copy shares the chunk source in memory and diverges on edit, instead of an APFS clone. | ANALYSIS.md |
| Copy | Hex text everywhere, plus the raw bytes as a web custom type where the browser allows it (Chromium). | ANALYSIS.md § Clipboard |
| Copy summary as rich text | The Clipboard API writes `text/html` and `text/plain`. | ANALYSIS.md § The tool panel |
| Bookmarks | Scoped to the browser tab's workspace and kept in IndexedDB, so a reload keeps them. | ANALYSIS.md § Bookmarks and navigation |
| Third-party databases | Fetched live as upstream does, and cached for 24 hours in the Cache API so a bench offline still has yesterday's, with its date shown. | CLAUDE.md, ANALYSIS.md |
| Popovers (the cut popover) | A dialog with the offset in its form. | module map |
| The find indicator | A flat yellow plate with an outline and black bytes; upstream's lift, bounce and shadow are left out by the owner's decision. | module map (G9) |

---

## 3. Closed

Gaps closed since this file was started, newest first.

| Gap | Closed |
|---|---|
| G9 — The find indicator: the current match on a yellow plate with an outline and black bytes, over the mirrored selection's contour. No lift, bounce or shadow (see 2.2) | 2026-09-15 |
| G8 — Search remembered between visits: the recent searches with their encoding and case rule, Case Sensitive, and the bar opening on the last search; a recent search restores its encoding and case rule | 2026-09-15 |
| G27 — Deploy to GitHub Pages from CI: `.github/workflows/deploy-pages.yml` publishes `main` as the live site and `v*` tags as point releases, and the bundle has its base path | 2026-09-15 |
| Opening two files with a file already open replaced it; the second file now opens only into an empty workspace, as `OpenPlacement.plan` does | 2026-09-15 |
| FIT panel findings and catalogue message wrap instead of truncating | 2026-09-15 |
| Panes stay scrolled together (a pane re-laying out no longer drags the other); a second file, a file opened into a pane and Revert to Saved keep the caret and the viewport | 2026-09-15 |
| Go To edits (in the bookmark popover) and deletes bookmarks from its list | 2026-09-15 |
| Bookmark naming popover on ⌘D, a double-click on an address and ⇧⌘D, with the offset correctable | 2026-09-15 |
| A right-click on the selection keeps it, so its commands are offered | 2026-09-15 |
| Search Results panel opened by Show Search Results, with its titled count and close button | 2026-09-15 |
| Search runs in the background without holding the interface | 2026-09-15 |
