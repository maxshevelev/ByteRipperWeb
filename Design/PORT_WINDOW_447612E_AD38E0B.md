# ByteRipperWeb — porting the window `447612e`…`ad38e0b`

The twenty-six upstream commits past the baseline `447612e`, as work units in
dependency order. Each unit is a separate commit that ends with the check
suite green (`npm run check`, `check_anchors.py`, the help checks) and its
share of `GAPS.md` moved; the boxes are ticked as units close. The control is
`check_anchors.py`'s gap list, read with `--head <commit>` at the unit's last
upstream commit while the window is open.

Standing rules: shared upstream strings word for word, the web's own strings
translated here; help edited in all three languages and re-stamped
(`help-coverage --bless`); anything the browser cannot do is an `unported`
entry with the reason, a test the web has no level for a `later` entry.

The window holds three stories and some housekeeping:

- **The navigation history** (`c7bcc16`, `060e480`, `3f20e2e`, `43f5e26`,
  `3439fc0`, `242d914`): Back and Forward through the places the tab's jumps
  left, tool rows included. New to the web — nothing like it exists here.
- **The part codec** (`80738a3`): every part opens and goes back through one
  value that decodes it and encodes it again. The web's `DocumentOrigin` still
  has upstream's previous `kind` / `rebuildTarget` shape.
- **Lenovo's DMI store** (`a925d57` … `ad38e0b`): first a tool-module of its
  own, then folded into the UEFI tree within the same window (`6a17008`). Only
  the end state ports — the `LenovoDMI` package, its codec, the tree's rows,
  their detail, Show DMI Area and the lock marks. `Modules/LenovoDMITool` never
  reaches the web; its paths go to `notApplicable` with that reason.
- Housekeeping: FIT microcode processors (`8d27131`), leaving the App Sandbox
  (`4a196f2`), two hex view fixes (`bbdb1d2`, `83e23da`), the agent plan
  (`4120b06`).

## Units

- [x] **W1 — FIT: every processor a microcode serves, the extended signature table's included** (`8d27131`)
- [x] **W2 — housekeeping: the sandbox, the hex view fixes, the agent plan, the map** (`4a196f2`, `bbdb1d2`, `83e23da`, `4120b06`)
- [x] **W3 — the part codec** (`80738a3` without the Lenovo block)
- [x] **W4 — the LenovoDMI package** (`a925d57`, `09c9052`, `2a94978`, `dba5460`, `784fd0a`, `1dd195a`, `bf32c9b` — the package and its codec)
- [x] **W5 — Lenovo's DMI store in the UEFI tree** (`fb7ca87`, `19493ff`, `6a17008`, `ad38e0b`)
- [x] **W6 — Show DMI Area, and a part out of the tree opens with UEFI Structure on** (`f133d60`, `cf82cd9`)
- [x] **W7 — the navigation history: places, Back and Forward, the jumps that record** (`c7bcc16`, `242d914`)
- [x] **W8 — a tool's steps in the history** (`060e480`, `3f20e2e`, `43f5e26`, `3439fc0`)

### W1. FIT: every processor a microcode serves

`MicrocodeParser` reads the extended signature table, and the FIT display,
editor and catalogue name every processor signature a microcode carries, not
the header's one alone. Web targets: `src/firmware/uefi/microcodeParser.ts`,
`src/firmware/fit/*`, `src/tools/fit/*`. Upstream's test additions come with
it (`FITDisplayTests`, `FITEditorTests`, `MicrocodeCatalogueTests`,
`MicrocodeFileTests`), and `tool-fit.md` gains its line in three languages.

### W2. Housekeeping

- `4a196f2` leaves the App Sandbox. The browser's own sandbox is the web's
  answer to every question this commit settles; read the diff for behaviour
  (the favourites file, the segment writer's single-part fallback, the
  permission-denied wording) and port what is behaviour.
  `ByteRipper.entitlements` and `SandboxBookmarkStore` go to `notApplicable` /
  `unported` with the reason.
- `bbdb1d2` draws the caret in the pane left alone after the active pane of a
  comparison closed. The web derives a pane's activity from the workspace
  rather than from a reused view, so this is checked, and anchored with
  `@upstream-differs` when nothing has to change.
- `83e23da` ends the find indicator's hop on time. The web has no hop
  (GAPS 2.2, G9); nothing ports.
- `4120b06` plans the agent service (`Design/AGENT_PLAN.md`): upstream's own
  plan, not yet built. The web's position — the contract
  (`AGENT_PROTOCOL.md`) ports once upstream writes it; the transport is the
  web's own — goes in `ANALYSIS.md`.

### W3. The part codec

`PartCodec` with `PartParent`, `PartUpdate`, `PartRefusal`, `PartBadge`,
`CopyPartCodec` and `ReadOnlyPartCodec` (`Packages/PartCodec`), and
`UEFIPartCodec` (`Packages/UEFIContentSource`), whose encode is the rebuild
planner reading the protected ranges in its own parse
(`UEFIRebuild.plan(readsProtectedRanges:)`). `DocumentOrigin` keeps a codec
instead of `kind` and `rebuildTarget`; there is one way to open a part
(`openPart(named:from:source:layout:codec:)`), and Update in Parent is
`codec.encode` and one write. The pane header wears the codec's badge
(`PartBadgeView`). `UEFIPresenter.compressionName` names the badge.

The web's difference to keep: a codec that decompresses or rebuilds runs in the
firmware worker, so `UEFIPartCodec` is a description the worker acts on, not a
closure carried across the boundary.

### W4. The LenovoDMI package

`LDBGLog`, `LENVBlock`, `LenovoDMIArea`, `LenovoDMIFormat`, `LenovoDMIValue`
(the MSDM header split off the Windows key only behind the signature and a
matching length), `LenovoDMIKeyReferences` (the drivers that read each entry)
and `LenovoDMIBlockCodec` (a block decoded with the XOR, encoded again with the
checksum recomputed) as `src/firmware/lenovoDmi/`, with `LenovoDMITests` and
`TestStore`. Pure TypeScript; no panel yet.

### W5. Lenovo's DMI store in the UEFI tree

`LenovoDMIStore` reads the store into the tree: one row in place of the flash
map's three Unknown regions, or out of padding, with the log, both blocks and
their entries under it (`UEFINode` kinds, classification, `UEFIParser`,
`LenovoDMIFirmwareReaders`). The tree display and the help terms name the
rows; `UEFILenovoDMIDetail` sums the store up on its row and says what the
log, the blocks and the entries hold; a block's row wears a lock when stored
encoded and an open lock when it lies decoded in a part (`ToolRowMarks`,
`ROW_MARKS.md`). A block opens in a panel through `LenovoDMIBlockCodec`. Help:
`lenovo-dmi.md` (new) and the glossary in `Terms/uefi.md`.

### W6. Show DMI Area; a part opens with UEFI Structure on

`DMIStore` and the tree's background search for Lenovo's and ASUS's identity
stores; the UEFI panel's Show DMI Area button opens the way to one and moves
the dump to it. A part taken out of the UEFI tree opens with UEFI Structure
on in its panel and the tree's first level open (`PaneUEFIState`,
`PaneToolHost`). Help: `tool-uefi.md`.

### W7. The navigation history

`NavigationHistory` (generic, fifty places, the forward stack cleared by a new
jump, unreachable places stepped over) and `NavigationPlace` (the selection in
each pane the jump moved, the first byte on screen, the tool's choice), held by
the tab. Every jump REQUIREMENTS §10.6 lists records the place it leaves; the
view leaving the caret is a step (`FilePaneView.onCaretLeftView`). View ▸ Back
and View ▸ Forward on Cmd/Ctrl+[ and Cmd/Ctrl+], and a ‹ › pair in the toolbar
between the Tools pull-down and Go To. `NavigationHistoryTests` come with it.
Help: `navigation.md`.

The browser's difference to settle here: Cmd+[ and Cmd+] are the browser's
own Back and Forward on macOS. The page takes them while it has the keyboard,
as it already does for the other chords it owns (`helpKeys.ts`); the help's
`[[key:…]]` spells them per keyboard.

### W8. A tool's steps in the history

A click on a tool panel's row is a step (`ToolHost.noteNavigationStep`), and
Back chooses that row again with its zones (`ToolSession.navigationMark`,
`showNavigationMark`); the keyboard goes back to the tool's table when the
place is a step of it (`isToolStep`, `focusChoice`); with the tool closed, the
places Back and Forward leave keep its choice (`ToolController.closedChoice`),
so the rows are chosen again once it is open. For the UEFI, FIT and ME panels.

## Order and closing

W1 through W8 as written: W4 needs W3's codec for its block, W5 needs W4, W6
needs W5, and W8 needs W7. When the window is closed `PORT_STATE.json` moves to
`ad38e0b`, the package version follows (`release.py version`), and the gap
list holds only `later` and `unported` entries.

## Closed

All eight units are in; `PORT_STATE.json` moved to `ad38e0b` on 2026-10-09 and the package version stays `0.9.1-2` (upstream `0.9.1`). Remaining broken anchors in `SettingsDialog.tsx` come from upstream commits after this window.
