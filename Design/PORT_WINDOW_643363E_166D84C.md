# ByteRipperWeb — porting the window `643363e`…`166d84c`

The twenty-nine upstream commits past the baseline `643363e`, as work units in
upstream's own order. Each unit is a separate commit that ends with the check
suite green and its share of `GAPS.md` moved; the boxes are ticked as units
close. The control is `check_anchors.py`'s gap list, read with `--head
<commit>` at the unit's last upstream commit while the window is open.

Standing rules: shared upstream strings word for word, the web's own strings
translated here; help edited in all three languages and re-stamped
(`help-coverage --bless`); anything the browser cannot do is an `unported`
entry with the reason, a test the web has no level for a `later` entry.

## Units

- [x] **V1 — small interface: the reveal button's description, headings, the minimap at an empty window** (`9349066`, `b151d16`)
- [ ] **V2 — EC images and the Insyde map: appended bytes, ITE in padding, region sizing, ASUS parity, padding kept in place** (`65837d5`, `789f1d6`, `e461d44`, `0335e5a`, `9584582`)
- [ ] **V3 — VSS and NVAR values after the name, the VSS header** (`ebd2293`)
- [ ] **V4 — empty padding, free space and erased pad files grey in the tree** (`8eef0c3`, `8bd5507`)
- [ ] **V5 — descriptor straps: words, soft-disable bit, GPR0 and eSPI clock, a folded table, grey Empty rows** (`74516a7`, `72bf1e8`, `b54a13f`)
- [ ] **V6 — the large view of a row's details on Space** (`8322049`, `54efa22`, `df1eaef`, `7c59fd1`)
- [ ] **V7 — detail tables and fields as selectable views** (`ba682d7`, `5139501`, `f324a97`)
- [ ] **V8 — AMD Zlib and microcode, freeform subtype GUID, GIF frames, HP signature blocks** (`ff1b2a0`, `70f0bfe`, `ba5bada`)
- [ ] **V9 — search of the UEFI tree** (`d2111d1`)
- [ ] **V10 — recent files on the empty screen, the window's height, a file under its own name** (`5a46968`, `ba9ebdf`, `0767243`)
- [ ] **V11 — AMI GPNV store** (`1b47662`)
- [ ] **V12 — a compressed branch's bytes in the tree menu** (`166d84c`)

## Order and closing

V1 through V12 as written; where a unit turns out to depend on a later one the
order is changed here and said. When the window is closed `PORT_STATE.json`
moves to `166d84c` and the gap list holds only `later` and `unported`
entries.
