# Segments: Cutting a Dump into Pieces

> Marking the internal boundaries of an image, and saving each piece as a separate file.

@covers menu.edit.add-cut
@covers menu.edit.merge
@covers menu.edit.segments
@covers dialog.segments

A segmentation splits the pane's file into **pieces**: contiguous, never overlapping, always covering the whole file. Every open file starts as one piece — itself.

Nothing about a segment changes the bytes. It is a way of *reading* a file; the only thing that writes is the explicit save.

## Making a cut

- Right-click in the dump and choose **Split Here at «address»**, which cuts at the caret.
- **Segments ▸ Split Here…** takes the address as a number instead. Once committed, the caret lands on the new cut and the view centres on it.
- **Segments ▸ Merge** removes the cut before the piece the caret is in, joining it to its neighbour.
- **Segments ▸ Segments…** opens the list: every piece, its range, its name, and the buttons that act on all of them.

Pieces are labelled **S0, S1, S2 …** in file order and are renumbered automatically when a cut is added or removed. A name given to a piece stays with that piece regardless of its number.

## Saving the pieces

The Segments form holds **Save All as Separate Files…**, which writes every piece at once. Together with [[topic:join-duplicate|Append File…]] this covers a board whose firmware is held in two SPI chips:

1. The two chips are read, producing two files.
2. One is opened and the other appended to it, so that the whole of the firmware is one image.
3. The image is compared, searched, edited and decoded as a single file by the [[topic:tool-uefi|UEFI panel]], which expects one contiguous image.
4. The boundary at which the two files met is already a cut, so **Save All as Separate Files** returns the two halves at exactly that boundary.

## What a piece keeps of the file it came from

A piece brought in by **Append File…**, **Insert File at Start…** or **Replace Segment from File…** keeps a link to that file: the file corresponds to the piece as a whole.

The Segments form shows the linked file's name beside the piece and, where the piece no longer matches it, why:

- **edited** — the same length, different bytes: the piece has been changed since it came in;
- **length changed** — the piece and the file are no longer the same length. That follows either from bytes inserted or deleted inside the piece, or from the file on disk now being a different length;
- **file missing** — the file has been deleted, renamed or moved, and can no longer be read.

The comparison is against what the file holds on disk now, so a file changed outside the program shows up in that same row.

## Putting a piece back from its file

**Revert Segment to Source** puts the linked file's bytes back into the piece. It is one undo step, and the link stays: the bytes are still that file's.

The command is offered while the linked file is available; a piece with no link does not have it. Where the piece and the file no longer have the same length, the program asks before changing the length.

The link survives undo: the step that brings a piece back brings its link back with it.

! A cut travels with the bytes: data inserted before it moves it. A [[topic:bookmarks|bookmark]] behaves in the opposite way and stays at its address. A cut denotes the boundary of an area; a bookmark denotes an address.

Segments live as long as the file is open.
