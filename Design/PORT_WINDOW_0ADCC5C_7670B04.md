# ByteRipperWeb — porting the window `0adcc5c`…`7670b04`

The sixteen upstream commits past the baseline `0adcc5c`, as work units. Each unit
is a separate commit that ends with the check suite green and its share of `GAPS.md`
moved; the boxes are ticked as units close. The control is `check_anchors.py`'s gap
list, read with `--head <commit>` at the unit's last upstream commit while the window
is open. When the window is closed `PORT_STATE.json` moves to `7670b04`.

Standing rules, as for the earlier windows: shared upstream strings word for word, the
web's own strings translated here; help edited in all three languages, both editions
(`[[edition:…||…]]`, `[[key:…]]`), and re-stamped (`help-coverage --bless`); anything
the browser cannot do is an `unported` entry with the reason, a test the web has no
level for a `later` entry.

## Units, smallest first

- [ ] **W1 — small repairs** (`6b88064`, `ba5796c`, `7670b04`)
  - `6b88064`: the Add Microcode platform column's header is looked up with a context.
    The web already writes `L("Plat", { context: "column" })` — check, and note it as
    brought across.
  - `ba5796c`: the search bar's stop button is shown only while a search runs (the web
    renders it by status already — a test says so); a reveal checks that the node is
    still the focus when its branches have arrived, so a newer choice or a search match
    is not taken back (`revealAtCaret` awaits `findFirmwareNodeAt`).
  - `7670b04`: when the reveal reaches empty padding the tree hides, ask whether to show
    empty padding (a dialog, two strings), and show it on yes.
- [ ] **W2 — the details card and Edit ▸ Copy** (`45672e5` net of `6ec7b88`, the card's
  margins from `60af19f`)
  - The card's right and bottom margin become 12 px (the top and the left stay 30).
  - Edit ▸ Copy copies the text selected in the details when its rows have the focus,
    and is enabled for it (the shell's Edit menu and ⌘C).
  - A GPNV record's variable history comes after its text.
  - Not ported, with the reason: the list's size constraints, the window's title bar and
    edges not counting as a click (a page has no such chrome), the card staying open when
    the window is moved (a page's window is the browser's).
- [x] **W3 — following the selection and the keys: not ported** (`667d334`, `d4a1c3a`,
  `e5479e3`, `d1ca441`, `a3ab6d3`, `014edeb`). Decided with the owner: upstream is working
  its AppKit outline towards what the page already does — the table moves at once and what
  follows the selection (the detail, the zones, the dump) follows it — so there is nothing
  to bring across. Each commit is an `unported` entry with that reason.

- [x] **W3b — a row makes room before it opens** (from `667d334`, the one piece of W3 the
  page does not do): a row the reader opens whose rows would not be in view is held shut
  while the list scrolls, smoothly, to where they will be, and opens when it stands still;
  an Alt-click on the triangle and a row whose rows are in view open at once.

- [ ] **W4 — the launch window** (`60af19f`, `bd20f98`)
  - The desktop window is as tall as the landing screen needs, bounded only by the
    screen's usable height (the three-quarters cap of `ba9ebdf` goes), with the same air
    above the icon as below the last line. The browser has no window to size; the landing
    screen's own spacing is checked against it.
- [ ] **W5 — the AMD PSP's map** (`1bda2ba`)
  - `AMDFirmware.swift` (the EFS at its fixed offsets, combo directories, `$PSP`/`$PL2`,
    `$BHD`/`$BL2`, slots A and B, every address mode), its rows in the padding or the
    Insyde map region that holds it, a blob taking in the microcode rows inside it, the
    directory's details (entries with type, size, location, flags, each leading to its
    row), a blob's "listed by", the Fletcher-32 check and Fix Checksum, a compressed BIOS
    entry with AMD's Zlib header and no section round it opening to what it inflates to
    (read as a raw area) with Update in Parent refusing a change inside it; strings (52
    in each language), glossary entry, help. Three steps: the reader, then the rows and
    details, then the checksum and the inflating entry.
- [ ] **W6 — AMI BIOS Guard (PFAT) update files** (`7b452e2`, `798696f`)
  - `BIOSGuardUpdate` over an `ImageReader`, the comparison of a dump's BIOS region with
    an update file (the region's menu item, a sheet listing each named part with its
    address, identical, differs or board data, Write as one undo step, only the bytes that
    differ), then the update file as a tree: the row *AMI BIOS Guard update*, its details,
    the assembled BIOS region opened through a decoded space, Open/Save Assembled BIOS
    Region, Update in Parent refusing, two node kinds (`biosGuardUpdate`,
    `biosGuardEntry`), glossary entry, help. Two steps in upstream's order.

## Order and closing

W1 and W2 first, as they are small and touch the code the later units read; W4 is small and
may go anywhere; W5 before W6, since W6 reads the same padding. Where a unit turns out to depend
on another the order is changed here and said.
