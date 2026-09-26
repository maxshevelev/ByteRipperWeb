# Segments: Cutting a Dump into Pieces

> Mark the seams of an image, then save each piece as its own file.

@covers menu.edit.add-cut
@covers menu.edit.merge
@covers menu.edit.segments
@covers dialog.segments

A segmentation splits the pane's file into **pieces**: contiguous, never overlapping, always covering the whole file. Every open file starts as one piece — itself.

Nothing about a segment changes the bytes. It is a way of *reading* a file; the only thing that writes is the explicit save.

## Making a cut

- Right-click in the dump and choose **Split Here at «address»** — the fast way, at the caret.
- **Segments ▸ Split Here…** to type the offset instead.
- **Segments ▸ Merge** removes the cut before the piece the caret is in, joining it to its neighbour.
- **Segments ▸ Segments…** opens the list: every piece, its range, its name, and the buttons that act on all of them.

Pieces are labelled **S0, S1, S2 …** in file order, and renumber themselves when a cut is added or removed. A name you give a piece stays with the piece, whatever its number becomes.

## Saving the pieces

The Segments form can **save all pieces as separate files** in one go. That, together with [[topic:join-duplicate|Append File…]], is the bench workflow for a board with two SPI chips:

1. Read both chips, giving two files.
2. Open one and **Append File…** the other — now the whole BIOS is one image.
3. Work on it: compare, search, patch, run the [[topic:tool-uefi|UEFI panel]] over it.
4. The seam where the two files met is already a cut, so **Save All as Separate Files** gives you the two halves back, ready to flash to their own chips.

! A cut travels with the bytes: insert data before it and the cut moves. A [[topic:bookmarks|bookmark]] does the opposite — it stays at its address. Use a cut for "the edge of this region", a bookmark for "this address".

Segments live as long as the file is open.
