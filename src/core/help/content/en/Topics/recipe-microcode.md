# Microcode and the FIT

> What the FIT Table tool reports about the microcode an image carries, and what its editing commands do to the table.

The processor loads a [[term:microcode|microcode update]] before it executes any firmware code, and finds it through the [[term:fit|Firmware Interface Table]]. The table is therefore a structure whose entries are absolute addresses into the image, and a component named by such an entry cannot be moved without the entry being corrected.

**Tools ▸ FIT Table** locates the table and reports it. The tool itself is described in [[topic:tool-fit|FIT Table]]; this page covers what its columns report and what its commands change.

## What the columns report

- **Type**, **Address** and **Size** are read from the entry.
- **Points at** is not read from the entry. The tool follows the address and reports what is actually at it: a microcode update with a valid header, a manifest, an erased area, or nothing recognisable. An entry that points at an erased area is an entry whose component is absent from the image.
- A microcode entry is additionally named from the online catalogue by its processor signature (CPUID), revision and date. The catalogue is described in [[topic:databases|The Online Catalogues]]; without network access the tool reports the identifiers and omits the names.

The list below the table holds the problems found against the rules of the specification: the header entry, the entry count, the table checksum, the ordering of entries by type, the alignment of addresses, the reserved byte, and the agreement between the table and its Top Swap backup where the image keeps one. Double-clicking a problem moves the dump to the bytes it concerns.

## Reading the microcode entries

The catalogue name makes two properties of the image legible:

- **Which processor signatures the image carries microcode for.** A board that has been fitted with a processor of a newer stepping than the firmware was built for carries no microcode for the signature in its socket. Which signature a given processor reports is a property of the processor, and the program does not read it — it reports only what the image contains.
- **Which revision of each microcode the image carries.** The revision and date can be compared with the catalogue's newest entry for the same signature.

## Adding a microcode

**Add Microcode…** in the panel's header opens a list of Intel microcodes fetched from the `platomav/CPUMicrocodes` collection on github.com, with the columns CPUID, platform, revision, date, release and size. **Only CPUIDs in this image** restricts the list to the signatures the open image already carries. **Choose File…** takes a microcode from a local file instead, and requires no network access.

A file offered from either source is validated before anything is written: it must begin with an Intel microcode header, and its checksum must agree.

What the command then does:

1. It places the component immediately after the last microcode of the run, where the next one belongs by the specification. Where the file holding the run has no room left inside it, the free space or erased padding **directly adjacent to that file** is used, and the file itself is extended to cover the new component, so that the component sits inside a structure rather than loose in the volume.

   Where something else lies directly behind the file — a neighbouring file, say — the command refuses rather than looking elsewhere in the volume. A component dropped into arbitrary free space is read as a file that is not one the next time the volume is parsed, and the tree after that is nonsense.

   The search moves only through the structures that contain the microcode run, so neither a neighbouring region nor a neighbouring structure is touched.
2. It writes a new entry into the table, using an empty slot where the table has one and extending the table into the sixteen free bytes after it where it has not.
3. It corrects the header's entry count and the table checksum.

**The file does not change length.** The operation is one undo step ([[key:undo]]), and either lands complete or is refused with the reason.

## Replacing and removing

The context menu of a microcode row holds **Replace Microcode**, **Remove Microcode**, **Copy CPUID** and **Go to Offset**; the header row holds **Fix Checksum**.

- **Replace Microcode** exchanges the component the row names for another of any signature. The row remains; components behind it move if the new component is of a different size, and the entries naming them are corrected.
- **Remove Microcode** takes the entry out of the table, moves the components behind it up into the freed space and erases the bytes at the end of the run. A table must retain at least one microcode entry.

Adding, replacing and removing are supported for microcode entries only. Entries of other types — an ACM, a Boot Guard manifest, a policy record — the tool reports and checks, but does not change.
- **Fix Checksum** writes the checksum the header should carry.

## When a change is refused

The tool refuses rather than writing a change it cannot make correctly, and states which rule it is refusing on:

- the file offered is not a microcode image, or its checksum does not agree;
- the table holds no microcode entry to place a new one after, so where the image keeps its microcode cannot be established;
- the table has no empty slot and the bytes after it are not free, so it cannot grow; the tool reports what occupies them;
- the run would have to grow further than there is room for; the tool reports how much more it needs and what it would have to grow through;
- the change would write inside the [[term:boot-guard|Boot Guard]] [[term:ibb|IBB]], which the processor verifies before the firmware runs;
- the image keeps a [[term:top-swap|Top Swap]] backup of the block the table is in and the two copies are not identical, so one change cannot be correct for both; or a write would reach across a Top Swap block boundary.

Where the image does keep an identical Top Swap backup, changes are made in both copies, and the tool says so.

! A change written into a range the firmware verifies is reported by the tool as such. Whether a given platform accepts the resulting image is decided by that platform at start-up and is outside what any editor can report. See [[topic:flash-writes|Who Writes to the Flash]].

See also: [[term:top-swap|Top Swap]], [[topic:recipe-checksums|Checksums]].
