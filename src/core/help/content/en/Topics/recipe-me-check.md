# Reading the ME Region Report

> What the two tabs of the ME Analyzer panel report, and how the individual rows of the summary are to be read.

@covers panel.me.state-basis
@covers panel.me.manufacturing

**Tools ▸ ME Analyzer** analyses the [[term:me-region|ME region]] of the image in its pane and reports the result on three tabs, **Summary**, **Configuration** and **Full Info**. The tool itself is described in [[topic:tool-me|ME Analyzer]]; this page covers the content of the report.

The row labels of the summary are in English in every language of the interface. They are the labels of the `MEA.py` script of the ME Analyzer project, from which this analysis is derived, and they are left unchanged so that a report can be compared with that project's output. See [[topic:provenance|Where This Knowledge Comes From]].

## When no firmware is reported

The tool reports that nothing in the file reads as Intel ME firmware in three distinct cases, which it does not distinguish between:

- the image holds no ME region — an AMD platform, a platform older than the ME, or a dump of a different chip;
- the descriptor declares an ME region whose content has been erased. The [[topic:tool-uefi|UEFI Structure]] tool reports the declared region, and the hex view shows whether it consists of `FF`;
- the region is present but its beginning is damaged to the point where the [[term:fpt|$FPT]] table is not found.

## The summary rows

- **Family**, **Version**, **SKU**, **Release**, **Date** — read from the manifest and the partition table. The version identifies the generation of the platform the firmware was built for.
- **Type** — whether the image is a complete firmware, an update, or a region extracted from a complete image.
- **Chipset**, **Chipset Stepping**, **NVM Compatibility** — the platform the firmware declares support for.
- **TCB Security Version Number**, **ARB Security Version Number**, **Version Control Number** — the counters the platform uses to refuse firmware older than the one already accepted. See [[term:svn|SVN]] and [[term:vcn|VCN]].
- **Production Ready** — whether the firmware is a production build or a pre-production one.
- **OEM Configuration** — whether the image carries a manufacturer's signing key or an unlock partition.
- **FWUpdate Support** — whether Intel's own update utility can rewrite this image in place.
- **Size** — how far the firmware reaches from its `$FPT`. This is a property of the firmware, not the length of the region or of the file.
- **Flash Image Tool** — the version of Intel's Flash Image Tool that the image was built with, where the image records it.
- **File System State** — described in the next section.
- **EOM on First Boot** — the verdict with, in brackets after it, the two facts it was read from, described in the section after this one. **Manufacturing Lock**, **Boot Guard**, **RPMC Hardware Binding** and **OEM Public Key Hash** are read there too.

Rows the analysis cannot answer for the family in question are left grey rather than filled with a guess.

## File System State

The row reports the state of the [[term:mfs|MFS]] file system inside the region. It is shown only for the families that have one. It takes three values, and the criteria by which the parser decides between them are the following.

**Initialized.** Either the volume holds at least one of the low-level files with the indices 0–5 or 8, or an EFS volume in it holds file content. This is the state of a region in which the engine has run and written its own files.

**Configured.** The volume holds no such file, but holds a low-level file with index 7 or 9 — the OEM configuration and the Home Directory — or the image holds a configuration written by Intel's Flash Image Tool: a populated `fitc.cfg` module, or a `FITC`, `CDMD` or `MFSB` partition. This is the state of a region that has been given a configuration but in which the engine has not yet run.

**Unconfigured.** Neither of the above applies. This is the state in which the firmware leaves the manufacturer of the platform, and the state of a region whose file system has been removed.

A transition connects the states. The first power-on of a board carrying a clean region in the **Configured** state, with a working chipset, initializes it: the engine creates the files and binds the region to that chipset, which is to say moves it to **Initialized**.

Two qualifications apply to the criteria:

- On CSME 15, CSME 16 and CSME 13.30 the volume's files begin at offset 0 of the system area, so its file indices say nothing and the parser claims nothing from them. Such a volume is decided by the two remaining rules only. A volume that names its files through its own tables yet begins them past offset 0 — a CSME 14 image built that way — is read by index like any other, the tables serving only to name its files.
- A fourth value, **Error**, exists in the upstream project for the case of the analysis failing outright. The decoders used here do not raise it.

On the **Summary** tab and in the **Firmware** row of the **Full Info** tab alike, the state carries what it was read from **in brackets after it**, as the **EOM on First Boot** row carries its own: `Configured (configuration: FITC, CDMD)`, or `Initialized (EFS: holds files)`. The clauses name the criterion that decided it — `reserved files: 2, 8`, `EFS: holds files`, `configuration: …`, `nothing found` — and then any criterion that could not be checked. The state itself is drawn in its own colour and the brackets in the ordinary one, because they are evidence and not a second answer. Where a criterion that could have raised the state could not be checked — most often an EFS partition listed in the partition table whose volume could not be read, for instance because its system page has been erased — the clause `EFS: unreadable` says so, and the state is then never drawn in green. **Configured** then means only that the configuration was found: whether the EFS holds files written by the engine, which would make the state **Initialized**, is unknown, and the EFS partition is to be examined before the state is relied upon.

## Manufacturing, Boot Guard and the OEM public key hash

Five further rows answer, from the dump alone, what is asked before an image is written to a board. None of them is the upstream project's. Like every row of the **Summary** tab, they are named in English in every language of the interface, and so are their values.

**EOM on First Boot** — whether the platform closes End of Manufacturing on the first boot of a board carrying this image. Two things decide it, and the second is the one manufacturers normally rely on:

- the **access rights in the flash descriptor**. A serial image leaves the host CPU / BIOS master with the factory rights rather than the all-ones of a service image that lets the host rewrite every region, and the platform closes Manufacturing on its first boot. This is how End of Manufacturing was done before Flash Image Tool grew the setting below, and it is still how serial images that carry no setting are done;
- the **`EOM on first boot` setting** — `CsePlugin:EomNvar`, bit 0 of the MFS file `/home/mca/eom_config` — an explicit order on top of that. Manufacturers do not set it; it is set deliberately in Flash Image Tool.

A clear setting therefore does not mean Manufacturing stays open: it means the descriptor answers. The row takes these values:

- **Will close on the EOM flag** — the setting is enabled. Flash Image Tool was told to close Manufacturing on the first power-on after this image is written, and the row below says what that will lock.
- **Will close on the descriptor's rights** — the setting is clear or absent, and the descriptor carries the factory rights: the platform closes Manufacturing on its first boot by itself. This is the serial image, and the one a manufacturer's dump carries.
- **Will not close** — the setting is clear and the descriptor's access rights are open. This is the image a bench prepares for itself when it wants the machine to boot on and stay workable.
- **Will close on the EOM flag, with the descriptor open** — the setting is enabled while the descriptor's access rights are open. Flash Image Tool refuses to build such an image, so the two were put there by another tool or by hand.
- **Not readable from this image** — the setting is clear or absent and no flash descriptor was read with the region, which is what an ME region extracted on its own looks like. What its access rights would say is then unknown.
- **No such switch in this firmware** — a generation that does not decide this at all: before CSME 11, whose descriptors are the ones the rights are read from. The Summary tab omits the row entirely for those.

The verdict carries what it was read from **in brackets after it**: `Will not close (EOM: off, descriptor: open)` — the flag as the image has it, and whether the descriptor's access rights are open or locked. The verdict itself takes the row's colour; the brackets are drawn in the ordinary font and colour, because they are evidence and not a second answer. A fact the image could not supply is left out of the brackets rather than replaced by a dash: an image with no such record says so in the verdict itself.

What End of Manufacturing commits is the image's own `FlexibleEomSettings` — a field of the same configuration file as the flag, in Flash Image Tool's four values, and stored whether or not the flag is set: an image that will not close still says what it would lock if it ever ran.

The verdicts are drawn in colour. A machine that will **not** close Manufacturing boots on and can still be worked on: green. One that **will** close, and one whose setting is enabled with the descriptor open, are drawn in the same tone the file system state is drawn in for **Initialized** — the image is committing itself, and what is written after that is final. A row that only says the image carries no record is drawn plain.

**Manufacturing Lock** — what the *board the dump was taken from* has already done. The platform writes this byte of its file system itself, and a build leaves it alone: **Locked** — the board has been through End of Manufacturing — or **Not locked**. A byte of any other value is given as it stands. The row is shown where the file system names its files through a file table; a board that never wrote the record shows a dash. It says nothing about the board the image is about to be written to: **EOM on First Boot** answers for that one.

**Boot Guard** — the profile the image is built for, as Flash Image Tool, MEInfo and the repair tools print it: `0 - No_FVME`, `3 - VM`, `4 - FVE` or `5 - FVME`, the abbreviations standing for verified and for measured boot. The profile is the one the platform burns into the chipset's fuses when Manufacturing closes, and the fuses cannot be taken back, which is why it is worth reading before an image is written. The row reports the profile the image carries. The image keeps it in one of two places, and both are read: an image built by MFIT carries a record of it in the CDMD partition's configuration, and an image built by the older Flash Image Tool carries the four settings themselves, as bits of its UEP area — in the area's own record on CSME 12, 13 and 14, whose offset within its record differs by generation, and in its first bit array on CSME 15 and 16. A generation whose container is neither is reported as carrying no profile record rather than guessed at. (A CSME 16 image carries both, and the two agree.) An image that carries neither is reported as **No profile record in this image**, and the profile has to be taken from the board itself with MEInfo. No row reports what a board will do when the image and the fuses disagree, because nothing in the dump says what the fuses hold.

**RPMC Hardware Binding** — on CSME 13 and later, whether the platform binds the flash chip to the chipset: Flash Image Tool's *Hardware Binding* setting, as the image's file system keeps it. **Disabled** — the board takes a new flash chip — is drawn green, **Enabled** in the tone of a committed state. An image that keeps no such record reads **Not recorded in this image**.

**OEM Public Key Hash** — the hash of the public key the manufacturer's signing key manifest is signed with, in the ME region: a SHA-384 on CSME 15 and later (96 hexadecimal digits) and a SHA-256 on CSME 12 to 14 (64 digits), each read out of the record its generation keeps it in. It is the value Flash Image Tool's *OEM Public Key Hash* setting carries and the repair tools print in their reports; two dumps of the same board carry the same hash, and it is what a key manifest is checked against. A key belongs to one manufacturer, so a value two vendors' images appear to share is a wrong reading by definition, and the row reads the field the value sits in rather than searching the region for likely bytes.

Where that field holds no key, the row says which of three findings it is, because they are three different states of a boot chain:

- **Not set (all zeros)** — the setting is there and is the all-zero one: Flash Image Tool's own "OEM signing is disabled when this hash is set to all 0s". Signing of the key manifest is switched off.
- **Not set (the area is erased)** — the field is `FF`: nothing was ever written there. This is what a region that was never configured looks like.
- **Layout not recognized** — the field holds something else, or the area has no entry where this one expects it: the image's layout is not one this tool reads, and nothing is claimed about its key. An older generation whose area is laid out differently answers this, and so does a region with no such area at all.

## Moving a region to another board

A region in the **Initialized** state holds more than settings written by the engine on one particular board. The files of its [[term:mfs|MFS]] file system are protected by an [[term:integrity-table|integrity table]], and some of them are encrypted as well, integrity and confidentiality being protected by separate keys. Those keys derive from the [[term:svn|SVN]] and from a root secret held in the chipset's fuses, unique to the individual part; that secret is not in the image. The binding is established at initialization — at the first power-on of a board carrying a region in the **Configured** state.

Moving an initialized region to another board is therefore incorrect in itself. Two limits apply, and they are independent of each other:

- **The data are bound to one part.** A region transferred whole and unaltered remains another chipset's region: a different chipset derives different keys and does not accept the protected files. An identical board model and an identical chipset model make no difference — the secret is unique to the part, not to the model.
- **Editing is detected separately.** The engine verifies integrity before it starts, so a region altered in place is rejected whoever it belongs to.

The state in the row is the fact the tool reports. What a board will do with a foreign region is not: there is no single outcome, and it depends on the generation of the chipset, on the particular board and on its system configuration. The repair community reports a slow power-on, individual functions not working afterwards, a reset on a timer, and on current chipsets no power-on at all.

An **Unconfigured** region from a manufacturer's update package carries no per-board values at all, including those of the board the firmware was built on.

Intel's **Flash Image Tool**, part of the manufacturer's CSME kit, is the tool that produces a configured region from a firmware image and a configuration file. It is named here because the **Flash Image Tool** row reports its version, and because the `fitc.cfg` module it writes is one of the criteria above. It is not related to the [[term:fit|Firmware Interface Table]], which the [[topic:tool-fit|FIT Table]] panel reads, despite the shared abbreviation.

! ByteRipper does not build ME regions, does not configure them and does not write to a board. It reports what the region in the open file contains.

## The Full Info tab

The tab holds the structures the analysis decoded, as a tree in which every row corresponds to actual bytes of the file:

- **[[term:fpt|$FPT]]** — the partition table, listing the partitions the region declares, with their addresses and lengths. A partition whose bytes are not present, or whose declared length does not agree with the region, is reported as such.
- **[[term:cpd|Code partitions]]** and their modules.
- **[[term:manifest|Manifests]]** and their extensions.
- **[[term:mfs|MFS]]** — the file system and its configuration, which is where the **File System State** above is decided.
- **[[term:oem-config|OEM configuration]]** and **[[term:utok|unlock tokens]]**, where present.

Selecting a row scrolls the dump to those bytes and outlines them. The detail list under the tree holds the fields of the selected structure's header. An erased partition, or one of zero length, is shown in grey: it is a declared place in the layout that holds nothing.

## Copying the report

The two buttons in the tab bar copy the **Summary** tab either as text or as an image of the panel.

The glossary explains the terms the tool uses: select a row and press **?** beside the detail list to open the article for that row.
