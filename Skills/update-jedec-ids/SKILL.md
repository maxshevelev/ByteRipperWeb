---
name: update-jedec-ids
description: Regenerate the web's SPI flash chip catalogue (src/firmware/uefi/jedecIds.ts) from the upstream clone's generated JedecIDs.swift. Use when the VSCC table's chip names, sizes or sources go stale, when the upstream clone moves, or when the weekly refresh pull request needs reading.
---

# Updating the web's chip catalogue

The web's catalogue is a translation of upstream's generated
`Packages/UEFIImage/Sources/UEFIImage/JedecIDs.swift`, not a second read of
the three sources behind it (UEFITool, the Linux kernel's SPI-NOR tables,
flashrom). Upstream's own `update-jedec-ids` skill is the generator of record
and keeps that file current; this one converts it into TypeScript, so the web
cannot drift from upstream's read of the sources. When the sources move,
upstream's regeneration moves first and this one follows.

Run it:

    python3 Skills/update-jedec-ids/scripts/gen_jedec_web.py

with the clone at `$BYTERIPPER_REPO`, or the sibling clone at `../ByteRipper`
when that is empty, or with a path to a `JedecIDs.swift` as the one argument.
It overwrites `src/firmware/uefi/jedecIds.ts` and refuses under a hundred
entries, where the read is truncated or the upstream layout changed — the
right answer there is not a smaller table.

After a regeneration, run the checks (`npm run check`) and commit the table
with its tests: `testTheChipCatalogueIsComplete` in
`src/firmware/uefi/descriptorInfo.test.ts` holds the per-source counts, which
move with the table.

The web's weekly workflow (`.github/workflows/refresh-jedec-ids.yml`) does the
same from the published upstream file and opens a pull request only when the
table changed, never a commit to main and never a PR with no diff.
