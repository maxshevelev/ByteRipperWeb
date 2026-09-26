# UEFI Structure

> The map of a firmware image: which region, which volume, which file, and where.

@covers panel.uefi
@covers panel.uefi.fix-checksum

**Tools ▸ UEFI Structure** reads the open dump as an Intel/UEFI flash image and shows it as a tree. The title line above the tree says what the image as a whole is.

## The tree

The top level is the layout of the chip itself. On an Intel platform that is the [[term:flash-descriptor|flash descriptor]] and the [[term:region|regions]] it defines — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. Inside the BIOS region are [[term:volume|firmware volumes]], inside those [[term:ffs-file|FFS files]], inside those [[term:section|sections]], and the tree opens a branch at a time as you ask for it.

The **Type** and **Subtype** columns name each node the way the reference parser does. The **Name** column shows the community name for a node's [[term:guid|GUID]] when there is one, and the GUID itself when there is not.

The **ME region** row opens onto the same analysis the [[topic:tool-me|ME Analyzer]] gives, so an image can be read end to end in one tree.

## What the panel checks

- **Checksums.** A header whose checksum does not match is flagged with a red mark, and the detail pane says what the value should be. Right-click the node for **Fix Checksum** — one write, one undo step.
- **Protected ranges.** If the image declares [[term:boot-guard|Boot Guard]] protected ranges, the summary line says how many. Bytes inside them are not yours to change.

## What you can take out

Right-click a node:

- **Open** the node, or just its body, as a [[topic:fragments|fragment panel]].
- **Open Decompressed…** / **Export** for a compressed section — what those bytes actually expand to.

## Padding

A dump is full of erased space between structures. The tree leaves that out unless you tick **Show padding**: padding that holds data is always listed, and so is a volume's free space, because it tells you how much room the volume has left.

See also: [[topic:tool-fit|FIT Table]], [[term:vss|NVRAM stores]], [[topic:recipe-checksums|Checking and fixing checksums]].
