# UEFI Structure

> The map of a firmware image: which region, which volume, which file, and where.

@covers panel.uefi
@covers panel.uefi.fix-checksum
@covers panel.uefi.top-swap
@covers panel.uefi.save-node
@covers panel.uefi.picture-preview
@covers panel.uefi.sound-player
@covers panel.uefi.superseded-entries
@covers panel.uefi.filter
@covers panel.uefi.search
@covers panel.uefi.variable-history
@covers panel.uefi.folding-table
@covers panel.uefi.table-copy
@covers panel.detail-select
@covers panel.uefi.variable-value
@covers panel.uefi.reveal
@covers panel.uefi.map-regions

**Tools ▸ UEFI Structure** reads the open dump as an Intel/UEFI flash image and shows it as a tree. The title line above the tree says what the image as a whole is.

## The tree

The top level is the layout of the chip itself. On an Intel platform that is the [[term:flash-descriptor|flash descriptor]] and the [[term:region|regions]] it defines — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. Inside the BIOS region are [[term:volume|firmware volumes]], within those [[term:ffs-file|FFS files]], and within those [[term:section|sections]]. A branch is decoded when it is opened rather than in advance.

The **Type** and **Subtype** columns name each node as the reference parser names it. The **Name** column gives a file the name its own Name section carries. A node without one is named by the community catalogue for its [[term:guid|GUID]] where the catalogue has a name, and by the GUID itself where it has none. The catalogue's name and a file's own name can differ — a vendor can give a GUID the catalogue knows to another module — and the details then show the catalogue's under **Name in the catalogue**.

The **ME region** row opens onto the same analysis the [[topic:tool-me|ME Analyzer]] gives, so an image can be read end to end in one tree. It opens as soon as the region has been read; values that wait for a database read **Loading…** there as they do in the ME Analyzer.

**The reveal button** on the right of the title row shows in the tree the node under the caret in the dump — the start of a selection where there is one. It opens the branches on the way, and a branch not yet decoded is decoded for it, so the reveal can take as long as that read. It then selects the innermost node whose range holds the byte. A byte of the ME region is shown in a row of its sub-tree; the region is opened for the reveal if it has not been read yet. The dump is not moved: the reveal brings the tree to the byte, not the byte to the tree.

A long table in the details — **PCH straps** in the details of the [[term:flash-descriptor|flash descriptor]] — is folded under its heading at first, so that the rest of the details remains in view. A click on the triangle or on the heading unfolds it; it then stays unfolded on other nodes until the app is quit. In a table only a link leads anywhere, and only a click on the link itself. The text of the details — the fields of a node as well as the tables — is selected as any text is: by dragging across rows, a word by a double click, a row by a triple click, the whole list of fields or the whole table by ⌘A. ⌘C copies the selection with a tab between a field's name and its value or between cells, and a line per row, so that a spreadsheet receives a table as a table. **Copy** in the context menu of a row copies the selection or, when nothing is selected, the name, value or cell under the pointer. A field name too long for its column continues on the next line.

## Searching the tree

The **magnifier** in the title row, left of the filter, opens a search bar above the tree; [[key:find]] does the same while the tree or its details have the keyboard, and puts the cursor in the text field. Its first line holds the text to look for and two arrows; the second holds a **Type** and, for files and sections, a **Subtype**.

The text is looked for anywhere in a node's name and in its [[term:guid|GUID]], whatever the case. A file is found by the name its row shows and by its GUID, with the dashes or without them. Its Name section, whose text is the file's name, is not a second match; it is found when the type asked for is **Section**. Type and subtype are those of the **Type** and **Subtype** columns. Whatever is set must hold at once; a type alone finds every node of that type.

The arrows go to the next and the previous match — as do Return and Shift-Return in the text field — in the order in which the tree lists its rows with everything open. The search goes on from the last match, or from the row selected since, and does not stop on that row again; shutting the branch a match is in does not lose the place. When it reaches the end it goes on from the other end and shows the same sign as a search in the dump does; when nothing matches, the bar says **Not found**. Rows the filter menu leaves out are not matches. A branch not decoded yet is decoded on the way, in the background. A search that takes longer than a moment shows a progress bar in the bar's second line, where **Not found** would appear, with a button beside it that stops the search. The bar shows where in the file the node being looked at lies; for a node inside a compressed section, where that section lies.

The match is selected as a click on it would select it: the details and the dump follow. The search opens the branches on the way to the match, and the match itself one level down. When it goes on to the next match it shuts again what it opened and the new match does not need, so that the tree returns to the state it had before the search. A branch the reader opened is not touched. A branch the reader opens or shuts while the search stands on it, a click on another row, a changed query or a closed bar leave everything as it is.

The contents of an ME region are not searched: the sub-tree has another structure, which a name, a GUID and a type do not describe. The row of the ME region itself is found. What is asked for is the same in both panels, and it is kept through a re-read of the file, a change of file and a restart of the app.

## What the tool checks

- **Checksums.** A header whose checksum does not agree is marked in red, and the detail list reports both the stored value and the correct one. **Fix Checksum** in the node's context menu writes the correct value as one write and one undo step.
- **Protected ranges.** Where the image declares [[term:boot-guard|Boot Guard]] protected ranges, the summary line reports how many. A signature over such a range cannot be recomputed without the manufacturer's private key; see [[topic:recipe-checksums|Checksums]].

## What you can take out

Right-click a node:

- **Open** the node, or just its body, as a [[topic:fragments|fragment panel]].
- **Save … as…** the node, or just its body, to a file: the same bytes **Open** shows, under the same name — the dump's, followed by the node's. The browser stores the file as it stores any download: in its downloads folder, or where it asks.
- **Open Decompressed Body** / **Export Decompressed Body…** for a compressed section — what those bytes actually expand to. A node inside one offers the same for its own **Bytes**.
- **Go to Top Swap Copy** / **Go to Original** for a node in either block of an image with a [[term:top-swap|Top Swap]] copy — selects the same node in the other block and shows its bytes in the dump, so that each part of the copy can be matched with the part of the top block it duplicates.

A [[term:picture|picture]] the tool recognises — a JPEG, PNG, GIF or BMP, in padding, in a raw section or in a freeform section — is a row of its own, and selecting it draws the picture under its details: as wide as the list at most and never larger than its own size in pixels. The preview is drawn from the bytes in the dump as they are, by the browser's own image decoder rather than the firmware's, so it shows what is stored, not exactly how the board will draw it. A format the browser cannot decode leaves the details without a preview. A thin frame marks where the picture ends, so a white or transparent logo does not disappear into the panel. A click on the picture changes what is behind it: the panel's own background, a checkerboard, or black (white with the dark appearance). A picture with transparency starts on the checkerboard, one without on the panel's background. In the [[topic:tools-overview|large view of the details]], which **Space** on the row opens, the picture is drawn larger, up to its own size in pixels.

## Sounds

A [[term:sound|sound]] the tool recognises — a WAV file kept where a file's sections would be — is a row of its own, and selecting it puts a player under its details. **Play** starts the sound and becomes **Pause** while it plays; **Stop** ends it and goes back to the start. The bar under **Playback position** moves as the sound plays, and dragging it moves to another place in the sound; the time played and the length of the whole are given beside it. The sound is played from the bytes in the dump as they were when the row was selected, by [[edition:the browser||macOS]] rather than by the board, and it stops when another row is selected or the panel is closed.

## Padding

A dump holds erased space between its structures. The tree omits it unless **Show Empty Padding** is ticked in the filter menu, which the funnel icon in the title row opens, left of **the reveal button**. The icon is tinted while the tree lists anything it omits by default. Padding that holds data is listed in either case, as is a volume's free space, which reports how much room remains in that volume. Every erased row whose subtype reads **Empty (FFh)** — padding, and also a region of an Insyde [[term:flash-device-map|flash device map]] nobody has written, such as **Unused** or a password slot — free space and a pad file with an erased body (**Padding file**) are shown in grey: a place in the layout that holds nothing.

## Variable values

The row of a [[term:vss|VSS]], [[term:nvar|NVAR]] or [[term:dvar|DVAR]] variable gives its value after an equals sign — `BootOrder = 0003, 2001`, `Lang = "eng"`, `Boot0001 = Windows Boot Manager` — and the detail list gives the whole value under **Value**. A VSS or NVAR value is read as its type: text as text, a number as a number, a device path in the text form of the UEFI specification. **Read as** says what type the value was read as and whether the specification defines it or the type was guessed from the bytes. How the type is decided is explained under [[term:vss|VSS]]; an NVAR value is read the same way. The row of an NVAR link gives no value, because a later entry of its chain replaced it.

## Regions of an Insyde map

On Insyde firmware the detail of the [[term:flash-device-map|flash device map]], and of each of its entries, lists the regions the map names under **Regions of the flash device map**. The start of a region that lies in the dump is a link: a click on it outlines the region in the dump under the region's type and brings it into view, including a region the tree does not show as a row of its own because it spans several nodes or lies inside one. The tree and the detail stay on the map; selecting another node replaces the outline. The table **Ranges listed in $BME$** in the detail of the [[term:bvdt|BIOS Version Data Table]] links its ranges the same way.

## Variable copies

[[term:vss|VSS]], [[term:nvar|NVAR]] and [[term:dvar|DVAR]] — the [[term:nvram|NVRAM]] formats whose entries the tree folds to one row per variable — keep the earlier copies of a variable until the firmware reclaims the store; on a board that writes a variable at every boot the copies are most of the rows. The row is the variable's current copy, or for a variable the store no longer holds, the copy it was deleted as, unless **Show Superseded Entries** is ticked in the same menu. The other copies are listed under **Variable history** in the detail of that row; a click on a copy's address there shows its own detail and its bytes in the dump, and the tree keeps the row of the copy that stands selected. When the caret in the dump is in a copy the tree leaves out, revealing it does the same. A [[term:gpnv|GPNV store]] keeps the earlier copies of its records in the same way, and the tree folds them the same way, one row per record name.

See also: [[topic:tool-fit|FIT Table]], [[term:vss|NVRAM stores]], [[topic:recipe-checksums|Checksums]].
