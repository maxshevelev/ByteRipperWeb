# UEFI Structure

> The map of a firmware image: which region, which volume, which file, and where.

@covers panel.uefi
@covers panel.uefi.fix-checksum
@covers panel.uefi.top-swap
@covers panel.uefi.save-node

**Tools ▸ UEFI Structure** reads the open dump as an Intel/UEFI flash image and shows it as a tree. The title line above the tree says what the image as a whole is.

## The tree

The top level is the layout of the chip itself. On an Intel platform that is the [[term:flash-descriptor|flash descriptor]] and the [[term:region|regions]] it defines — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. Inside the BIOS region are [[term:volume|firmware volumes]], within those [[term:ffs-file|FFS files]], and within those [[term:section|sections]]. A branch is decoded when it is opened rather than in advance.

The **Type** and **Subtype** columns name each node as the reference parser names it. The **Name** column gives the community name for the node's [[term:guid|GUID]] where one exists, and the GUID itself where none does.

The **ME region** row opens onto the same analysis the [[topic:tool-me|ME Analyzer]] gives, so an image can be read end to end in one tree.

## What the tool checks

- **Checksums.** A header whose checksum does not agree is marked in red, and the detail list reports both the stored value and the correct one. **Fix Checksum** in the node's context menu writes the correct value as one write and one undo step.
- **Protected ranges.** Where the image declares [[term:boot-guard|Boot Guard]] protected ranges, the summary line reports how many. A signature over such a range cannot be recomputed without the manufacturer's private key; see [[topic:recipe-checksums|Checksums]].

## What you can take out

Right-click a node:

- **Open** the node, or just its body, as a [[topic:fragments|fragment panel]].
- **Save … as…** the node, or just its body, to a file: the same bytes **Open** shows, under the same name — the dump's, followed by the node's. The browser stores the file as it stores any download: in its downloads folder, or where it asks.
- **Open Decompressed Body** / **Export Decompressed Body…** for a compressed section — what those bytes actually expand to. A node inside one offers the same for its own **Bytes**.
- **Go to Top Swap Copy** / **Go to Original** for a node in either block of an image with a [[term:top-swap|Top Swap]] copy — selects the same node in the other block and shows its bytes in the dump, so that each part of the copy can be matched with the part of the top block it duplicates.

## Padding

A dump holds erased space between its structures. The tree omits it unless **Show Empty Padding** is ticked. Padding that holds data is listed in either case, as is a volume's free space, which reports how much room remains in that volume.

See also: [[topic:tool-fit|FIT Table]], [[term:vss|NVRAM stores]], [[topic:recipe-checksums|Checksums]].
