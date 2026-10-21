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
- [x] **Y3 — fragments named by what was opened, the codec on the pill** (`6df00ce8`, `ec31062c`, `8e6d1dec`, `1ddfb725`; the pill's ink on the badge is a CSS rule, the dot a CSS disc)
- [x] **Y4 — tool panels: one detail list, the large view kept open, ME Show in Tree** (`d20c8f1d`, `e3581623`, `90f101ae`, `ecbe9727`; the FIT detail and ME reveal already were the shared list and the moved table here; `e7d038e5` is the window's title, which a page has not got; `119b83a2`, `7302cf1f` are flow tests, `later`)
- [x] **Y5 — vendor DMI: the badge, HP, Apple** (`3c835594`, `18d6b4e0`, `8bba71b8`; the worker tells an HP_MUD entry or a SysF store for one and says so on the wire, `dmiArea`, since the panel holds no bytes)
- [x] **Y6 — the rebuild planner speaks the reader's language** (`672b93de`; LocalizedText takes nested sentences and joins, as upstream's, and crosses from the worker as plain data)
- [x] **Y7 — the Annotations panel and Open Annotation** (`0b86280`, `c8527f0` and the help commit): model, panel (order, New, drag, fades, ⌘A, ⌘Z), history steps, Open Annotation, `notes.md` in three languages at upstream's head with edition phrases for where the annotations are kept, the strings, anchors and map, GAPS (the zoom row, G24). Found in the browser: removing the last card took the pill and so the ⌘Z that would put it back; the panel now stays, showing upstream's `NotesEmptyView`, while a removal made there can be undone
- [x] **Y8 — agent: the pane brought forward, survey paths, bounds, the activity dot**: `1c106e0d`/`3c91a61d` were already the web's behaviour (the shell's `bringForward` activated the pane, the card's path moved the tool) — the shell's half moved to `bringPaneForward` in the store so upstream's three tests could be ported; `c6554e45` `surveyNames` and `root`; `5f95979e` two bounds in Settings ▸ Agent, the worker saying what its buffers hold (`firmwareHeldBytes`, said before each answer so the trim after a call sees it), a file let go read again under its id, the machine's memory from the shell's `agent:info`, the file counted whole (the page holds it in a Blob); `604bec1b` the red dot
- [x] **Y9 — hover callouts and the note's outline**: one callout for the page (`hoverCalloutStore`, `HoverCallout.tsx`, `calloutFrame`), in the dump (a named mark's address; a note on its outline only, `noteContourAt`, the left edge answering as far out as the right) and on the minimap (marks, strip pieces and cuts, zone brackets, with the glyph in the thing's own colour); the hovered bracket goes vivid and a point thicker (`zoneHoverHighlight`); `ef5adc93`'s folding (`outlinesFolded`) — in Chrome the dashes of an outline millions of pixels tall were drawn solid, now dashed at 16.7 ms a frame. The window also takes `0926d65e` (after `1a04fad`): the dot's overhang before macOS 26 is AppKit's, inside the `AgentActivityBadge.*` entry
- [x] **Y10 — minimap: shared binning, equal widths**: `a04089b4` the two maps' byte areas evened to the narrower (`MinimapLayout.peer`; each map publishes its own options, the other reads them); `38e979b5` the rows a ready comparison index calls the same are read by one worker, half and half (`shareOverviewRows`, a skip mask to each worker, the halves joined by `copySharedRows` and shown only together), and `mark`'s dropped difference before a run of rows mid-file. Differs: a picture asked for while the index is still being built reads every row instead of waiting for it
- [x] **Y11 — text fields own ⌘A, ⌘C, ⌘X, ⌘Z**: the keys already reached a field first in the web (the window's handler stands aside for a text entry, the dump answers its own); what was left is the menu — Edit ▸ Undo and Redo chosen while typing in a field act on its typing (`textFocusStore`, remembered across a menu's own focus), seen in Chrome: the find field's typing undone, the dump's red edit kept. The web's Edit menu has no Copy, Cut or Select All to route. Help: "In a text field" in three languages, `copy` and `cut` chords. Anchors moved to upstream's `undo`, `redo`, `copy`, `selectAll`
- [ ] **Y12 — the workspace (G29) and projects** — in progress: W1 Settings ▸ General (`01835029`) done; W2 the model, recorder and restore of panes and files done (`Design/WORKSPACE.md`; seen in Chrome: a reload restores an OPFS file with its selection and scroll, a fresh tab takes up the workspace a closed tab left, a second tab beside an open one starts empty, a file with no handle is named in the warning); W3 bookmarks (kept under the workspace id already), segments with their links, minimap, find bar done (seen in Chrome after a reload); W4 untitled bytes and unsaved changes done (`114e3c87`, `06e4332c`, `835d968b`: kept in IndexedDB beside the record, `OverlayEdits` runs for a file, leaving asks only about what is not written yet; seen in Chrome); W5 parts; W6 tools and the Annotations panel; W7 projects; W8 help
- [x] **Y12b — a fragment panel lies over the panes** (`d3759bd6`, after `0926d65e`): the panel stands in 16 px at the sides (a quarter of the width at most) and 32 at the top over a scrim that dims the panes and folds the panel when clicked; a panel opened just now slides up from under the dock, one raised again grows out of its pill; the dock lies on top with its shadow, a folded pill is a white card; a flick is measured over the last 100 ms (600 px/s) and a thrown fold starts at the hand's speed; the margins come out of the part's tool panel. The driver now brings the app's page to the front — an update of headless Chrome opened its own settings tab in front and stopped the page's animations
- [ ] **Y13 — version 0.9.3-1 and the baseline**
