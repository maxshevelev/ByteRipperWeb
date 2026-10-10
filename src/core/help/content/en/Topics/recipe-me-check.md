# Reading the ME Region Report

> What the two tabs of the ME Analyzer panel report, and how the individual rows of the summary are to be read.

@covers panel.me.state-basis

**Tools ▸ ME Analyzer** analyses the [[term:me-region|ME region]] of the image in its pane and reports the result on two tabs, **Summary** and **Full Info**. The tool itself is described in [[topic:tool-me|ME Analyzer]]; this page covers the content of the report.

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

Rows the analysis cannot answer for the family in question are left grey rather than filled with a guess.

## File System State

The row reports the state of the [[term:mfs|MFS]] file system inside the region. It is shown only for the families that have one. It takes three values, and the criteria by which the parser decides between them are the following.

**Initialized.** Either the volume holds at least one of the low-level files with the indices 0–5 or 8, or an EFS volume in it holds file content. This is the state of a region in which the engine has run and written its own files.

**Configured.** The volume holds no such file, but holds a low-level file with index 7 or 9 — the OEM configuration and the Home Directory — or the image holds a configuration written by Intel's Flash Image Tool: a populated `fitc.cfg` module, or a `FITC`, `CDMD` or `MFSB` partition. This is the state of a region that has been given a configuration but in which the engine has not yet run.

**Unconfigured.** Neither of the above applies. This is the state in which the firmware leaves the manufacturer of the platform, and the state of a region whose file system has been removed.

A transition connects the states. The first power-on of a board carrying a clean region in the **Configured** state, with a working chipset, initializes it: the engine creates the files and binds the region to that chipset, which is to say moves it to **Initialized**.

Two qualifications apply to the criteria:

- On CSME 15 and 16 the volume names its files through its own tables rather than by index, so the parser claims nothing from the file indices there. Such a volume is decided by the two remaining rules only.
- A fourth value, **Error**, exists in the upstream project for the case of the analysis failing outright. The decoders used here do not raise it.

Directly under the state, on the **Summary** tab and in the **Firmware** row of the **Full Info** tab alike, **State basis** says which of the three criteria decided it and what the others found. The value of the state is the upstream project's; the basis is this tool's own. The basis is drawn as a warning, and the state itself is then never drawn in green, when a criterion that could have raised the state could not be checked — most often an EFS partition listed in the partition table whose volume could not be read, for instance because its system page has been erased. **Configured** then means only that the configuration was found: whether the EFS holds files written by the engine, which would make the state **Initialized**, is unknown, and the EFS partition is to be examined before the state is relied upon.

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
