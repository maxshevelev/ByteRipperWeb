# ByteRipperWeb — porting the window `9ceb2c4`…`bb5e9a2`

The 175 upstream commits past the baseline `9ceb2c4` (0.9.5), as work units in
dependency order. Each unit is a separate commit that ends with the check
suite green (`npm run check`, the help checks) and its share of `GAPS.md` and
the module map moved; the boxes are ticked as units close. `check_anchors.py`
(nine minutes) runs in the background after a unit, not after every edit.

Standing rules: shared upstream strings word for word, the web's own strings
translated here; help edited in all three languages and re-stamped
(`help-coverage --bless`); anything the browser cannot do is an `unported`
entry with the reason, a test the web has no level for a `later` entry.

**Only the end state ports.** Most of the window is one research branch
(`me-eom-bootguard-research`, merged at `75e747b`) whose answers changed many
times on the way — Manufacturing's verdict was re-worded five times, the strap
tables were Swift literals before they were data. The web takes the code as it
stands at `bb5e9a2`, read against the commits for the reasons.

**The map sources stay upstream** (the owner's decision, 2026-10-29). The six
families of descriptions — strap tables, descriptor registers, ME
configuration, UEP/FPF, GPIO pins, CSME 18 layouts — are maintained there as
JSON under `Packages/*/MapSources/` and compiled by
`Skills/me-eom-structures/scripts/map_bin.py`. The web takes the compiled
`BRM1` binaries as they are, with a reader of its own (upstream's
`Design/MAP_DATA.md`, "The web edition"), and never the JSON, the generators
or the per-generation research. Those paths go to `notApplicable` with that
reason.

The window holds five stories and some housekeeping:

- **The map data** (`5752f744` … `e401a532`): the `BRM1` envelope
  (`Packages/MapData`), its six readers and their version marks.
- **The descriptor's straps and registers** (`564a74e0` … `77292dff`,
  `692f6ae9`, `7143b4f2` … `2a309b9c`): every strap section and register named
  by the tool's own layout, against the value the tool builds, in folding
  tables in the UEFI Structure's detail.
- **The bench's ME verdicts** (`fafe0d01` … `80a22348`, `15c56778`): End of
  Manufacturing, Boot Guard, the OEM public key hash and RPMC as Summary rows,
  and the file system state keyed on the identity selector.
- **The ME configuration** (`04a30c2e` … `4214cde8`): a Configuration tab
  reading both copies of every file (FITC and MFS) through MFIT's own maps, the
  FPF/UEP settings, the GPIO feature pins and CSME 18's MIP/CPU/SPHY layouts —
  with a `?` per setting and the detail list's second value column.
- **The window's chrome** (`e729716c` … `bb5e9a2c`, `b93865e0`, `3df91c7a`,
  `375373a8` … `393b4b6f`, `5efe8b1f`): every drop zone shown during a drag,
  a fragment panel opening with its minimap hidden, the help popovers' one flat
  shape, the agent relay that outlives the app.
- Housekeeping: test-only commits, research notes, the help's re-blessing.

## Units

- [x] **M1 — the map data: the `BRM1` envelope, the six binaries, their version marks and the sync script**
- [x] **M2 — the strap tables: `StrapMap`, `StrapMapData`, and the descriptor's every strap section**
- [x] **M3 — the descriptor's registers: `DescriptorRegisterMap`, `DescriptorRegisterMapData`**
- [x] **M4 — the descriptor in the UEFI Structure's detail: folding strap tables, registers, the BIOS access verdict**
- [x] **M5 — the bench's ME verdicts in the engine: Manufacturing, Boot Guard, the OEM key hash, RPMC, the file system state**
- [ ] **M6 — the ME configuration in the engine: configuration, UEP/FPF, GPIO, CSME 18 layouts**
- [x] **M7 — the detail list's second value and a row's `?`** (`ToolFieldList`)
- [ ] **M8 — the ME panel: the verdict rows, the Configuration tab, the tab kept by name, the agent's evidence**
- [ ] **M9 — the help popovers: one flat shape sized to its words, the panels' type, the zoom**
- [ ] **M10 — the drop zones: every zone a drag can land on, refused zones never shown**
- [ ] **M11 — a fragment panel's minimap and the zoom**
- [ ] **M12 — the agent relay outlives the app**
- [ ] **M13 — closing the window: housekeeping, the map, `GAPS.md`, the baseline at `bb5e9a2`, the version**

M1 → M2 → M3 → M4 and M1 → M5 → M6 → M8 are chains; M7 comes before M8.
M9 through M12 depend on nothing in the window and may run in any order.

### M1. The map data

`Packages/MapData/MapFile.swift` as `src/firmware/mapData/mapFile.ts`: the
32-byte header, the section table, the string pool, the bounds-checked record
arrays, FNV-1a over the file with the checksum zeroed, and `MapDataError`
(`resourceMissing`, `badMagic`, `unsupportedFormat`, `versionMismatch`,
`wrongKind`, `corrupt`). `MapFileTests` comes with it.

The binaries come across byte for byte into `src/firmware/mapData/data/`
(`StrapMaps.bin`, `RegisterMaps.bin`, `ConfigMaps.bin`, `UEPMaps.bin`,
`GPIOMaps.bin`, `LayoutMaps.bin`), and the six version marks upstream
generates into `*DataVersion.swift` are one generated TypeScript module
(`mapDataVersions.ts`). A stdlib script in `Skills/port-from-byteripper/`
copies the binaries and writes the marks from upstream's own `*DataVersion.swift`,
and `--check` fails when the web's pair differs from upstream's — run with the
port report, so a stale binary is reported, never shipped.

Where the bytes come from is a source behind an interface, as every data source
here is: the firmware worker fetches a family's binary once, lazily and
single-flight, from the URL Vite gives it (it ships with the build, so it is
not a network dependency and needs no `Freshened`); a test reads the file from
disk. A family that will not read — missing, stale, corrupt — is no map, which
every panel already shows.

Module map: `Packages/MapData` → `src/firmware/mapData`;
`Packages/*/MapSources/` and `Skills/me-eom-structures` → `notApplicable`
(sources and generators maintained upstream); the `*DataVersion.swift` files →
the generated marks.

### M2. The strap tables

`StrapMap` (the field, its bits, its default and options, the word it lives in,
the section's `set`, how a field's value is read and spelled) and
`StrapMapData` (kind 1 over the envelope, the map order the reader returns,
the lookups by id and by set and length) with `StrapMapTests` and
`StrapMapDataTests`.

`DescriptorInfo` gains what the window added to the descriptor read: the
processor strap section where the descriptor holds one (`bdf1b2ce`, `1f366617`,
`e09ebe77`), the OEM section and Alder Point S's strap lengths (`30c9c44b`),
the MIP table and the PMC soft straps (`7276ea75`, `3fdd45f5`), the CPU strap
message where Tiger Point and later keep it (`fe284739`), Meteor Lake's 130-word
SoC block (`8da7dc01`), the SPT tables of FIT 11 (`3955d37f`, `c922f862`) and
the legacy guides' tables for Ibex Peak, Cougar Point and Lynx Point (`77292dff`,
`94b4815e`). `DescriptorInfoTests` and `TestImage` come with it.

### M3. The descriptor's registers

`DescriptorRegisterMap` (a register's place — absolute, from `FCBA << 4`, from
`FMBA << 4` — its words and its fields) and `DescriptorRegisterMapData` (kind
5) for Sunrise Point, Cannon Point, Tiger Point, Elkhart Lake, Jasper Lake and
CSME 18 (`8388d913`, `5567d8bc`, `fac05911`, `13e4a42a`), with
`DescriptorRegisterMapDataTests`; `DescriptorGeneration` and
`DescriptorParser`'s share of the window.

### M4. The descriptor in the UEFI Structure's detail

`UEFINodeDetail` and `DetailTableView` as the web's detail tables: every strap
field a row against the value the tool builds (`bf152e59`), the fields folded
under their word and named by what they share (`97702272`), a value the build
set in bold and its word's line counting them as "Non-default: n" (`03012460`,
`dc203347`, `f98494c1`), each section carrying its column names and measuring
its own columns, the Field column's constant width with wrapping beyond it
(`10f0c9c2`, `59114292`, `a73729a5`, `7704cf46`, `61b251c5`), a gap after an
open section (`bb72d55f`), a new file's tables folded (`bd54fb51`), a dash for
a strap with no default (`0a33e331`), a double click that opens a section and
leaves it open (`0ed0a09f`); the registers' tables; the BIOS access masks read
as a verdict under their table, drawn in the ordinary colour (`692f6ae9`,
`318ac109`, `2a309b9c`); a reveal that brings the selected row back on screen
and whose scroll is tied to its row (`7143b4f2`, `5059b76e`).
`DescriptorDetailTests` and `TestUEFI` come with it; the flow tests in
`UEFIToolFlowTests` are anchored or `later`. Help: `tool-uefi.md` and
`Terms/uefi.md`, three languages.

### M5. The bench's ME verdicts in the engine

`Manufacturing.swift` (the `/home/mca/eom` and `/home/mca/eom_config` records,
the OEM Configuration's copy, `ManufacturingState`, `ManufacturingBasis`, the
board's own record as a fact of its own — `80a22348`), `BootGuard.swift` (the
profile from the CDMD JSON and from the UEP bits on CSME 12 to 16, CSME 13's
third container), the OEM public key hash in its established shape and the four
findings it can be (`4632524b`, `def04b3f`, `9de27fb0`), the RPMC binding
(`9ee1f8b2`), `FlashDescriptor.biosMaster` and the descriptor page the analysis
is handed, the `IFWI` and `FPT` additions; `MFS`'s state keyed on
`vfsStartsAtZero` rather than the FTBL triple (`15c56778`); `FirmwareAnalysis`
and `MEFirmwareAnalyzer` with the engine's model revision. `ManufacturingTests`,
`MFSTests`, `FPTTests`, `FirmwareAnalysisTests`. `MEReads` hands the descriptor
bytes over (`fafe0d01`).

### M6. The ME configuration in the engine

`MEConfigurationMap` and `MEConfigurationData` (kind 2: files, settings, a
condition and a `disabledBy`, the map of a board's own half of a generation —
`d823a3c1`), `ConfigurationDecoder` (both copies of every file, the FITC record
and the MFS file — `c378ee44`; a conditionally placed setting read from the
branch the image holds — `f52a285d`; a file that is one setting — `14ad4b96`,
`df99d567`; `manuf_lock` in both — `e894e679`), `UEPMap` and `UEPMapData`
(kind 3; the FPF settings an image's UEP area records — `79ad4d8d`, CSME 18's
second array — `a799dd47`), `GPIOPinMap` and `GPIOPinMapData` (kind 4;
`8a8197a1`), and CSME 18's three layouts over `LayoutMapData` (kind 6:
`MIPStrapMap`, `CPUStrapMap`, `SphyNvarMap` — `e356c107`, `d2c9a5bf`,
`997a0a25`, `4ce4c961`, `4214cde8`). `ConfigurationMapTests`, `UEPMapTests`,
`UEPMapDataTests`, `GPIOPinTests`, `GPIOPinMapDataTests`, `LayoutMapDataTests`,
`MEConfigurationDataTests`, `MIPStrapMapTests`, `CPUStrapMapTests`,
`SphyNvarMapTests`.

### M7. The detail list's second value and a row's `?`

`ToolFieldList` (the web's `DetailFields`): a field with a second value drawn
as a column equal to the first, part 2 of the row for the selection and the copy
(`ff5526e3`); a row's `?` after a setting's name, opening the setting's help
from the map, with an arrow pointer over it, closing with the rows, its
condition as the popover's subtitle (`aff4032d`, `b8f4dafe`, `e457ddd2`,
`41d61cd6`, `60014e53`); a clicked value keeps its drawing (`1d3314ea`).
`ToolFieldListTests`.

### M8. The ME panel

`MEABenchFactsText`, `MEAStateBasisText`, `MEAConfigurationText`, the
`MEACurator` and `MEATones` additions, `MEASummary`'s rows — Manufacturing (EOM
on First Boot, English in every language, the evidence in brackets), the
board's End of Manufacturing record, Boot Guard, the OEM public key hash byte by
byte, RPMC Hardware Binding (loading until the file table names its file), the
File System State's evidence in brackets, the bench's tones — and
`MEAConfiguration`. The panel: a Configuration tab between Summary and Full
Info, one list per file with FITC and MFS columns and only the file system's
value bold where they disagree (`10703554`), "reading" while the reading is on
(`3b0c5174`); the tab kept in the workspace by name (`544dc969`); the review
fixes (`9fda006a`, `d2461188`'s share). `MEAAgentQueries`' evidence for the two
verdicts (`AGENT_PROTOCOL.md`, `0527f2e5`). `MEASummaryTests`,
`MEACuratorTests`, `MEAAgentQueriesTests`; `MEAToolFlowTests` anchored or
`later`. Help: `recipe-me-check.md` and the ME terms, three languages.

### M9. The help popovers

`HelpPopoverLayout` and `HelpPopoverController` (new upstream), `HelpTermPopover`,
`HelpText`, `HelpBodyView`: every help popover one flat shape sized to its words,
no scroll where the words fit, set in the panels' type and following the zoom,
a note that wraps, a closed popover that lets go (`375373a8`, `5b42decf`,
`dd0fc444`, `393b4b6f`, `d99f0af7`). `HelpUITests`.

### M10. The drop zones

A file over the window shows every zone it can land on and lights the one under
the pointer (`e729716c`); a pane drag the same, a refused zone never shown and
one under the pointer leaving the others up (`2ac8bb92`, `03d46de1`); idle
zones with a firmer edge, 10 pt in, rounder corners, the hovered one the calm
blue (`4972319f`, `36ab4af7`, `bb5e9a2c`). The macOS 26 glass is AppKit's
material: its intent (a clear zone over the content) ports, the material is
`n/a`. `FileDragZonesTests`, `PaneDragTests`, `ToolPanelDropTests` anchored or
`later`. Help: `opening-files.md`, three languages.

### M11. A fragment panel's minimap and the zoom

A fragment panel opens with its minimap hidden and the minimap button reads the
one in front (`b93865e0`); Zoom to Fit with a panel up counts the panel's side
margins (`3df91c7a`); a dock change asked for without animation has none
(`a19810b3`). `FragmentMinimapTests`, `ZoomToFitTests`. Help: `fragments.md`.

### M12. The agent relay outlives the app

The relay answers each request with the reason while the app is gone and
attaches again when it comes back, launching the app at most once
(`5efe8b1f`): `desktop/relay.cjs`, and the endpoint's serving a client that
sent `initialize` on an earlier connection (`AgentEndpoint`,
`AgentEndpointTests`); the review's fixes to both (`d2461188`).
`AgentRelayInstall` — a copy of the helper beside the socket, so the path a
configuration names outlives a DerivedData build — is read against the shell's
installed and portable builds and ported or declared `n/a` with the reason.
`Skills/agent-socket` is upstream's own debugging script for its socket; it is
mapped, and ported only if the shell's endpoint speaks the same lines. Help:
`agent.md`, three languages.

### M13. Closing the window

`fa2b1c1a` and `eb35f9ef` are test timing upstream; `5a870831` and `f2722fe9`
re-bless upstream's help; the research notes (`Design/ME_STRUCTURES.md`,
`Skills/me-eom-structures`, `Skills/sync-mea-engine`'s references) are read,
not copied. The module map's statuses, `GAPS.md`'s row for the window, the
anchor check clean, `--set-base bb5e9a2c`, and the version (`release.py
version`).
