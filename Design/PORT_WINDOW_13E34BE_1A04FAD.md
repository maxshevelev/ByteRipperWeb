# ByteRipperWeb — porting the window `13e34be`…`1a04fad`

The seventy-seven upstream commits on `main` past `13e34be` (one merge,
`1a04fad`, carries nothing of its own), as work units in dependency order.
Each unit is a separate commit that ends with the check suite green
(`npm run check`, `check_anchors.py --head <its last commit>`, the help
checks) and its share of `GAPS.md` moved; the boxes are ticked as units close.

The local clone of upstream stands on a research branch
(`me-eom-bootguard-research`); the window is `origin/main`, and the report is
run with `--head origin/main`.

Standing rules: shared upstream strings word for word, the web's own strings
translated here; help edited in all three languages and re-stamped
(`help-coverage --bless`); anything the browser cannot do is an `unported`
entry with the reason, a test the web has no level for a `later` entry.

## The owner's decisions (2026-10-20)

- **What "launch" is.** Upstream restores the workspace at the app's launch.
  Here a reload restores the tab's own workspace (its identity is in
  `sessionStorage`, as the bookmarks' is), and a fresh tab takes up the most
  recently left workspace that no open tab holds — Web Locks say which are
  held. Closing the browser and opening the page again is a launch.
- **Projects** (`.brp`, a package folder) are ported for Chromium — a folder
  picked with `showDirectoryPicker()`, its handle kept in IndexedDB — and for
  the desktop shell, a real folder. Firefox and Safari do not offer the
  project commands, as they do not offer save in place.

## The stories

- **Annotations panel** (`21d15ac7`, `4720eb52`, `faa1519f`, `76433fd9`,
  `a4bed7b2`, `5ba5d784`, `e654a33e`, `853aa656`, `2acfe960`, `cee86a05`,
  `cab45101`) and the offset menu's **Open Annotation** (`c06629c8`,
  `a417b5c2`): newest first, New, drag to reorder, kept between launches,
  ⌘A, ⌘Z for removals, Back and Forward.
- **Agent** (`1c106e0d`, `3c91a61d`, `c6554e45`, `5f95979e`, `604bec1b`):
  bringing a place forward activates its pane, survey names files by path,
  the background documents' bounds, the activity dot.
- **Fragments' names** (`6df00ce8`, `ec31062c`, `8e6d1dec`, `1ddfb725`).
- **Tool panels** (`d20c8f1d`, `e3581623`, `90f101ae`, `e7d038e5`,
  `ecbe9727`, `119b83a2`, `7302cf1f`): one detail list, the large view kept
  open, Show in Tree for ME.
- **Vendor DMI** (`3c835594`, `18d6b4e0`, `8bba71b8`): the badge, HP, Apple.
- **The rebuild planner's words** (`672b93de`).
- **Hover callouts** (`a924dbba`, `1b35a66e`, `8e219ec1`, `ef5adc93`,
  `1b795d01`).
- **Minimap** (`38e979b5`, `a04089b4`).
- **Text fields own their keys** (`3f93f3fb`, `d368a3e8`).
- **The workspace and projects** (`01835029`, `aa11d363`, `32011453`,
  `6cf4ba99`, `114e3c87`, `89999e40`, `faf9a24d`, `555b795d`, `cef0d8db`,
  `e705f442`, `cfcaefbf`, `06e4332c`, `65d694da`, `e597734d`, `5bf7ef27`,
  `a0e06f19`, `835d968b`) — G29.
- Help alone (`a3213b8f`, `cbfadf1e`, `f38a0d03`, `133a882a`, `f8b34b71`,
  `d7467d3e`, `b368df07`, `32f9a524`, `d077f502`, `e81ba71f`, `cddd3108`,
  `1b54bbac`, `79e71306`), the chip catalogue (`eb231325`, `283cb63c`), the
  release (`6cd23a81`), and commits with nothing for the web (`412b8fb4`,
  `64e795c9`).

## Units

- [x] **Y1 — help alone** (`1b54bbac`; the Russian `notes.md` rewrites go with Y7, the help body's ⌘C is the browser's own copy and upstream drops its workaround in `d368a3e8`)
- [x] **Y2 — the chip catalogue; nothing-for-the-web commits recorded** (`283cb63c` regenerated from upstream's table; `eb231325` is upstream's generator, which the web's reads the result of; `412b8fb4` is Swift's concurrency warnings and `64e795c9` AppKit test measurements — nothing for the web)
- [ ] **Y3 — fragments named by what was opened, the codec on the pill**
- [ ] **Y4 — tool panels: one detail list, the large view kept open, ME Show in Tree**
- [ ] **Y5 — vendor DMI: the badge, HP, Apple**
- [ ] **Y6 — the rebuild planner speaks the reader's language**
- [ ] **Y7 — the Annotations panel and Open Annotation**
- [ ] **Y8 — agent: the pane brought forward, survey paths, bounds, the activity dot**
- [ ] **Y9 — hover callouts and the note's outline**
- [ ] **Y10 — minimap: shared binning, equal widths**
- [ ] **Y11 — text fields own ⌘A, ⌘C, ⌘X, ⌘Z**
- [ ] **Y12 — the workspace (G29) and projects**
- [ ] **Y13 — version 0.9.3-1 and the baseline**
