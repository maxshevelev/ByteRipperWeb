# UEFI Structure

> The map of a firmware image: which region, which volume, which file, and where.

@covers panel.uefi
@covers panel.uefi.fix-checksum
@covers panel.uefi.top-swap
@covers panel.uefi.save-node
@covers panel.uefi.picture-preview
@covers panel.uefi.superseded-entries
@covers panel.uefi.filter
@covers panel.uefi.variable-history
@covers panel.uefi.variable-value
@covers panel.uefi.reveal
@covers panel.uefi.map-regions

**Tools ▸ UEFI Structure** reads the open dump as an Intel/UEFI flash image and shows it as a tree. The title line above the tree says what the image as a whole is.

## The tree

The top level is the layout of the chip itself. On an Intel platform that is the [[term:flash-descriptor|flash descriptor]] and the [[term:region|regions]] it defines — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. Inside the BIOS region are [[term:volume|firmware volumes]], within those [[term:ffs-file|FFS files]], and within those [[term:section|sections]]. A branch is decoded when it is opened rather than in advance.

The **Type** and **Subtype** columns name each node as the reference parser names it. The **Name** column gives the community name for the node's [[term:guid|GUID]] where one exists, and the GUID itself where none does.

The **ME region** row opens onto the same analysis the [[topic:tool-me|ME Analyzer]] gives, so an image can be read end to end in one tree. It opens as soon as the region has been read; values that wait for a database read **Loading…** there as they do in the ME Analyzer.

**The reveal button** on the right of the title row shows in the tree the node under the caret in the dump — the start of a selection where there is one. It opens the branches on the way, and a branch not yet decoded is decoded for it, so the reveal can take as long as that read. It then selects the innermost node whose range holds the byte. A byte of the ME region is shown in a row of its sub-tree; the region is opened for the reveal if it has not been read yet. The dump is not moved: the reveal brings the tree to the byte, not the byte to the tree.

## What the tool checks

- **Checksums.** A header whose checksum does not agree is marked in red, and the detail list reports both the stored value and the correct one. **Fix Checksum** in the node's context menu writes the correct value as one write and one undo step.
- **Protected ranges.** Where the image declares [[term:boot-guard|Boot Guard]] protected ranges, the summary line reports how many. A signature over such a range cannot be recomputed without the manufacturer's private key; see [[topic:recipe-checksums|Checksums]].

## What you can take out

Right-click a node:

- **Open** the node, or just its body, as a [[topic:fragments|fragment panel]].
- **Save … as…** the node, or just its body, to a file: the same bytes **Open** shows, under the same name — the dump's, followed by the node's. The browser stores the file as it stores any download: in its downloads folder, or where it asks.
- **Open Decompressed Body** / **Export Decompressed Body…** for a compressed section — what those bytes actually expand to. A node inside one offers the same for its own **Bytes**.
- **Go to Top Swap Copy** / **Go to Original** for a node in either block of an image with a [[term:top-swap|Top Swap]] copy — selects the same node in the other block and shows its bytes in the dump, so that each part of the copy can be matched with the part of the top block it duplicates.

A [[term:picture|picture]] the tool recognises — a JPEG, PNG, GIF or BMP, in padding or as the body of a raw section — is a row of its own, and selecting it draws the picture under its details: as wide as the list at most and never larger than its own size in pixels. The preview is drawn from the bytes in the dump as they are, by the browser's own image decoder rather than the firmware's, so it shows what is stored, not exactly how the board will draw it. A format the browser cannot decode leaves the details without a preview. A thin frame marks where the picture ends, so a white or transparent logo does not disappear into the panel. A click on the picture changes what is behind it: the panel's own background, a checkerboard, or black (white with the dark appearance). A picture with transparency starts on the checkerboard, one without on the panel's background.

## Padding

A dump holds erased space between its structures. The tree omits it unless **Show Empty Padding** is ticked in the filter menu, which the funnel icon in the title row opens, left of **the reveal button**. The icon is tinted while the tree lists anything it omits by default. Padding that holds data is listed in either case, as is a volume's free space, which reports how much room remains in that volume.

## Variable values

The row of a [[term:vss|VSS]], [[term:nvar|NVAR]] or [[term:dvar|DVAR]] variable gives its value after an equals sign — `BootOrder = 0003, 2001`, `Lang = "eng"`, `Boot0001 = Windows Boot Manager` — and the detail list gives the whole value under **Value**. A VSS or NVAR value is read as its type: text as text, a number as a number, a device path in the text form of the UEFI specification. **Read as** says what type the value was read as and whether the specification defines it or the type was guessed from the bytes. How the type is decided is explained under [[term:vss|VSS]]; an NVAR value is read the same way. The row of an NVAR link gives no value, because a later entry of its chain replaced it.

## Regions of an Insyde map

On Insyde firmware the detail of the [[term:flash-device-map|flash device map]], and of each of its entries, lists the regions the map names under **Regions of the flash device map**. The start of a region that lies in the dump is a link: a click on its row outlines the region in the dump under the region's type and brings it into view, including a region the tree does not show as a row of its own because it spans several nodes or lies inside one. The tree and the detail stay on the map; selecting another node replaces the outline. The table **Ranges listed in $BME$** in the detail of the [[term:bvdt|BIOS Version Data Table]] links its ranges the same way.

## Variable copies

[[term:vss|VSS]], [[term:nvar|NVAR]] and [[term:dvar|DVAR]] — the [[term:nvram|NVRAM]] formats whose entries the tree folds to one row per variable — keep the earlier copies of a variable until the firmware reclaims the store; on a board that writes a variable at every boot the copies are most of the rows. The row is the variable's current copy, or for a variable the store no longer holds, the copy it was deleted as, unless **Show Superseded Entries** is ticked in the same menu. The other copies are listed under **Variable history** in the detail of that row; a click on a copy there shows its own detail and its bytes in the dump, and the tree keeps the row of the copy that stands selected. When the caret in the dump is in a copy the tree leaves out, revealing it does the same.

See also: [[topic:tool-fit|FIT Table]], [[term:vss|NVRAM stores]], [[topic:recipe-checksums|Checksums]].
