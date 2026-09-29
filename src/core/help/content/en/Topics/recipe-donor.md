# Transferring a Region Between Two Images

> The facilities the program provides for copying a range of bytes from one open image into another, at the same address.

The transfer itself is one command, **Edit ▸ Copy to Other Pane**. Finding out which range to transfer, and checking the result, uses facilities that are documented individually elsewhere; this page states which ones take part and in what order they are normally used.

## The facilities involved

- **Two file panes.** Both images are open at once and compared byte for byte at equal addresses ([[topic:first-comparison|Your First Comparison]]).
- **The status line** under each pane reports the size of that pane's file. Two images of different length are compared from address zero regardless, and the tail that exists in only one of them is reported as a difference.
- **[[topic:tool-uefi|UEFI Structure]]** reads either pane and names the regions, volumes and files an address falls into. The detail list gives the start address and the length of the selected node.
- **The [[topic:minimap|minimap]]** in overview mode shows the distribution of differences over the whole image in one column.
- **Select Block from Here at…**, in the pane's right-click menu, takes a range as numbers — start and end, or start and length — rather than requiring it to be dragged out with the mouse ([[topic:navigation|Moving Around]]).
- **Edit ▸ Copy to Other Pane** writes the selection of the active pane into the other pane at the same addresses. It overwrites and does not move any byte that follows the range ([[topic:editing|Editing Bytes]]), so every other address is left unchanged.
- **[[topic:bookmarks|Bookmarks]]** are absolute addresses shared by both panes, which is what lets the same address be found in both images.

## The usual order

1. Both images are opened, one per pane.
2. The sizes reported in the two status lines are compared. They determine whether the addresses in one image mean the same thing in the other.
3. A tool panel is opened on the image whose layout is in question, and the region of interest is selected in its tree. The detail list gives the range.
4. The range is selected in the source pane with **Select Block from Here at…**.
5. **Edit ▸ Copy to Other Pane** writes it into the destination pane.
6. The comparison is read again. Every remaining difference is a difference the operation did not address.

Step 5 is one undo step (⌘Z) in the destination file.

## What the program does not do

- It does not search for the same block of bytes at a different address, and it does not shift one file against the other. Comparison is by absolute address only ([[topic:overview|What ByteRipper Is For]]).
- It does not decide which of two images is the correct one, and it does not report whether the result will be accepted by any platform.
- It does not carry over data that is specific to a particular board. Such data is described in [[topic:recipe-board-data|Data Unique to a Board]].

! Where an image declares [[term:boot-guard|Boot Guard]] protected ranges, the UEFI panel's summary line reports how many. Bytes inside such a range are covered by a signature that cannot be recomputed without the manufacturer's private key; this is a property of the platform, not a restriction imposed by the program. See [[topic:flash-writes|Who Writes to the Flash]].
