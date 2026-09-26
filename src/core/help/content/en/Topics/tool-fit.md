# FIT Table

> The Firmware Interface Table: what the CPU is told to load before it runs BIOS code, and whether it is still there.

@covers panel.fit

**Tools ▸ FIT Table** finds the [[term:fit|Firmware Interface Table]] in the image and lists its entries.

The FIT sits near the top of the flash and is found through a pointer at a fixed address below `4 GB`. Each entry has an address, a size and a type: a [[term:microcode|microcode update]], an ACM, a Boot Guard manifest, a TXT policy record.

## What the panel does

- **Lists the entries** with their type, address and size.
- **Follows every address** rather than trusting it. The "points at" column says what is actually at that address — a microcode update with a matching header, a manifest, or nothing at all. An entry pointing into erased flash is the classic symptom of a bad patch.
- **Checks the table's own rules**: the header entry, the count, the checksum, entry ordering. Problems are listed rather than guessed at.
- **Microcode** entries are named from an online catalogue of CPU microcode: CPU signature, revision and date. See [[topic:databases|The online catalogues]].

## On the bench

A broken FIT shows up as a board that does not post at all, with no display and often no beep — the CPU never gets a valid microcode update or ACM. If a board died right after a BIOS flash or a hand patch, this panel is where to look first: an entry pointing at `FF FF FF FF` says exactly what happened.

See also: [[topic:recipe-microcode|Microcode on the bench]], [[term:top-swap|Top Swap]].
