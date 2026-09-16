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

The map, and so the summary, covers upstream's non-private declarations only:
the anchor check does not ask for a `private` helper to be anchored, because a
port folds most of them into the code it does anchor. Behaviour that lives only
in a private function can therefore be missed without the check saying so — the
hex field formatting (`FindBarView.normalizeHexText`) was. Rows found that way
(G32, G33 and part of G18, all now closed) name the private functions in
*Upstream* and have no map entries. The audit that finds them:

```bash
python3 Skills/port-from-byteripper/scripts/private_audit.py
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

Nothing open: the last row, G7, is in [Closed](#3-closed).

### 1.3 Tool panels

| ID | Gap | Upstream | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|---|
| G10 | **Row marks:** tints, rails, badges and the legend in the UEFI, ME and FIT panels. Only the problem mark (and FIT's latest mark) exist. | `ToolRowMarks.swift`, `ToolRowMarkStyle.swift`, `ToolRowMarksLegend.swift`, `MEATreeMarks.swift`, `UEFITreeMarks.swift`, `FITRowMarks.swift` | ~20 | — | P2 | open |
| G11 | **Zones both ways:** a zone picked in the dump handed back to its tool, zone kinds, Save Zone as…, a click near a bracket's end on the minimap going to that end. | `ToolController.swift`, `ToolSession.swift`, `Zone.swift`, `UEFIPresenter.swift`, `MainViewController.saveZone`, `MinimapView.swift` | ~15 | — | P2 | open |
| G12 | **Parked tool state** across switching tools (only the ME panel keeps its own). | `ToolSession.swift`, `ToolController.swift`, `FITToolModule.swift`, `UEFIToolModule.swift` | ~13 | — | P3 | open |
| G14 | **Drops on the tool panel** (a file replacing the bound pane's). | `ToolPanelView.swift` | 5 | — | P3 | open |
| G15 | **Selecting the folded title row** in the UEFI panel. | `UEFIToolViewController.swift` | 2 | — | P3 | open |
| G16 | **Third-party data freshness by hand:** marking a catalogue or a body stale; ETag revalidation instead of the Cache API's 24-hour lifetime; a failed catalogue fetch as a typed error rather than a worded one. | `Freshened.swift`, `GuidsSource.swift` | ~13 | — | P3 | open |

### 1.4 Dump and minimap

| ID | Gap | Upstream | Size | Depends on | Priority | Status |
|---|---|---|---|---|---|---|
| G17 | **Minimap tooltips** over its marks, strip and brackets. | `MinimapView.swift` | 6 | — | P3 (postponed) | open |
| G19 | **While a context menu is open:** the byte or address it is about is framed, a marked row becomes the dashed ring; a right-click places the caret on the byte's high nibble. | `HexView.swift` | ~6 | — | P3 | open |
| G20 | **Drawing details:** the zeros of a marked address muted, a hovered segment band saturated, the dim `_` in a half-typed insert byte's low nibble, hysteresis when a bookmark is dragged across a row boundary. | `HexView.swift`, `PaneViewModel.swift` | ~5 | — | P3 | open |
| G21 | **The status line names the piece under the caret.** | `PaneViewModel.swift` | 1 | — | P3 | open |
| G35 | **Undo and redo bring the caret back into view.** Today the caret moves back and the view stays where it was, so redoing a join leaves its seam off screen rather than centred again. | `PaneViewModel.swift` (`SelectionReveal`), `HexView.swift` | 1 | — | P2 | open |

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
| G34 | **The version line and the newer-build notice.** Upstream signs the landing screen with the app's name and version and says there when a newer build is out, from a check of the GitHub releases (`EmptyStateView.appNameAndVersion`, `showAvailableRelease`; `MainViewController.releaseCheckTask`, `releases`; `Updates/AppVersion.swift`, `Updates/GitHubReleases.swift`). Postponed by the owner: the web edition will do it its own way, not as a port. | 5 + 2 files | The web edition's own design | P3 | decision |

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
| The shared pattern library folder | Chromium keeps a directory handle in IndexedDB and asks for write permission once per visit (or never, with "Allow on every visit"), watching the folder with a FileSystemObserver, the window coming forward and a minute's poll. Firefox and Safari read a folder the user picks, without writing to it. A browser has no hardware id: its id is minted and kept, and This Was Me takes back the id of a file it wrote before its data was lost. | Design/FAVORITES_SYNC_WEB.md (G7) |
| Carrying favourites between machines without a shared folder | Export… and Import… in the Favorites tab, in every browser: the export is this browser's folder file, and an import merges as a peer with no common past, asking in the resolver what it cannot decide. Upstream has only the folder. | Design/FAVORITES_SYNC_WEB.md (G7) |

---

## 3. Closed

Gaps closed since this file was started, newest first.

| Gap | Closed |
|---|---|
| G13 — Content changes reach a tool as a change rather than a re-parse: the document's own content-change signal carries the operations to `src/tools/contentChange.ts`, which merges a burst of typing into the one stretch they touched and adds up their length changes; `firmwareStore` holds it for 300 ms and sends a fresh `Blob` with the range and the size delta, and the worker swaps its reader and collapses its existing tree in place (`LazyUEFITree.invalidate` ported to `src/firmware/uefi/treeInvalidation.ts`), so what a collapse drops is read again from current bytes. A reload — a revert, a file joined on — goes straight through with no delay, since holding it back is the panel sitting on a tree of a file that is gone. Bumping the reply's job id is the stale-session guard. A publish that newly focuses a zone scrolls the dump to it, and only when it is not on screen already, through `zoneHooks` rather than each tool remembering to ask | 2026-09-16 |
| G36 — The tool panel's file selector: the name in the header is the control, offering both panes in pane order, ticking the one the tool reads, keeping a closed pane as a disabled entry and staying off with one file open; choosing a pane moves the tool through the same door a drop would, so a session is never re-pointed underneath itself. A transparent `<select>` over the drawn name and chevron, whose shown option is its tick, and the nine upstream tests come with it | 2026-09-16 |
| Redo of a join, and ⇧⌘Z: redo restores the partition as the join left it — the seam cut and both names — and detaches the pane from its file again; ⇧⌘Z is Redo where a Mac's browser reports the key as a lower-case `z`; undo and redo keep the dump mounted and focused, and take ⌘Z / ⇧⌘Z / Ctrl+Y for the active pane wherever the keyboard is | 2026-09-16 |
| A join shows its seam: after Append File or Insert File at Start, from the menu or a drop band, the caret stays at the start of the added part and the pane that took the file centres it, where the view used to jump to the top and take both carets there | 2026-09-15 |
| G22 — Fill Selection starts from the last pattern used, `FF` until one has been, kept in `localStorage` | 2026-09-15 |
| G18 — A click on the minimap near a bookmark's mark goes to its row, and a click on the segment strip to the byte under it or to the nearest cut in reach; the gutter between side-by-side maps is upstream's 5 % of the panel, and the edge snap its 4 px | 2026-09-15 |
| G7 — The pattern library: favourites in the Find bar's menu and in Settings, Export and Import, the shared library folder with one file per machine, a three-way merge per peer and the resolver (Chromium), a read-only fetch from a folder (Firefox, Safari), and This Was Me for a browser whose data was lost | 2026-09-15 |
| The toolbar's Tools button is a pull-down: the wrench with a chevron, as upstream's `NSPopUpButton` with `pullsDown` | 2026-09-15 |
| G33 — A font or row-height change keeps the middle of the view in place: the row at the centre stays centred, in both panes, as upstream's `applyAppearance` does | 2026-09-15 |
| G32 — A drag selection, or a mark's drag, keeps scrolling while the pointer is held past the dump's edge, by the overshoot, 30 steps a second, until the pointer returns or the file ends | 2026-09-15 |
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
